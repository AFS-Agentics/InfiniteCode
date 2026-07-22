//! SQLite persistence for the InfiniteCode-shaped coordination API.
//!
//! The existing `crate::db::Database` owns the schema migration for the
//! canonical InfiniteCode tables (`sessions`, `session_stats`,
//! `pending_messages`, ...). This module owns the **adjacent** `infinitecode_*`
//! tables, kept in the same database file so the bridge benefits from the
//! existing `~/.infinitecode/infinitecode.db` path resolution and acquires
//! locks against the same connection.
//!
//! Public surface:
//!   - `migrate(conn)` — runs the schema migration. Idempotent. Called once
//!     during server bootstrap after the canonical migration has run.
//!   - `upsert_session` — admit or re-admit a session row keyed by
//!     `instance_id`.
//!   - `get_session` — poll by instance id (for `GET
//!     /api/v1/infinitecode/session/:instance_id`).
//!   - `release_session` — mark a session ended (for `DELETE
//!     /api/v1/infinitecode/session/:instance_id`).
//!   - `supersede_existing_sessions_for_user` — atomic rotation that flips
//!     every active session for an acting-user to `superseded` and returns
//!     the instance ids that were superseded (for the 409 race we mirror
//!     from InfiniteCode).
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

/// All-or-nothing admit that runs the rotation in a single transaction.
///
/// Steps inside the transaction:
///   1. For every active row in `infinitecode_sessions` with the supplied
///      `acting_user_id`, set `status = 'superseded'`, `reason = 'rotated'`.
///   2. Insert the new row keyed by `instance_id` with the supplied model
///      and bucket.
///
/// Returns the superseded `instance_id`s so the HTTP handler can attach a
/// `superseded` reason to the old poll responses (and a 409 next time
/// someone GETs them).
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

    let superseded: Vec<String> = {
        let mut stmt = tx
            .prepare(
                "UPDATE infinitecode_sessions
                 SET status = 'superseded', reason = 'rotated'
                 WHERE acting_user_id = ?1 AND status = 'active'
                 RETURNING instance_id",
            )
            .context("failed to prepare supersede statement")?;
        let rows = stmt
            .query_map(params![acting_user_id], |row| row.get::<_, String>(0))
            .context("failed to run supersede statement")?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        out
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
    fn supersede_and_admit_rotates_previous_active_sessions() {
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
            None,
            None,
        )
        .expect("first admit");
        assert!(superseded_a.is_empty(), "first admit supersedes nothing");

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
            None,
            None,
        )
        .expect("second admit");

        assert_eq!(superseded_b, vec!["instance-A".to_string()]);

        let a = get_session(&conn, "instance-A").expect("get A").expect("A exists");
        assert_eq!(a.status, CoordinationSessionStatus::Superseded);
        assert_eq!(a.reason.as_deref(), Some("rotated"));

        let b = get_session(&conn, "instance-B").expect("get B").expect("B exists");
        assert_eq!(b.status, CoordinationSessionStatus::Active);
        assert_eq!(b.acting_user_id, "user-1");
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
