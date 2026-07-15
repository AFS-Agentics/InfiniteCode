/**
 * Main scanner entry point.
 *
 * Discovers configuration files for all supported agent formats:
 * - Claude Code: ~/.claude/, legacy ~/.Claude/, ~/.claude.json, .claude/, .mcp.json, CLAUDE.md
 * - InfiniteCode: ~/.config/infinitecode/, .infinitecode/, infinitecode.json, AGENTS.md
 * - Cursor: ~/.cursor/, .cursor/, .cursorrules
 * - OpenCode: ~/.config/opencode/opencode.json, opencode.jsonc, auth.json
 */

import type { InfiniteCodeScanResult } from "../converter/to-canonical/infinitecode"
import type { AgentFormat } from "../types/canonical"
import type { CursorScanResult } from "../types/cursor"
import type { OpenCodeScanResult } from "../types/opencode"
import type { ScanOptions, ScanResult } from "../types/scan-result"
import { scanGlobal, scanHistory, scanProject } from "./claude-config"
import { scanCursorGlobal, scanCursorProject } from "./cursor-config"
import { scanCursorHistory } from "./cursor-history"
import { scanInfiniteCodeGlobal, scanInfiniteCodeProject } from "./infinitecode-config"
import { scanOpenCode } from "./opencode-config"

export { scanOpenCode } from "./opencode-config"

// ============================================================
// Claude Code scanner (preserved for backwards compatibility)
// ============================================================

/**
 * Scan for Claude Code configuration files.
 *
 * @param options - What to scan (global, specific project, history)
 * @returns Structured scan result with all discovered config data
 */
export async function scan(options: ScanOptions = {}): Promise<ScanResult> {
	const { global: scanGlobalConfig = true, project, includeHistory = false, since } = options

	const result: ScanResult = {
		global: { skills: [] },
		projects: [],
	}

	// Scan global config
	if (scanGlobalConfig) {
		result.global = await scanGlobal()
	}

	// Scan project(s)
	if (project) {
		const projectResult = await scanProject(project, result.global.userState)
		result.projects.push(projectResult)
	} else if (result.global.userState?.projects) {
		// Scan all known projects from ~/.claude.json
		const projectPaths = Object.keys(result.global.userState.projects)
		for (const projectPath of projectPaths) {
			const projectResult = await scanProject(projectPath, result.global.userState)
			result.projects.push(projectResult)
		}
	}

	// Scan history
	if (includeHistory) {
		result.history = await scanHistory(since)
	}

	return result
}

// ============================================================
// Cursor scanner
// ============================================================

export interface CursorScanOptions {
	/** Scan global Cursor config (~/.cursor/) */
	global?: boolean
	/** Scan specific project path */
	project?: string
	/** Include chat history from state.vscdb databases */
	includeHistory?: boolean
	/** Only import history since this date */
	since?: Date
}

/**
 * Scan for Cursor IDE configuration files.
 */
export async function scanCursor(options: CursorScanOptions = {}): Promise<CursorScanResult> {
	const { global: scanGlobalConfig = true, project, includeHistory = false, since } = options

	const result: CursorScanResult = {
		global: { skills: [], commands: [], agents: [] },
		projects: [],
	}

	if (scanGlobalConfig) {
		result.global = await scanCursorGlobal()
	}

	if (project) {
		const projectResult = await scanCursorProject(project)
		result.projects.push(projectResult)
	}

	if (includeHistory) {
		result.history = await scanCursorHistory(since)
	}

	return result
}

// ============================================================
// InfiniteCode scanner
// ============================================================

export interface InfiniteCodeScanOptions {
	/** Scan global InfiniteCode config (~/.config/infinitecode/) */
	global?: boolean
	/** Scan specific project path */
	project?: string
}

/**
 * Scan for InfiniteCode configuration files.
 */
export async function scanInfiniteCode(options: InfiniteCodeScanOptions = {}): Promise<InfiniteCodeScanResult> {
	const { global: scanGlobalConfig = true, project } = options

	const result: InfiniteCodeScanResult = {
		global: { agents: [], commands: [], skills: [] },
		projects: [],
	}

	if (scanGlobalConfig) {
		result.global = await scanInfiniteCodeGlobal()
	}

	if (project) {
		const projectResult = await scanInfiniteCodeProject(project)
		result.projects.push(projectResult)
	}

	return result
}

// ============================================================
// Universal scanner
// ============================================================

export interface UniversalScanOptions {
	/** Which format to scan */
	format: AgentFormat | "opencode"
	/** Scan global config */
	global?: boolean
	/** Scan specific project path */
	project?: string
	/** Include session history (Claude Code, Cursor) */
	includeHistory?: boolean
	/** Only import history since this date (Claude Code, Cursor) */
	since?: Date
}

/**
 * Scan for configuration files of a specific format.
 */
export async function scanFormat(
	options: UniversalScanOptions,
): Promise<
	| { format: "claude-code"; data: ScanResult }
	| { format: "infinitecode"; data: InfiniteCodeScanResult }
	| { format: "cursor"; data: CursorScanResult }
	| { format: "opencode"; data: OpenCodeScanResult }
> {
	switch (options.format) {
		case "claude-code": {
			const data = await scan({
				global: options.global,
				project: options.project,
				includeHistory: options.includeHistory,
				since: options.since,
			})
			return { format: "claude-code", data }
		}
		case "infinitecode": {
			const data = await scanInfiniteCode({
				global: options.global,
				project: options.project,
			})
			return { format: "infinitecode", data }
		}
		case "cursor": {
			const data = await scanCursor({
				global: options.global,
				project: options.project,
				includeHistory: options.includeHistory,
				since: options.since,
			})
			return { format: "cursor", data }
		}
		case "opencode": {
			const data = options.global === false ? { global: { parseErrors: [] } } : await scanOpenCode()
			return { format: "opencode", data }
		}
	}
}
