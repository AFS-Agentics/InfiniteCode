/**
 * @infinitecode/configconv -- Universal agent configuration converter.
 *
 * Supports converting between Claude Code, InfiniteCode, and Cursor formats
 * using a hub-and-spoke architecture with a canonical intermediate representation.
 *
 * Primary API:
 *   scanFormat()         -> AnyScanResult              Discover config for any format
 *   universalConvert()   -> CanonicalConversionResult   Convert between any two formats
 *   universalWrite()     -> UniversalWriteResult        Write conversion results to disk
 *   toCanonical()        -> CanonicalScanResult         Normalize to intermediate form
 *   fromCanonical()      -> CanonicalConversionResult   Produce target format output
 *   formatName()         -> string                      Human-readable format name
 *
 * Format-specific scanners:
 *   scan()            -> ScanResult           Claude Code scanner
 *   scanCursor()      -> CursorScanResult     Cursor scanner
 *   scanInfiniteCode()    -> InfiniteCodeScanResult   InfiniteCode scanner
 *
 * Backup/restore:
 *   createBackup()  -> string | undefined
 *   listBackups()   -> BackupInfo[]
 *   restore()       -> RestoreResult
 *   deleteBackup()  -> void
 */

// ============================================================
// Universal converter API
// ============================================================

// ─── From-canonical converters ───────────────────────────────
export { canonicalToClaudeCode } from "./converter/from-canonical/to-claude-code"
export { canonicalToCursor } from "./converter/from-canonical/to-cursor"
export { canonicalToInfiniteCode } from "./converter/from-canonical/to-infinitecode"
// ─── To-canonical converters ─────────────────────────────────
export { claudeCodeToCanonical } from "./converter/to-canonical/claude-code"
export { cursorToCanonical } from "./converter/to-canonical/cursor"
export { openCodeToCanonical } from "./converter/to-canonical/infinitecode"
export type { AnyScanResult } from "./converter/universal"
export {
	formatName,
	fromCanonical,
	getSupportedConversions,
	toCanonical,
	universalConvert,
} from "./converter/universal"

// ============================================================
// Universal writer
// ============================================================

export type { UniversalWriteOptions, UniversalWriteResult } from "./writer/universal"
export { universalWrite } from "./writer/universal"

// ============================================================
// History converter + writer
// ============================================================

export {
	CLAUDE_CODE_PROVIDER_ID,
	CLAUDE_CODE_WIRE_API,
	extractClaudeCodeProviderSettings,
	formatClaudeCodeProviderSettingsPreview,
} from "./converter/claude-provider-settings"
export type { ClaudeCodeProviderSettings } from "./converter/claude-provider-settings"
export {
	OPENCODE_OPENAI_COMPATIBLE_NPM,
	OPENCODE_WIRE_API,
	extractOpenCodeProviderSettings,
	formatOpenCodeProviderSettingsPreview,
} from "./converter/opencode-provider-settings"
export type {
	OpenCodeImportedModel,
	OpenCodeImportedProvider,
	OpenCodeModelRef,
	OpenCodeProviderSettings,
	OpenCodeUnsupportedProvider,
} from "./converter/opencode-provider-settings"
export { convertCursorHistory } from "./converter/cursor-history"
export type { HistoryScanProgress } from "./scanner/cursor-history"
export type {
	HistoryWriteOptions,
	HistoryWriteProgress,
	HistoryWriteResult,
} from "./writer/history"
export { writeHistorySessions, writeHistorySessionsDetailed } from "./writer/history"

// ============================================================
// Scanners
// ============================================================

export type {
	CursorScanOptions,
	InfiniteCodeScanOptions,
	UniversalScanOptions,
} from "./scanner"
export { scan, scanCursor, scanFormat, scanInfiniteCode, scanOpenCode } from "./scanner"

// ============================================================
// Canonical types (format-agnostic)
// ============================================================

export type {
	AgentFormat,
	CanonicalAgentFile,
	CanonicalCommandFile,
	CanonicalConversionResult,
	CanonicalGlobalConfig,
	CanonicalMcpServer,
	CanonicalPermissionAction,
	CanonicalPermissions,
	CanonicalProjectConfig,
	CanonicalRulesFile,
	CanonicalScanResult,
	CanonicalSkillInfo,
	ConversionCategory,
	ConversionReport,
	ConversionReportItem,
	UniversalConvertOptions,
} from "./types/canonical"
export {
	createEmptyReport as createEmptyConversionReport,
	mergeReports as mergeConversionReports,
} from "./types/canonical"

// ============================================================
// Backup/restore
// ============================================================

export type { BackupFileEntry, BackupInfo, BackupManifest, RestoreResult } from "./backup"
export { createBackup, deleteBackup, listBackups, restore } from "./backup"

// ============================================================
// Format-specific types
// ============================================================

// ─── Claude Code types ───────────────────────────────────────
export type {
	ClaudeAgentFrontmatter,
	ClaudeHooks,
	ClaudeMcpJson,
	ClaudeMcpServer,
	ClaudePermissions,
	ClaudeProjectSettings,
	ClaudeSettings,
	ClaudeUserState,
} from "./types/claude-code"

// ─── Cursor types ────────────────────────────────────────────
export type {
	CursorAgentFile,
	CursorAgentFrontmatter,
	CursorAttachedFile,
	CursorBubble,
	CursorBubbleHeader,
	CursorCliConfig,
	CursorCommandFile,
	CursorComposerData,
	CursorComposerMeta,
	CursorGlobalScanResult,
	CursorHistoryMessage,
	CursorHistoryScanResult,
	CursorHistorySession,
	CursorMcpJson,
	CursorMcpServer,
	CursorModelConfig,
	CursorOAuth,
	CursorPermissions,
	CursorProjectScanResult,
	CursorRule,
	CursorRuleFrontmatter,
	CursorRuleMode,
	CursorScanResult,
	CursorSkillInfo,
	CursorThinkingBlock,
	CursorToolResult,
	CursorWorkspace,
} from "./types/cursor"
export { determineCursorRuleMode } from "./types/cursor"

// ─── InfiniteCode types ──────────────────────────────────────────
export type {
	InfiniteCodeAgentConfig,
	InfiniteCodeAgentFrontmatter,
	InfiniteCodeCommandFrontmatter,
	InfiniteCodeConfig,
	InfiniteCodeMcpLocal,
	InfiniteCodeMcpRemote,
	InfiniteCodePermission,
	InfiniteCodePermissionAction,
} from "./types/infinitecode"

// ─── OpenCode types ────────────────────────────────────────
export type {
	OpenCodeApiKeyConfig,
	OpenCodeAuth,
	OpenCodeConfig,
	OpenCodeGlobalScanResult,
	OpenCodeModelConfig,
	OpenCodeProviderConfig,
	OpenCodeProviderOptions,
	OpenCodeScanResult,
} from "./types/opencode"

// ─── Scan result types (Claude Code specific) ────────────────
export type {
	AgentFile,
	CommandFile,
	GlobalScanResult,
	HistoryScanResult,
	ProjectScanResult,
	ScanOptions,
	ScanResult,
	SkillInfo,
} from "./types/scan-result"
