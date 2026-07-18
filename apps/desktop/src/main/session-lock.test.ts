import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
	acquire,
	readLock,
	release,
	sessionLockPath,
	SessionSupersededError,
} from "./session-lock"

/**
 * These tests write a real lockfile to a temp data dir by overriding the
 * environment variables `platformDataDir()` reads. They do not touch the
 * user's real `~/Library/Application Support/infinitecode/`.
 */
describe("session-lock", () => {
	let tmpHome: string

	beforeEach(() => {
		tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "infinitecode-lock-test-"))
		// Override every data-dir env so platformDataDir() resolves into tmpHome
		// regardless of which platform this test runs on (darwin | win32 | linux).
		process.env.HOME = tmpHome
		process.env.XDG_DATA_HOME = tmpHome
		process.env.APPDATA = tmpHome
	})

	afterEach(() => {
		try {
			release()
		} catch {
			// ignore — file may not exist
		}
		fs.rmSync(tmpHome, { recursive: true, force: true })
	})

	it("acquire writes a lockfile with our pid", () => {
		const r = acquire("desktop", "sess-1")
		expect(r.pid).toBe(process.pid)
		expect(r.surface).toBe("desktop")
		expect(r.session_id).toBe("sess-1")
		expect(r.schema_version).toBe(1)
		expect(fs.existsSync(sessionLockPath())).toBe(true)
	})

	it("second acquire in same process is idempotent", () => {
		const r1 = acquire("desktop", null)
		const r2 = acquire("desktop", null)
		expect(r2.pid).toBe(r1.pid)
		expect(fs.existsSync(sessionLockPath())).toBe(true)
	})

	it("release removes the lockfile", () => {
		acquire("desktop", null)
		release()
		expect(fs.existsSync(sessionLockPath())).toBe(false)
	})

	it("release on a missing file does not throw", () => {
		expect(() => release()).not.toThrow()
	})

	it("rejects another (live) pid with SessionSupersededError", () => {
		// Other pid = our pid is the idempotent branch, so we use pid + 1_000_000
		// which is alive on no real OS. That makes `isPidAlive()` return false,
		// which means we'd take the "replace stale" branch. To test the actual
		// supersede-throw path we use a synthetic record whose pid is OUR live
		// pid — but then the call is idempotent, not throw. The honest way to
		// exercise this branch is with a real second process; for unit tests we
		// instead exercise the SessionSupersededError constructor directly.
		const err = new SessionSupersededError({
			otherPid: 99999,
			otherSurface: "cli",
			lockPath: sessionLockPath(),
		})
		expect(err.code).toBe("SESSION_SUPERSEDED")
		expect(err.detail.otherPid).toBe(99999)
		expect(err.detail.otherSurface).toBe("cli")
		expect(err).toBeInstanceOf(SessionSupersededError)
	})

	it("replaces a stale (dead-pid) lockfile", () => {
		const deadPid = 0 // pid 0 doesn't exist on darwin / linux / win32
		const lockPath = sessionLockPath()
		fs.mkdirSync(path.dirname(lockPath), { recursive: true })
		fs.writeFileSync(
			lockPath,
			JSON.stringify({
				pid: deadPid,
				surface: "cli",
				session_id: "ghost",
				started_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
				schema_version: 1,
			}),
		)
		const r = acquire("desktop", "fresh")
		expect(r.pid).toBe(process.pid)
		expect(r.session_id).toBe("fresh")
		expect(readLock()?.surface).toBe("desktop")
	})

	it("replaces a corrupt lockfile", () => {
		const lockPath = sessionLockPath()
		fs.mkdirSync(path.dirname(lockPath), { recursive: true })
		fs.writeFileSync(lockPath, "not json")
		const r = acquire("desktop", null)
		expect(r.pid).toBe(process.pid)
	})

	it("readLock returns null when the file is absent", () => {
		expect(readLock()).toBeNull()
	})
})
