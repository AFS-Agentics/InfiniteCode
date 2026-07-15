/**
 * InfiniteCode runtime version compatibility definitions for Desktop.
 *
 * Updated with each release to reflect tested versions.
 * The environment check in the onboarding flow uses these ranges to
 * decide whether to pass, warn, or block.
 */

import { execFile } from "node:child_process"
import { homedir } from "node:os"
import path from "node:path"
import { coerce, satisfies, valid } from "semver"
import { createLogger } from "./logger"

const log = createLogger("compatibility")

// ============================================================
// Compatibility ranges (standard semver range syntax)
// ============================================================

export const INFINITECODE_COMPAT = {
	/** Supported range -- versions that should work. Below this: hard block. */
	supported: ">=0.1.21",
	/** Tested range -- versions actively tested against. Subset of supported. */
	tested: ">=0.1.21",
	/** Known-broken versions. These are hard-blocked with a specific message. */
	blocked: [] as string[],
}

// ============================================================
// Types
// ============================================================

export interface InfiniteCodeCheckResult {
	installed: boolean
	version: string | null
	path: string | null
	compatible: boolean
	compatibility: "ok" | "too-old" | "too-new" | "blocked" | "unknown"
	message: string | null
}

export type ExecFileForCheck = (
	cmd: string,
	args: string[],
	options: { env: Record<string, string | undefined>; timeout: number },
	callback: (err: Error | null, stdout: string) => void,
) => void

export interface CheckInfiniteCodeProgramOptions {
	program: string
	env?: Record<string, string | undefined>
	execFile?: ExecFileForCheck
}

// ============================================================
// Binary detection
// ============================================================

/** Build the augmented PATH that includes ~/.infinitecode/bin. */
function getAugmentedPath(): string {
	const infinitecodeBinDir = path.join(homedir(), ".infinitecode", "bin")
	const sep = process.platform === "win32" ? ";" : ":"
	return `${infinitecodeBinDir}${sep}${process.env.PATH ?? ""}`
}

/** Run a command and return stdout, or null on failure. */
function execAsync(
	cmd: string,
	args: string[],
	env: Record<string, string | undefined>,
	execFileImpl: ExecFileForCheck = execFile as unknown as ExecFileForCheck,
): Promise<string | null> {
	return new Promise((resolve) => {
		execFileImpl(cmd, args, { env, timeout: 30_000 }, (err, stdout) => {
			if (err) {
				resolve(null)
				return
			}
			resolve(stdout.trim())
		})
	})
}

/** Try to find the infinitecode binary and get its version. */
async function detectInfiniteCode(): Promise<{ version: string | null; path: string | null }> {
	const augmentedPath = getAugmentedPath()
	const env = { ...process.env, PATH: augmentedPath }

	// Try `infinitecode --version`
	const versionOutput = await execAsync("infinitecode", ["--version"], env)
	if (versionOutput) {
		// Parse version from output
		const match = versionOutput.match(/v?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/)
		const version = match ? match[1] : versionOutput.trim()

		// Try to find the path with `which` or `where`
		const whichCmd = process.platform === "win32" ? "where" : "which"
		const binaryPath = await execAsync(whichCmd, ["infinitecode"], env)

		return { version, path: binaryPath }
	}

	// Fallback: check if the binary exists at all (might not support --version)
	const whichCmd = process.platform === "win32" ? "where" : "which"
	const binaryPath = await execAsync(whichCmd, ["infinitecode"], env)
	if (binaryPath) {
		return { version: "unknown", path: binaryPath }
	}

	return { version: null, path: null }
}

// ============================================================
// Public API
// ============================================================

/**
 * Check whether InfiniteCode is installed and compatible with this version of InfiniteCode.
 * Runs the binary to get its version, then compares against the compatibility range.
 */
export async function checkInfiniteCode(): Promise<InfiniteCodeCheckResult> {
	log.info("Checking InfiniteCode CLI installation...")

	const { version, path: binaryPath } = await detectInfiniteCode()

	if (!version) {
		log.warn("InfiniteCode CLI not found")
		return {
			installed: false,
			version: null,
			path: null,
			compatible: false,
			compatibility: "unknown",
			message: "InfiniteCode CLI not found. Install it from https://github.com/7df-lab/infinitecode",
		}
	}

	log.info("InfiniteCode CLI found", { version, path: binaryPath })

	return compatibilityResult(version, binaryPath)
}

export async function checkInfiniteCodeProgram({
	program,
	env = process.env,
	execFile: execFileImpl,
}: CheckInfiniteCodeProgramOptions): Promise<InfiniteCodeCheckResult> {
	log.info("Checking InfiniteCode runtime...", { program })
	const versionOutput = await execAsync(program, ["--version"], env, execFileImpl)
	if (!versionOutput) {
		return {
			installed: false,
			version: null,
			path: program,
			compatible: false,
			compatibility: "unknown",
			message: `InfiniteCode runtime not found at ${program}`,
		}
	}

	const version = parseInfiniteCodeVersion(versionOutput)
	log.info("InfiniteCode runtime found", { version, path: program })
	return compatibilityResult(version, program)
}

function parseInfiniteCodeVersion(versionOutput: string): string {
	const match = versionOutput.match(/v?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/)
	return match ? match[1] : versionOutput.trim()
}

function compatibilityResult(version: string, binaryPath: string | null): InfiniteCodeCheckResult {
	// Coerce loose version strings (e.g. "1.3" -> "1.3.0") into valid semver.
	// Non-semver versions (e.g. "local", "dev", "unknown") are assumed compatible --
	// these are typically local/dev builds where the user knows what they're doing.
	const parsed = valid(version) ?? coerce(version)?.version ?? null
	if (!parsed) {
		log.info("Non-semver version detected, assuming compatible", { version })
		return {
			installed: true,
			version,
			path: binaryPath,
			compatible: true,
			compatibility: "ok",
			message: null,
		}
	}

	// Check blocked versions
	for (const blocked of INFINITECODE_COMPAT.blocked) {
		if (satisfies(parsed, blocked)) {
			return {
				installed: true,
				version,
				path: binaryPath,
				compatible: false,
				compatibility: "blocked",
				message: `InfiniteCode CLI ${version} has known issues with this version. Please update.`,
			}
		}
	}

	// Check supported range -- hard block if below minimum
	if (!satisfies(parsed, INFINITECODE_COMPAT.supported)) {
		return {
			installed: true,
			version,
			path: binaryPath,
			compatible: false,
			compatibility: "too-old",
			message: `InfiniteCode CLI ${version} is too old. Requires ${INFINITECODE_COMPAT.supported}.`,
		}
	}

	// Check tested range -- supported but newer than what we've tested against
	if (!satisfies(parsed, INFINITECODE_COMPAT.tested)) {
		return {
			installed: true,
			version,
			path: binaryPath,
			compatible: true,
			compatibility: "too-new",
			message: `InfiniteCode CLI ${version} is newer than tested. Tested with ${INFINITECODE_COMPAT.tested}. Some features may not work as expected.`,
		}
	}

	// Within the tested range -- fully compatible
	return {
		installed: true,
		version,
		path: binaryPath,
		compatible: true,
		compatibility: "ok",
		message: null,
	}
}
