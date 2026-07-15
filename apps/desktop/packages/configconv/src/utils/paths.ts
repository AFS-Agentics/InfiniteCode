/**
 * Path resolution utilities for Claude Code and InfiniteCode config locations.
 * Handles platform differences and XDG base directories.
 */
import { homedir } from "node:os"
import { join } from "node:path"

const home = homedir()

// ─── Claude Code Paths ───────────────────────────────────────────────

/** ~/.claude/settings.json */
export function ccSettingsPath(): string {
	return ccSettingsPaths()[0]
}

/** Legacy ~/.Claude/settings.json */
export function ccLegacySettingsPath(): string {
	return join(home, ".Claude", "settings.json")
}

/** Claude Code settings paths, in preference order. */
export function ccSettingsPaths(): string[] {
	return [join(home, ".claude", "settings.json"), ccLegacySettingsPath()]
}

/** ~/.claude.json */
export function ccUserStatePath(): string {
	return join(home, ".claude.json")
}

/** ~/.Claude/skills/ */
export function ccGlobalSkillsDir(): string {
	return join(home, ".Claude", "skills")
}

/** ~/.agents/skills/ (shared between CC and OC) */
export function sharedAgentsSkillsDir(): string {
	return join(home, ".agents", "skills")
}

/** ~/.claude/CLAUDE.md (global rules -- note lowercase .claude) */
export function ccGlobalClaudeMdPath(): string {
	return join(home, ".claude", "CLAUDE.md")
}

/** ~/.Claude/history.jsonl */
export function ccHistoryPath(): string {
	return join(home, ".Claude", "history.jsonl")
}

/** ~/.Claude/projects/ */
export function ccProjectsDir(): string {
	return join(home, ".Claude", "projects")
}

/**
 * Mangle a project path to the Claude Code directory name format.
 * /Users/foo/project -> -Users-foo-project
 */
export function ccManglePath(projectPath: string): string {
	return projectPath.replace(/\//g, "-")
}

/** Get the session storage directory for a project */
export function ccProjectSessionDir(projectPath: string): string {
	return join(ccProjectsDir(), ccManglePath(projectPath))
}

/** Project-level .claude/settings.local.json */
export function ccProjectSettingsPath(projectPath: string): string {
	return join(projectPath, ".claude", "settings.local.json")
}

/** Project-level .mcp.json */
export function ccProjectMcpJsonPath(projectPath: string): string {
	return join(projectPath, ".mcp.json")
}

/** Project-level .claude/agents/ */
export function ccProjectAgentsDir(projectPath: string): string {
	return join(projectPath, ".claude", "agents")
}

/** Project-level .claude/commands/ */
export function ccProjectCommandsDir(projectPath: string): string {
	return join(projectPath, ".claude", "commands")
}

/** Project-level .claude/skills/ */
export function ccProjectSkillsDir(projectPath: string): string {
	return join(projectPath, ".claude", "skills")
}

/** CLAUDE.md at project root */
export function ccProjectClaudeMdPath(projectPath: string): string {
	return join(projectPath, "CLAUDE.md")
}

/** AGENTS.md at project root */
export function projectAgentsMdPath(projectPath: string): string {
	return join(projectPath, "AGENTS.md")
}

// ─── InfiniteCode Paths ──────────────────────────────────────────────────

/** ~/.config/infinitecode/infinitecode.json */
export function ocGlobalConfigPath(): string {
	const xdgConfig = process.env.XDG_CONFIG_HOME || join(home, ".config")
	return join(xdgConfig, "infinitecode", "infinitecode.json")
}

/** ~/.config/infinitecode/ */
export function ocGlobalConfigDir(): string {
	const xdgConfig = process.env.XDG_CONFIG_HOME || join(home, ".config")
	return join(xdgConfig, "infinitecode")
}

/** ~/.config/infinitecode/backups/ */
export function ocBackupsDir(): string {
	return join(ocGlobalConfigDir(), "backups")
}

/** ~/.config/infinitecode/AGENTS.md */
export function ocGlobalAgentsMdPath(): string {
	return join(ocGlobalConfigDir(), "AGENTS.md")
}

/** ~/.config/infinitecode/skills/ */
export function ocGlobalSkillsDir(): string {
	return join(ocGlobalConfigDir(), "skills")
}

/** ~/.config/infinitecode/commands/ */
export function ocGlobalCommandsDir(): string {
	return join(ocGlobalConfigDir(), "commands")
}

/** ~/.config/infinitecode/agents/ */
export function ocGlobalAgentsDir(): string {
	return join(ocGlobalConfigDir(), "agents")
}

/** ~/.config/infinitecode/plugins/ */
export function ocGlobalPluginsDir(): string {
	return join(ocGlobalConfigDir(), "plugins")
}

/** ~/.local/share/infinitecode/ */
export function ocDataDir(): string {
	const xdgData = process.env.XDG_DATA_HOME || join(home, ".local", "share")
	return join(xdgData, "infinitecode")
}

/** ~/.local/share/infinitecode/storage/ (legacy flat-file storage, pre-v1.2.0) */
export function ocStorageDir(): string {
	return join(ocDataDir(), "storage")
}

/** ~/.local/share/infinitecode/infinitecode.db (SQLite database, v1.2.0+) */
export function ocDatabasePath(): string {
	return join(ocDataDir(), "infinitecode.db")
}

/** ~/.local/state/infinitecode/ */
export function ocStateDir(): string {
	const xdgState = process.env.XDG_STATE_HOME || join(home, ".local", "state")
	return join(xdgState, "infinitecode")
}

/** ~/.local/state/infinitecode/prompt-history.jsonl */
export function ocPromptHistoryPath(): string {
	return join(ocStateDir(), "prompt-history.jsonl")
}

/** Project-level infinitecode.json */
export function ocProjectConfigPath(projectPath: string): string {
	return join(projectPath, "infinitecode.json")
}

/** Project-level .infinitecode/agents/ */
export function ocProjectAgentsDir(projectPath: string): string {
	return join(projectPath, ".infinitecode", "agents")
}

/** Project-level .infinitecode/commands/ */
export function ocProjectCommandsDir(projectPath: string): string {
	return join(projectPath, ".infinitecode", "commands")
}

/** Project-level .infinitecode/skills/ */
export function ocProjectSkillsDir(projectPath: string): string {
	return join(projectPath, ".infinitecode", "skills")
}

/** Project-level .infinitecode/plugins/ */
export function ocProjectPluginsDir(projectPath: string): string {
	return join(projectPath, ".infinitecode", "plugins")
}

/** Project-level AGENTS.md */
export function ocProjectAgentsMdPath(projectPath: string): string {
	return join(projectPath, "AGENTS.md")
}

// ─── OpenCode Paths ─────────────────────────────────────────────────

/** ~/.config/opencode/ */
export function opencodeConfigDir(): string {
	const xdgConfig = process.env.XDG_CONFIG_HOME || join(home, ".config")
	return join(xdgConfig, "opencode")
}

/** ~/.config/opencode/opencode.json */
export function opencodeConfigPath(): string {
	return join(opencodeConfigDir(), "opencode.json")
}

/** ~/.config/opencode/opencode.jsonc */
export function opencodeJsoncConfigPath(): string {
	return join(opencodeConfigDir(), "opencode.jsonc")
}

/** ~/.local/share/opencode/auth.json */
export function opencodeAuthPath(): string {
	const xdgData = process.env.XDG_DATA_HOME || join(home, ".local", "share")
	return join(xdgData, "opencode", "auth.json")
}

// ─── Cursor Paths ────────────────────────────────────────────────────

/** ~/.cursor/ */
export function cursorGlobalDir(): string {
	return join(home, ".cursor")
}

/** ~/.cursor/mcp.json */
export function cursorGlobalMcpJsonPath(): string {
	return join(cursorGlobalDir(), "mcp.json")
}

/** ~/.cursor/cli-config.json */
export function cursorCliConfigPath(): string {
	return join(cursorGlobalDir(), "cli-config.json")
}

/** ~/.cursor/skills/ */
export function cursorGlobalSkillsDir(): string {
	return join(cursorGlobalDir(), "skills")
}

/** ~/.cursor/commands/ */
export function cursorGlobalCommandsDir(): string {
	return join(cursorGlobalDir(), "commands")
}

/** ~/.cursor/agents/ */
export function cursorGlobalAgentsDir(): string {
	return join(cursorGlobalDir(), "agents")
}

/** Project-level .cursor/mcp.json */
export function cursorProjectMcpJsonPath(projectPath: string): string {
	return join(projectPath, ".cursor", "mcp.json")
}

/** Project-level .cursor/rules/ */
export function cursorProjectRulesDir(projectPath: string): string {
	return join(projectPath, ".cursor", "rules")
}

/** Project-level .cursor/agents/ */
export function cursorProjectAgentsDir(projectPath: string): string {
	return join(projectPath, ".cursor", "agents")
}

/** Project-level .cursor/commands/ */
export function cursorProjectCommandsDir(projectPath: string): string {
	return join(projectPath, ".cursor", "commands")
}

/** Project-level .cursor/skills/ */
export function cursorProjectSkillsDir(projectPath: string): string {
	return join(projectPath, ".cursor", "skills")
}

/** Project-level .cursorrules (legacy) */
export function cursorProjectLegacyRulesPath(projectPath: string): string {
	return join(projectPath, ".cursorrules")
}

// ─── Cursor Workspace Storage Paths ──────────────────────────────────

/**
 * Base directory for Cursor workspace storage.
 * Platform-specific:
 * - macOS: ~/Library/Application Support/Cursor/User/workspaceStorage/
 * - Linux: ~/.config/Cursor/User/workspaceStorage/
 * - Windows: %APPDATA%/Cursor/User/workspaceStorage/
 */
export function cursorWorkspaceStorageDir(): string {
	const platform = process.platform
	if (platform === "darwin") {
		return join(home, "Library", "Application Support", "Cursor", "User", "workspaceStorage")
	}
	if (platform === "win32") {
		const appData = process.env.APPDATA || join(home, "AppData", "Roaming")
		return join(appData, "Cursor", "User", "workspaceStorage")
	}
	// Linux
	const configDir = process.env.XDG_CONFIG_HOME || join(home, ".config")
	return join(configDir, "Cursor", "User", "workspaceStorage")
}

/**
 * Global state.vscdb for Cursor (stores full conversation data in cursorDiskKV table).
 * Platform-specific:
 * - macOS: ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb
 * - Linux: ~/.config/Cursor/User/globalStorage/state.vscdb
 * - Windows: %APPDATA%/Cursor/User/globalStorage/state.vscdb
 */
export function cursorGlobalStateDbPath(): string {
	const platform = process.platform
	if (platform === "darwin") {
		return join(
			home,
			"Library",
			"Application Support",
			"Cursor",
			"User",
			"globalStorage",
			"state.vscdb",
		)
	}
	if (platform === "win32") {
		const appData = process.env.APPDATA || join(home, "AppData", "Roaming")
		return join(appData, "Cursor", "User", "globalStorage", "state.vscdb")
	}
	// Linux
	const configDir = process.env.XDG_CONFIG_HOME || join(home, ".config")
	return join(configDir, "Cursor", "User", "globalStorage", "state.vscdb")
}

/** workspace.json inside a specific workspace hash directory */
export function cursorWorkspaceJsonPath(hashDir: string): string {
	return join(hashDir, "workspace.json")
}

/** state.vscdb inside a specific workspace hash directory */
export function cursorWorkspaceStateDbPath(hashDir: string): string {
	return join(hashDir, "state.vscdb")
}
