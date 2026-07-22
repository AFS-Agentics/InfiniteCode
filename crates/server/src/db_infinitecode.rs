//! SQLite persistence for the InfiniteCode-shaped coordination API.
//!
//! The existing `crate::db::Database` owns the schema migration for the
//! canonical InfiniteCode tables (`sessions`, `session_stats`,
//! `pending_messages`, ...). This module owns the **adjacent** `infinitecode_*`
//! tables, kept in the same database file so the bridge benefits from the
//! existing `~/.infinitecode/infinitecode.db` path resolution and acquires
//! locks against the same connection.
//!
//! Active-session rule: PER-(USER, DEVICE), not strict per-user.
//!   - Same `acting_user_id` opening on a SECOND device: BOTH active.
//!   - Different `acting_user_id` opening on the SAME device: prior user's
//!     row is flipped to `superseded` with reason `different_account_on_device`.
//!   - Under the strict rule (rejected), same user across devices would
//!     have caused a takeover prompt on the older device. The relaxed rule
//!     matches the universal SaaS pattern (GitHub, Slack, Discord, Linear).
//!
//! CRITICAL QUOTA INVARIANT — DO NOT BYPASS.
//! Every query in this module that touches quota math, rate limiting, or
//! daily-cap enforcement MUST join on `acting_user_id` alone. NEVER include
//! `device_fingerprint`, `instance_id`, or `app_version` as a join key.
//! The risk is fingerprint-rotation laundering: an attacker rotating
//! `device_fingerprint` between admits would otherwise evade any per-device
//! cap. See `premium_count_for_user` and the regression test in this file's
//! `tests` module. The top-level invariant is also documented in
//! `crates/protocol/src/coordination.rs`.
//!
//! Public surface:
//!   - `migrate(conn)` — runs the schema migration. Idempotent. Called once
//!     during server bootstrap after the canonical migration has run.
//!   - `supersede_and_admit` — atomic admit under the per-(user, device)
//!     rule; returns the instance ids of any rows that just got flipped to
//!     `superseded` (always a strict subset of the per-device-collision
//!     case, never the strict per-user case).
//!   - `touch_time_remaining` — refresh `time_remaining_ms` during polls
//!     without flipping status.
//!   - `get_session` — poll by instance id (for
//!     `GET /api/v1/infinitecode/session/:instance_id`).
//!   - `release_session` — mark a session ended (for
//!     `DELETE /api/v1/infinitecode/session/:instance_id`).
//!   - `premium_count_for_user` — quota signal. KEYED ON `acting_user_id`
//!     ONLY. Use this to gate a new premium admit when the user already has
//!     too many active premium sessions in the time window.
//!   - bearer-token CRUD (`insert_bearer_token`, `find_bearer_token`,
//!     `prune_expired_bearer_tokens`).
//!
//! Concurrency: a single `Arc<Mutex<Connection>>` is shared with the
//! canonical migration, so the bridge runs under the same lock discipline as
//! every other database call site in `infinitecode-server`. We do **not**
//! hold the lock across awaits.

use anyhow::{Context, Result};
use chrono::{DateTime, TimeZone, Utc};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use sha2::{Digest, Sha256};

use infinitecode_protocol::{
    CoordinationSessionBucket, CoordinationSessionResponse, CoordinationSessionStatus,
};

use crate::db::Database;

/// Idempotent migration for the InfiniteCode-shaped tables.
///
/// Called from `bootstrap.rs` after `Database::open` (which runs the
/// canonical migration). The two migrations share the same `Connection`
/// handle so the lock discipline is identical.
pub fn migrate(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS infinitecode_sessions (
            instance_id TEXT PRIMARY KEY,
            acting_user_id TEXT NOT NULL,
            model TEXT NOT NULL,
            bucket TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            time_remaining_ms INTEGER,
            started_at INTEGER NOT NULL,
            expires_at INTEGER,
            reason TEXT,
            iso_country_code TEXT,
            device_fingerprint TEXT,
            app_version TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_infinitecode_sessions_user
            ON infinitecode_sessions(acting_user_id);
        CREATE INDEX IF NOT EXISTS idx_infinitecode_sessions_status
            ON infinitecode_sessions(status);

        CREATE TABLE IF NOT EXISTS infinitecode_bearer_tokens (
            token_hash TEXT PRIMARY KEY,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_infinitecode_bearer_tokens_expires
            ON infinitecode_bearer_tokens(expires_at);
        "#,
    )
    .context("failed to migrate infinitecode bridge schema")?;
    Ok(())
}

/// Convenience wrapper that pulls `shared_conn` and calls `migrate`.
pub fn migrate_database(db: &Database) -> Result<()> {
    let conn_arc = db.shared_conn();
    let conn = conn_arc.lock().expect("database mutex poisoned");
    migrate(&conn)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InfiniteCodeSessionRow {
    pub instance_id: String,
    pub acting_user_id: String,
    pub model: String,
    pub bucket: CoordinationSessionBucket,
    pub status: CoordinationSessionStatus,
    pub time_remaining_ms: Option<i64>,
    pub started_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub reason: Option<String>,
    pub iso_country_code: Option<String>,
    pub device_fingerprint: Option<String>,
    pub app_version: Option<String>,
}

impl InfiniteCodeSessionRow {
    pub fn into_response(self) -> CoordinationSessionResponse {
        CoordinationSessionResponse {
            instance_id: self.instance_id.into(),
            status: self.status,
            model: self.model.into(),
            bucket: self.bucket,
            time_remaining_ms: self.time_remaining_ms,
            started_at: self.started_at,
            expires_at: self.expires_at,
            reason: self.reason.map(Into::into),
            next_quota_reset_secs: None,
        }
    }
}

fn bucket_str(bucket: CoordinationSessionBucket) -> &'static str {
    match bucket {
        CoordinationSessionBucket::Premium => "premium",
        CoordinationSessionBucket::Unlimited => "unlimited",
        CoordinationSessionBucket::Limited => "limited",
    }
}

fn parse_bucket(value: String) -> rusqlite::Result<CoordinationSessionBucket> {
    match value.as_str() {
        "premium" => Ok(CoordinationSessionBucket::Premium),
        "unlimited" => Ok(CoordinationSessionBucket::Unlimited),
        "limited" => Ok(CoordinationSessionBucket::Limited),
        _ => Ok(CoordinationSessionBucket::Unlimited),
    }
}

fn parse_status(value: String) -> rusqlite::Result<CoordinationSessionStatus> {
    match value.as_str() {
        "none" => Ok(CoordinationSessionStatus::None),
        "active" => Ok(CoordinationSessionStatus::Active),
        "ended" => Ok(CoordinationSessionStatus::Ended),
        "superseded" => Ok(CoordinationSessionStatus::Superseded),
        "country_blocked" => Ok(CoordinationSessionStatus::CountryBlocked),
        "banned" => Ok(CoordinationSessionStatus::Banned),
        "rate_limited" => Ok(CoordinationSessionStatus::RateLimited),
        _ => Ok(CoordinationSessionStatus::None),
    }
}

fn parse_session_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<InfiniteCodeSessionRow> {
    Ok(InfiniteCodeSessionRow {
        instance_id: row.get(0)?,
        acting_user_id: row.get(1)?,
        model: row.get(2)?,
        bucket: parse_bucket(row.get::<_, String>(3)?)?,
        status: parse_status(row.get::<_, String>(4)?)?,
        time_remaining_ms: row.get(5)?,
        started_at: parse_utc(row.get::<_, i64>(6)?)?,
        expires_at: row.get::<_, Option<i64>>(7)?.map(parse_utc).transpose()?,
        reason: row.get(8)?,
        iso_country_code: row.get(9)?,
        device_fingerprint: row.get(10)?,
        app_version: row.get(11)?,
    })
}

/// Inlined row parser exposed so the HTTP layer can issue standalone
/// `query_row` calls without going through the `get_session` helper (used
/// by the GET-without-instance-id poll endpoint).
pub fn parse_session_row_pub(row: &rusqlite::Row<'_>) -> rusqlite::Result<InfiniteCodeSessionRow> {
    parse_session_row(row)
}

fn parse_utc(secs: i64) -> rusqlite::Result<DateTime<Utc>> {
    Utc.timestamp_opt(secs, 0).single().ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Integer,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("unix timestamp out of range: {secs}"),
            )),
        )
    })
}

/// All-or-nothing admit under the per-(user, device) rule.
///
/// Steps inside the transaction:
///   1. For every active row in `infinitecode_sessions` whose
///      `device_fingerprint` matches the new admit's fingerprint AND whose
///      `acting_user_id` is a DIFFERENT user, set
///      `status = 'superseded', reason = 'different_account_on_device'`.
///      This is the per-device collision rule. The strict per-user
///      supersede is intentionally NOT applied here — same-user on a
///      second device gets a fresh active row, NOT a takeover.
///   2. Insert the new row keyed by `instance_id` with the supplied model
///      and bucket.
///
/// Notes:
///   - When `device_fingerprint` is `None` on the new admit, step 1 cannot
///     fire (no fingerprint to match against). The caller is responsible
///     for ensuring that the local session-lock has already gated per-process
///     concurrency on the same machine before this admit is reached.
///   - When `device_fingerprint` is `Some`, the WHERE clause below
///     deliberately uses `device_fingerprint = ?1 AND acting_user_id != ?2`
///     — the inverted condition would re-introduce the strict per-user rule
///     that this function is explicitly relaxing.
///
/// Returns the superseded `instance_id`s so the HTTP handler can attach a
/// `superseded` reason to the old poll responses (and a 409 next time
/// someone GETs them). Same-user re-admits across devices return an empty
/// vec.
pub fn supersede_and_admit(
    conn: &mut Connection,
    new_instance_id: &str,
    acting_user_id: &str,
    model: &str,
    bucket: CoordinationSessionBucket,
    started_at_secs: i64,
    expires_at_secs: Option<i64>,
    time_remaining_ms: Option<i64>,
    iso_country_code: Option<&str>,
    device_fingerprint: Option<&str>,
    app_version: Option<&str>,
) -> Result<Vec<String>> {
    let tx: Transaction<'_> = (*conn)
        .transaction()
        .context("failed to begin infinitecode session transaction")?;

    let superseded: Vec<String> = match device_fingerprint {
        Some(fingerprint) => {
            let mut stmt = tx
                .prepare(
                    "UPDATE infinitecode_sessions
                     SET status = 'superseded', reason = 'different_account_on_device'
                     WHERE device_fingerprint = ?1
                       AND acting_user_id != ?2
                       AND status = 'active'
                     RETURNING instance_id",
                )
                .context("failed to prepare per-device supersede statement")?;
            let rows = stmt
                .query_map(params![fingerprint, acting_user_id], |row| {
                    row.get::<_, String>(0)
                })
                .context("failed to run per-device supersede statement")?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row?);
            }
            out
        }
        None => Vec::new(),
    };

    tx.execute(
        "INSERT INTO infinitecode_sessions
            (instance_id, acting_user_id, model, bucket, status, time_remaining_ms,
             started_at, expires_at, reason, iso_country_code, device_fingerprint, app_version)
         VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6, ?7, NULL, ?8, ?9, ?10)",
        params![
            new_instance_id,
            acting_user_id,
            model,
            bucket_str(bucket),
            time_remaining_ms,
            started_at_secs,
            expires_at_secs,
            iso_country_code,
            device_fingerprint,
            app_version,
        ],
    )
    .context("failed to insert new infinitecode session")?;

    tx.commit().context("failed to commit infinitecode session transaction")?;
    Ok(superseded)
}

/// Premium-bucket session count for an acting user in a time window.
///
/// CRITICAL INVARIANT: this query joins on `acting_user_id` ONLY. NEVER
/// add `device_fingerprint`, `instance_id`, or `app_version` to the WHERE
/// here — fingerprint rotation would otherwise evade the cap. The
/// regression test `premium_count_for_user_only_counts_per_user` in this
/// file's `tests` module will fail loudly if anyone introduces a
/// fingerprint join here.
///
/// Use this in `crate::http::session::admit` AFTER inserting the new row
/// to gate it down to a small budget (e.g. "1 premium per user in the last
/// hour"), and use it across all devices, not per-device — that's the
/// quarantine against catastrophic quota-laundering via device-fingerprint
/// rotation. If premium_count_for_user was naively keyed on
/// `(acting_user_id, device_fingerprint)`, an attacker could rotate the
/// fingerprint every minute to claim a fresh premium slot and burn
/// unlimited LLM cost against no ad revenue (since headless impressions
/// have no viewability).
pub fn premium_count_for_user(
    conn: &Connection,
    acting_user_id: &str,
    since_unix_secs: i64,
) -> Result<u64> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM infinitecode_sessions
             WHERE acting_user_id = ?1
               AND bucket = 'premium'
               AND started_at >= ?2",
            params![acting_user_id, since_unix_secs],
            |row| row.get(0),
        )
        .context("failed to count premium sessions for user")?;
    Ok(count.max(0) as u64)
}

/// Updates a session without touching `status` (used by the holding GET
/// poll when we want to refresh `time_remaining_ms`).
pub fn touch_time_remaining(
    conn: &Connection,
    instance_id: &str,
    time_remaining_ms: i64,
) -> Result<()> {
    conn.execute(
        "UPDATE infinitecode_sessions SET time_remaining_ms = ?1 WHERE instance_id = ?2",
        params![time_remaining_ms, instance_id],
    )
    .context("failed to update infinitecode session time_remaining_ms")?;
    Ok(())
}

pub fn get_session(conn: &Connection, instance_id: &str) -> Result<Option<InfiniteCodeSessionRow>> {
    let row = conn
        .query_row(
            "SELECT instance_id, acting_user_id, model, bucket, status, time_remaining_ms,
                    started_at, expires_at, reason, iso_country_code, device_fingerprint, app_version
             FROM infinitecode_sessions WHERE instance_id = ?1",
            params![instance_id],
            parse_session_row,
        )
        .optional()
        .context("failed to fetch infinitecode session")?;
    Ok(row)
}

pub fn release_session(conn: &Connection, instance_id: &str) -> Result<bool> {
    let affected = conn
        .execute(
            "UPDATE infinitecode_sessions SET status = 'ended' WHERE instance_id = ?1 AND status = 'active'",
            params![instance_id],
        )
        .context("failed to release infinitecode session")?;
    Ok(affected > 0)
}

// === Bearer tokens ===

/// SHA-256 of the opaque token. Stored as 64-char lowercase hex.
pub fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    let digest = hasher.finalize();
    let mut out = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write;
        let _ = write!(out, "{byte:02x}");
    }
    out
}

pub fn insert_bearer_token(
    conn: &Connection,
    token: &str,
    created_at_secs: i64,
    expires_at_secs: i64,
) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO infinitecode_bearer_tokens (token_hash, created_at, expires_at)
         VALUES (?1, ?2, ?3)",
        params![hash_token(token), created_at_secs, expires_at_secs],
    )
    .context("failed to insert infinitecode bearer token")?;
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BearerTokenRecord {
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

pub fn find_bearer_token(conn: &Connection, token: &str) -> Result<Option<BearerTokenRecord>> {
    let row = conn
        .query_row(
            "SELECT created_at, expires_at FROM infinitecode_bearer_tokens WHERE token_hash = ?1",
            params![hash_token(token)],
            |row| {
                Ok(BearerTokenRecord {
                    created_at: parse_utc(row.get::<_, i64>(0)?)?,
                    expires_at: parse_utc(row.get::<_, i64>(1)?)?,
                })
            },
        )
        .optional()
        .context("failed to fetch infinitecode bearer token")?;
    Ok(row)
}

pub fn prune_expired_bearer_tokens(conn: &Connection, before_secs: i64) -> Result<usize> {
    let removed = conn
        .execute(
            "DELETE FROM infinitecode_bearer_tokens WHERE expires_at <= ?1",
            params![before_secs],
        )
        .context("failed to prune infinitecode bearer tokens")?;
    Ok(removed)
}

// === Helpers ===
// (no shared helpers — `crate::http::session` and `crate::http::auth` lock
// the connection directly via `db.shared_conn()`.)

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;
    use tempfile::TempDir;

    fn test_db() -> (Database, TempDir) {
        let dir = TempDir::new().expect("create temp dir");
        let db_path = dir.path().join("infinitecode.db");
        let db = Database::open(db_path).expect("open database");
        migrate_database(&db).expect("migrate infinitecode schema");
        (db, dir)
    }

    fn ts(secs: i64) -> DateTime<Utc> {
        Utc.timestamp_opt(secs, 0).single().expect("valid unix ts")
    }

    #[test]
    fn migration_runs_idempotently() {
        let (_db, _dir) = test_db();
        let arc = _db.shared_conn();
        let conn = arc.lock().expect("conn");
        migrate(&conn).expect("second migration");
        migrate(&conn).expect("third migration");
    }

    #[test]
    fn supersede_and_admit_allows_two_devices_per_user_to_coexist() {
        // Per-(user, device) rule: same `acting_user_id` opening a second
        // instance on a SECOND device should NOT touch the first row. Both
        // sessions remain Active. (Strict per-user rule would have rotated
        // the first row to `superseded`; we deliberately do not do that.)
        let (_db, _dir) = test_db();
        let conn = _db.shared_conn();
        let mut conn = conn.lock().expect("conn");

        let superseded_a = supersede_and_admit(
            &mut conn,
            "instance-A",
            "user-1",
            "deepseek/deepseek-v4-pro",
            CoordinationSessionBucket::Premium,
            ts(1_000).timestamp(),
            Some(ts(4_600).timestamp()),
            Some(3_600_000),
            None,
            Some("device-1"),
            None,
        )
        .expect("first admit on device-1");
        assert!(
            superseded_a.is_empty(),
            "first admit supersedes nothing (prior rows are nonexistent)"
        );

        let superseded_b = supersede_and_admit(
            &mut conn,
            "instance-B",
            "user-1",
            "minimax/minimax-m3",
            CoordinationSessionBucket::Unlimited,
            ts(2_000).timestamp(),
            Some(ts(6_200).timestamp()),
            Some(4_200_000),
            None,
            Some("device-2"), // <-- different device_fingerprint
            None,
        )
        .expect("second admit on device-2");

        // SAME user, DIFFERENT device: BOTH stay active.
        assert!(
            superseded_b.is_empty(),
            "per-(user, device) relaxation: same user across devices does not rotate. \
             Got {:?} which means we accidentally re-introduced the strict per-user rule.",
            superseded_b
        );

        let a = get_session(&conn, "instance-A").expect("get A").expect("A exists");
        assert_eq!(
            a.status,
            CoordinationSessionStatus::Active,
            "first row stays active under per-(user, device)"
        );

        let b = get_session(&conn, "instance-B").expect("get B").expect("B exists");
        assert_eq!(b.status, CoordinationSessionStatus::Active);
        assert_eq!(b.acting_user_id, "user-1");
        assert_eq!(b.device_fingerprint.as_deref(), Some("device-2"));
    }

    #[test]
    fn different_account_on_same_device_ends_old_users_session() {
        // Per-device collision rule: when user-2 signs in on the SAME
        // device that user-1 was using, user-1's row gets flipped to
        // `superseded` with reason "different_account_on_device", and
        // user-2's row lands as `active`.
        let (_db, _dir) = test_db();
        let conn = _db.shared_conn();
        let mut conn = conn.lock().expect("conn");

        supersede_and_admit(
            &mut conn,
            "instance-A",
            "user-1",
            "deepseek/deepseek-v4-pro",
            CoordinationSessionBucket::Premium,
            ts(1_000).timestamp(),
            Some(ts(4_600).timestamp()),
            Some(3_600_000),
            None,
            Some("shared-device"),
            None,
        )
        .expect("user-1 admit on shared-device");

        let superseded = supersede_and_admit(
            &mut conn,
            "instance-B",
            "user-2", // <-- different user
            "minimax/minimax-m3",
            CoordinationSessionBucket::Premium,
            ts(2_000).timestamp(),
            Some(ts(6_200).timestamp()),
            Some(4_200_000),
            None,
            Some("shared-device"), // <-- SAME device fingerprint
            None,
        )
        .expect("user-2 admit on shared-device");

        assert_eq!(
            superseded,
            vec!["instance-A".to_string()],
            "user-1's row should have been superseded as the per-device collision"
        );

        let a = get_session(&conn, "instance-A").expect("get A").expect("A exists");
        assert_eq!(a.status, CoordinationSessionStatus::Superseded);
        assert_eq!(a.reason.as_deref(), Some("different_account_on_device"));

        let b = get_session(&conn, "instance-B").expect("get B").expect("B exists");
        assert_eq!(b.status, CoordinationSessionStatus::Active);
        assert_eq!(b.acting_user_id, "user-2");
    }

    #[test]
    fn same_user_second_admit_with_no_fingerprint_does_not_supersede_prior() {
        // Defensive: device_fingerprint is `None` (e.g. unauthenticated
        // admit during a misconfigured boot). The per-device collision
        // branch cannot fire, so we MUST NOT touch prior rows. This
        // prevents a regression where someone refactors "skip when
        // fingerprint is None" and accidentally introduces a fallback to
        // the strict per-user rule.
        let (_db, _dir) = test_db();
        let conn = _db.shared_conn();
        let mut conn = conn.lock().expect("conn");

        supersede_and_admit(
            &mut conn,
            "instance-A",
            "user-1",
            "deepseek/deepseek-v4-pro",
            CoordinationSessionBucket::Premium,
            ts(1_000).timestamp(),
            Some(ts(4_600).timestamp()),
            Some(3_600_000),
            None,
            None, // <-- no fingerprint, admit A
            None,
        )
        .expect("first admit no fingerprint");

        let superseded = supersede_and_admit(
            &mut conn,
            "instance-B",
            "user-1", // <-- same user
            "minimax/minimax-m3",
            CoordinationSessionBucket::Unlimited,
            ts(2_000).timestamp(),
            Some(ts(6_200).timestamp()),
            Some(4_200_000),
            None,
            None, // <-- no fingerprint, admit B
            None,
        )
        .expect("second admit no fingerprint");

        assert!(
            superseded.is_empty(),
            "with device_fingerprint=None we cannot check per-device collision \
             and MUST NOT fall back to per-user supersede. Got {:?}.",
            superseded
        );

        let a = get_session(&conn, "instance-A").expect("get A").expect("A exists");
        assert_eq!(
            a.status,
            CoordinationSessionStatus::Active,
            "first row stays active when fingerprint is None"
        );
    }

    #[test]
    fn premium_count_for_user_only_counts_per_user_not_per_fingerprint() {
        // CATASTROPHIC-FAILURE REGRESSION. The risk: an attacker rotates
        // `device_fingerprint` every minute to claim a fresh premium slot
        // (1 premium per fingerprint, 12 fingerprints per hour = 12
        // premiums per hour, unlimited ad-free LLM). The
        // premium_count_for_user function MUST count per acting_user_id
        // only. This test fails the moment someone refactors the query to
        // include `device_fingerprint` in the WHERE clause.
        let (_db, _dir) = test_db();
        let conn = _db.shared_conn();
        let mut conn = conn.lock().expect("conn");

        // Six different device fingerprints, all for the same acting user,
        // all premium bucket, all within the time window.
        for i in 0..6 {
            supersede_and_admit(
                &mut conn,
                &format!("instance-{i}"),
                "user-x",
                "deepseek/deepseek-v4-pro",
                CoordinationSessionBucket::Premium,
                ts(1_000 + i).timestamp(),
                Some(ts(4_000 + i).timestamp()),
                Some(3_000_000),
                None,
                Some(&format!("fingerprint-{i}")),
                None,
            )
            .expect("admit premium slot");
        }

        let count = premium_count_for_user(&conn, "user-x", ts(0).timestamp())
            .expect("count succeeds");
        assert_eq!(
            count, 6,
            "premium_count_for_user MUST count across all fingerprints for the \
             same user, otherwise fingerprint rotation defeats the cap. Got {}.",
            count
        );

        // Sanity: a different user shares none of those rows.
        let other_count = premium_count_for_user(&conn, "user-y", ts(0).timestamp())
            .expect("count succeeds for other user");
        assert_eq!(other_count, 0);
    }

    #[test]
    fn release_session_only_affects_active_rows() {
        let (_db, _dir) = test_db();
        let conn = _db.shared_conn();
        let mut conn = conn.lock().expect("conn");
        supersede_and_admit(
            &mut conn,
            "instance-X",
            "user-2",
            "minimax/minimax-m3",
            CoordinationSessionBucket::Unlimited,
            ts(1_000).timestamp(),
            Some(ts(4_600).timestamp()),
            Some(3_600_000),
            None,
            None,
            None,
        )
        .expect("admit");

        assert!(release_session(&conn, "instance-X").expect("release"));
        assert!(!release_session(&conn, "instance-X").expect("release second"));

        let row = get_session(&conn, "instance-X").expect("get").expect("row");
        assert_eq!(row.status, CoordinationSessionStatus::Ended);
    }

    #[test]
    fn bearer_token_round_trip_and_prune() {
        let (_db, _dir) = test_db();
        let conn = _db.shared_conn();
        let conn = conn.lock().expect("conn");

        insert_bearer_token(&conn, "secret", 1_000, 2_000).expect("insert");
        let found = find_bearer_token(&conn, "secret").expect("find").expect("hit");
        assert_eq!(found.created_at.timestamp(), 1_000);
        assert_eq!(found.expires_at.timestamp(), 2_000);

        let missing = find_bearer_token(&conn, "wrong").expect("find wrong");
        assert!(missing.is_none());

        let removed = prune_expired_bearer_tokens(&conn, 2_000).expect("prune");
        assert_eq!(removed, 1);
        assert!(find_bearer_token(&conn, "secret").expect("post-prune").is_none());
    }
}
