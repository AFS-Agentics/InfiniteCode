import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export type Surface = "cli" | "desktop"

/**
 * JSON shape of the on-disk session lock file. Must stay in lockstep with
 * `infinitecode/crates/core/src/session_lock.rs::LockRecord`. New fields are
 * appended; existing fields are never renamed.
 */
export interface LockRecord {
	pid: number
	surface: Surface
	session_id: string | null
	started_at: string
	schema_version: number
}

/**
 * Detail block broadcast to Electron renderers when the host catches a
 * SessionSupersededError on the CLI / desktop boundary. The renderer reads
 * `otherPid`, `otherSurface`, and `lockPath` to populate the supersede
 * banner copy that mirrors InfiniteCode's "Another infinitecode CLI took over this
 * account" message.
 */
export interface SupersedeDetail {
	otherPid: number
	otherSurface: Surface
	lockPath: string
}

const SESSION_SUPERSEDED_CODE = "SESSION_SUPERSEDED" as const

/**
 * Thrown from `acquire` when another live process already owns the lock.
 * The IPC `infinitecode:ensure` handler catches this by code and forwards
 * `detail` over the `session:superseded` IPC channel so the renderer can
 * render the banner.
 */
export class SessionSupersededError extends Error {
	readonly code = SESSION_SUPERSEDED_CODE
	readonly detail: SupersedeDetail

	constructor(detail: SupersedeDetail) {
		super(
			`Another infinitecode instance is already active (${detail.otherSurface} pid ${detail.otherPid}). Close it first, or remove ${detail.lockPath} if it is stale.`,
		)
		this.name = "SessionSupersededError"
		this.detail = detail
	}
}

/**
 * Canonical lock path. Mirrors
 * `infinitecode/crates/core/src/session_lock.rs::session_lock_path()`. We do
 * NOT use `app.getPath("userData")` because Electron prefixes the userData
 * dir with the app name (e.g. `infinitecode Desktop ...`) which would put the
 * CLI and Desktop on different lock files — the whole point is that they share.
 */
export function sessionLockPath(): string {
	const dataDir = platformDataDir()
	return path.join(dataDir, "infinitecode", "session.lock.json")
}

function platformDataDir(): string {
	switch (process.platform) {
		case "darwin":
			return path.join(os.homedir(), "Library", "Application Support")
		case "win32":
			return process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming")
		default:
			return (
				process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share")
			)
	}
}

export function readLock(): LockRecord | null {
	const p = sessionLockPath()
	try {
		const raw = fs.readFileSync(p, "utf8")
		const parsed = JSON.parse(raw) as Partial<LockRecord>
		// Coerce partial / older records defensively. Older writes may not have
		// `schema_version`; treat that as `0` so the parse doesn't blow up older
		// upgrades mid-rollout.
		if (typeof parsed.pid !== "number") return null
		return {
			pid: parsed.pid,
			surface:
				parsed.surface === "desktop" || parsed.surface === "cli"
					? parsed.surface
					: "cli",
			session_id:
				typeof parsed.session_id === "string" ? parsed.session_id : null,
			started_at:
				typeof parsed.started_at === "string"
					? parsed.started_at
					: new Date(0).toISOString(),
			schema_version:
				typeof parsed.schema_version === "number" ? parsed.schema_version : 0,
		}
	} catch (err: unknown) {
		const code = (err as NodeJS.ErrnoException | undefined)?.code
		if (code === "ENOENT") return null
		// Corrupt JSON (`SyntaxError`) or other read errors → treat as absent
		// so acquire() can replace the file atomically.
		return null
	}
}

function isPidAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false
	try {
		// process.kill with signal 0 is the canonical Node.js liveness probe.
		// Throws ESRCH when the pid does not exist; throws EPERM when the pid
		// exists but the OS forbids signaling — both confirm "exists", so we
		// return true on EPERM.
		process.kill(pid, 0)
		return true
	} catch (err: unknown) {
		const code = (err as NodeJS.ErrnoException | undefined)?.code
		return code === "EPERM"
	}
}

function writeNewLock(surface: Surface, sessionId: string | null): LockRecord {
	const finalPath = sessionLockPath()
	const tmpPath = `${finalPath}.tmp`
	const record: LockRecord = {
		pid: process.pid,
		surface,
		session_id: sessionId,
		started_at: new Date().toISOString(),
		schema_version: 1,
	}
	fs.mkdirSync(path.dirname(finalPath), { recursive: true })
	fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2))
	fs.renameSync(tmpPath, finalPath)
	return record
}

/**
 * Acquire the cross-session lock for the Electron desktop process. Idempotent
 * within a single process (a second call returns the existing record without
 * rewriting it). Throws `SessionSupersededError` when another live process
 * already holds it.
 *
 * Unlike the Rust module we deliberately do NOT return a guard — the Electron
 * main process owns the lock for its full lifetime (until quit), so the
 * release call is wired into `stopServer` in `infinitecode-manager.ts` rather
 * than bound to a Drop ergonomics.
 */
export function acquire(surface: Surface, sessionId: string | null): LockRecord {
	const existing = readLock()
	if (existing) {
		if (existing.pid === process.pid) {
			return existing
		}
		if (isPidAlive(existing.pid)) {
			throw new SessionSupersededError({
				otherPid: existing.pid,
				otherSurface: existing.surface,
				lockPath: sessionLockPath(),
			})
		}
		// Stale: best-effort cleanup before writing fresh.
		try {
			fs.unlinkSync(sessionLockPath())
		} catch {
			// already gone or unlinkable; writable atomically anyway
		}
	}
	return writeNewLock(surface, sessionId)
}

/**
 * Remove the lock file. Idempotent — ENOENT is swallowed because the user's
 * intent (release) is satisfied when the file is gone, regardless of how.
 */
export function release(): void {
	try {
		fs.unlinkSync(sessionLockPath())
	} catch (err: unknown) {
		const code = (err as NodeJS.ErrnoException | undefined)?.code
		if (code !== "ENOENT") throw err
	}
}

export { SESSION_SUPERSEDED_CODE }
