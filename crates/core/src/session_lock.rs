//! Strict one-session-per-user enforcement.
//!
//! Writes a JSON lock file at the canonical InfiniteCode data directory. If
//! another live process holds the lock, `acquire` returns
//! [`SessionLockError::Superseded`] instead of taking over. A stale lock
//! (PID not alive) is cleared automatically.
//!
//! Mirrors the upstream Codebuff pattern in
//! `common/src/types/freebuff-session.ts:266-271`  // upstream Codebuff SaaS, this file path is unchanged there
//! (`reason: 'concurrent_sessions'` block reason) so an InfiniteCode CLI /
//! Desktop user cannot run two parallel agent loops on the same machine.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Identifies which surface is requesting the lock. Surfaced in the renderer
/// banner copy ("CLI pid 1234" vs "desktop app pid 1234").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Surface {
    Cli,
    Desktop,
}

impl Surface {
    pub fn as_str(self) -> &'static str {
        match self {
            Surface::Cli => "CLI",
            Surface::Desktop => "desktop app",
        }
    }
}

impl std::fmt::Display for Surface {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// On-disk lock record. New fields must be appended, not reordered, and the
/// `schema_version` bump is mandatory so older readers can refuse to load.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LockRecord {
    pub pid: u32,
    pub surface: Surface,
    #[serde(default)]
    pub session_id: Option<String>,
    pub started_at: chrono::DateTime<chrono::Utc>,
    pub schema_version: u32,
}

/// Acquire / write failures surfaced to the caller.
#[derive(Debug, Error)]
pub enum SessionLockError {
    #[error(
        "Another infinitecode instance is already active ({other_surface} pid {other_pid}). \
         Close it first, or remove {lock_path} if it is stale."
    )]
    Superseded {
        other_surface: Surface,
        other_pid: u32,
        lock_path: PathBuf,
    },
    #[error("failed to read session lock at {path}: {source}")]
    ReadFailed {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to write session lock at {path}: {source}")]
    WriteFailed {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("session lock JSON at {path} is corrupt: {source}")]
    InvalidJson {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },
}

/// RAII guard that owns the on-disk lock and removes it on `Drop` unless
/// `release()` was already called explicitly.
pub struct SessionLockGuard {
    path: PathBuf,
    released: bool,
}

impl SessionLockGuard {
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Explicitly removes the lock file from disk. Marking `released = true`
    /// ensures the destructor does not run a redundant `remove_file` syscall.
    pub fn release(mut self) -> Result<(), SessionLockError> {
        self.released = true;
        match fs::remove_file(&self.path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(source) => Err(SessionLockError::WriteFailed {
                path: self.path.clone(),
                source,
            }),
        }
    }
}

impl Drop for SessionLockGuard {
    fn drop(&mut self) {
        if !self.released {
            let _ = fs::remove_file(&self.path);
        }
    }
}

/// Canonical path the CLI binary and the Desktop app agree on. Both call this
/// resolver so they always look at (and write to) the same on-disk file.
///
/// Falls back to `<OS temp dir>/infinitecode/session.lock.json` when the OS
/// data dir cannot be resolved (sandboxed CI containers, chroots with
/// restricted `dirs::data_dir()` lookups, etc.). The fallback keeps the
/// process runnable but weakens cross-process scope to "user on this
/// machine, OS temp dir" — logged loudly so the user can see why.
pub fn session_lock_path() -> PathBuf {
    match infinitecode_util_paths::find_infinitecode_home() {
        Ok(home) => home.join("session.lock.json"),
        Err(error) => {
            tracing::warn!(
                error = %error,
                "could not resolve InfiniteCode data directory; falling back to OS temp dir; \
                 session lock will be process-local for the OS user"
            );
            let mut fallback = std::env::temp_dir();
            fallback.push("infinitecode");
            fallback.push("session.lock.json");
            fallback
        }
    }
}

/// Convenience: acquire the lock at the canonical path.
pub fn acquire(
    surface: Surface,
    session_id: Option<String>,
) -> Result<SessionLockGuard, SessionLockError> {
    let path = session_lock_path();
    acquire_at(&path, surface, session_id)
}

/// Acquire (write) the lock at `path`. If `path` already exists and points to a
/// live pid != us, returns [`SessionLockError::Superseded`]. A stale or
/// corrupt lock is best-effort cleaned up and replaced atomically.
pub fn acquire_at(
    path: &Path,
    surface: Surface,
    session_id: Option<String>,
) -> Result<SessionLockGuard, SessionLockError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| SessionLockError::WriteFailed {
            path: path.to_path_buf(),
            source,
        })?;
    }

    if path.exists() {
        match read_lock_at(path) {
            Ok(Some(existing)) => {
                if existing.pid == std::process::id() {
                    // Same process re-acquiring — idempotent. Return a Drop
                    // guard that is a no-op so the file isn't deleted between
                    // successive calls within this process.
                    tracing::debug!(
                        pid = existing.pid,
                        "session lock already held by this process"
                    );
                    return Ok(SessionLockGuard {
                        path: path.to_path_buf(),
                        released: true,
                    });
                }
                if is_pid_alive(existing.pid) {
                    return Err(SessionLockError::Superseded {
                        other_surface: existing.surface,
                        other_pid: existing.pid,
                        lock_path: path.to_path_buf(),
                    });
                }
                tracing::info!(
                    stale_pid = existing.pid,
                    "session lock was stale; replacing"
                );
                let _ = fs::remove_file(path);
            }
            Ok(None) => {}
            Err(error) => {
                // Corrupt or unreadable — best-effort cleanup; fall through
                // and replace atomically so the next writer wins.
                tracing::warn!(
                    path = %path.display(),
                    error = %error,
                    "could not parse existing session lock; replacing"
                );
                let _ = fs::remove_file(path);
            }
        }
    }

    write_new_lock_at(path, surface, session_id)?;
    tracing::debug!(
        path = %path.display(),
        surface = ?surface,
        pid = std::process::id(),
        "acquired session lock"
    );
    Ok(SessionLockGuard {
        path: path.to_path_buf(),
        released: false,
    })
}

fn read_lock_at(path: &Path) -> Result<Option<LockRecord>, SessionLockError> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(source) => {
            return Err(SessionLockError::ReadFailed {
                path: path.to_path_buf(),
                source,
            });
        }
    };
    match serde_json::from_slice::<LockRecord>(&bytes) {
        Ok(record) => Ok(Some(record)),
        Err(source) => Err(SessionLockError::InvalidJson {
            path: path.to_path_buf(),
            source,
        }),
    }
}

fn write_new_lock_at(
    path: &Path,
    surface: Surface,
    session_id: Option<String>,
) -> Result<(), SessionLockError> {
    let record = LockRecord {
        pid: std::process::id(),
        surface,
        session_id,
        started_at: chrono::Utc::now(),
        schema_version: 1,
    };
    let mut tmp = path.to_path_buf();
    tmp.set_extension("lock.json.tmp");
    let bytes =
        serde_json::to_vec_pretty(&record).map_err(|source| SessionLockError::WriteFailed {
            path: path.to_path_buf(),
            source: std::io::Error::other(source),
        })?;
    {
        let mut f = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&tmp)
            .map_err(|source| SessionLockError::WriteFailed {
                path: tmp.clone(),
                source,
            })?;
        f.write_all(&bytes)
            .map_err(|source| SessionLockError::WriteFailed {
                path: tmp.clone(),
                source,
            })?;
        f.sync_all()
            .map_err(|source| SessionLockError::WriteFailed {
                path: tmp.clone(),
                source,
            })?;
    }
    fs::rename(&tmp, path).map_err(|source| SessionLockError::WriteFailed {
        path: path.to_path_buf(),
        source,
    })?;
    Ok(())
}

/// CLI-side helper: acquire the lock or exit with a user-friendly message.
/// Use this in `fn main()` of the `infinitecode` binary. Matches the upstream
/// Codebuff `cli-engine/src/hooks/helpers/send-message.ts:600-612` UX where a
/// second CLI prints "Another infinitecode CLI took over this account. Close the
/// other instance, then restart."
pub fn ensure_single_cli_session_or_exit(session_id: Option<String>) {
    if let Err(error) = acquire(Surface::Cli, session_id) {
        match &error {
            SessionLockError::Superseded {
                other_surface,
                other_pid,
                lock_path,
            } => {
                eprintln!(
                    "infinitecode: another {surface} is already active (pid {pid}).\n\
                     Close it first, or remove the lock at {lock} if it is stale.",
                    surface = other_surface.as_str(),
                    pid = other_pid,
                    lock = lock_path.display(),
                );
                // 75 = EX_TEMPFAIL. Well-known "try again later" exit code so
                // shell wrappers (CI runs) can react differently from a hard crash.
                std::process::exit(75);
            }
            other => {
                eprintln!("infinitecode: session lock failure: {other}");
                std::process::exit(1);
            }
        }
    }
}

#[cfg(unix)]
fn is_pid_alive(pid: u32) -> bool {
    // `kill -0 PID` exits 0 if the process exists, 1 if not. Avoids adding a
    // direct `libc` dep just for this one syscall. Spawning /usr/bin/kill once
    // per shell startup is acceptable — the lock check is a one-shot path.
    let mut cmd = std::process::Command::new("kill");
    cmd.args(["-0", &pid.to_string()])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    cmd.status().map(|status| status.success()).unwrap_or(false)
}

#[cfg(windows)]
fn is_pid_alive(pid: u32) -> bool {
    // tasklist's LIST format emits one key/value line per row; "PID: <n>"
    // matches our pid exactly when the row exists. Detect the empty-result
    // banner ("INFO: No tasks are running...") explicitly.
    let mut cmd = std::process::Command::new("tasklist");
    cmd.args(["/FI", &format!("PID eq {}", pid), "/NH", "/FO", "LIST"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    match cmd.output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if stdout.contains("INFO: No tasks") {
                return false;
            }
            stdout.contains(&format!("PID: {}", pid))
        }
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    fn fresh_dir(label: &str) -> PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!(
            "infinitecode-session-lock-{label}-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn first_run_writes_lock_with_our_pid_and_surface() {
        let dir = fresh_dir("first-run");
        let path = dir.join("session.lock.json");

        let guard = acquire_at(&path, Surface::Cli, Some("sess-1".into())).unwrap();
        assert!(path.exists(), "lock file should be written");

        let record = read_lock_at(&path).unwrap().expect("written record exists");
        assert_eq!(record.pid, std::process::id());
        assert_eq!(record.surface, Surface::Cli);
        assert_eq!(record.session_id.as_deref(), Some("sess-1"));
        assert_eq!(record.schema_version, 1);

        drop(guard);
        assert!(!path.exists(), "Drop should remove the lock file");
    }

    #[test]
    fn reentrant_acquire_in_same_process_is_idempotent() {
        let dir = fresh_dir("reentrant");
        let path = dir.join("session.lock.json");

        let _g1 = acquire_at(&path, Surface::Desktop, None).unwrap();
        let g2 = acquire_at(&path, Surface::Desktop, None).unwrap();
        assert!(g2.released, "second acquire returns a released/no-op guard");
        assert!(path.exists(), "file still owned by g1");
    }

    #[test]
    fn explicit_release_is_idempotent_with_drop() {
        let dir = fresh_dir("release");
        let path = dir.join("session.lock.json");
        let guard = acquire_at(&path, Surface::Cli, None).unwrap();
        let file_already = path.exists();
        assert!(file_already);
        guard.release().unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn acquire_replaces_a_stale_dead_pid_lockfile() {
        let dir = fresh_dir("stale");
        let path = dir.join("session.lock.json");

        // A pid so large it's effectively never alive on any sane OS
        // (Linux kernel pid_max is 4194304 by default; Windows never recycles).
        let dead: u32 = u32::MAX - 7;
        let stale = LockRecord {
            pid: dead,
            surface: Surface::Cli,
            session_id: Some("ghost".into()),
            started_at: chrono::Utc::now(),
            schema_version: 1,
        };
        fs::write(&path, serde_json::to_vec_pretty(&stale).unwrap()).unwrap();
        assert!(
            !is_pid_alive(dead),
            "test fixture: dead pid is genuinely dead"
        );

        let guard = acquire_at(&path, Surface::Desktop, Some("fresh".into())).unwrap();
        let after = read_lock_at(&path).unwrap().expect("lock rewritten");
        assert_eq!(after.surface, Surface::Desktop);
        assert_eq!(after.session_id.as_deref(), Some("fresh"));
        assert_eq!(after.pid, std::process::id());
        drop(guard);
    }

    #[test]
    fn acquire_replaces_a_corrupt_lockfile() {
        let dir = fresh_dir("corrupt");
        let path = dir.join("session.lock.json");
        fs::write(&path, "not json at all").unwrap();

        let guard = acquire_at(&path, Surface::Cli, None).unwrap();
        let after = read_lock_at(&path).unwrap().expect("lock rewritten");
        assert_eq!(after.pid, std::process::id());
        assert_eq!(after.surface, Surface::Cli);
        drop(guard);
    }

    #[test]
    fn supersede_error_carries_other_pid_and_surface() {
        // Construct an in-memory Superseded error and check its fields.
        let path = PathBuf::from("/tmp/never-written/session.lock.json");
        let error = SessionLockError::Superseded {
            other_surface: Surface::Desktop,
            other_pid: 4242,
            lock_path: path.clone(),
        };
        match error {
            SessionLockError::Superseded {
                other_surface,
                other_pid,
                lock_path,
            } => {
                assert_eq!(other_surface, Surface::Desktop);
                assert_eq!(other_pid, 4242);
                assert_eq!(lock_path, path);
            }
            _ => panic!("expected Superseded variant"),
        }
    }

    #[test]
    fn session_lock_path_under_infinitecode_home() {
        let p = session_lock_path();
        assert!(
            p.ends_with("session.lock.json"),
            "lock path should end in session.lock.json; got {p:?}"
        );
        // find_infinitecode_home() resolves to an absolute OS-specific path;
        // we don't assert the prefix because it varies by platform.
    }
}
