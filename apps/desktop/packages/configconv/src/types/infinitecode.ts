/**
 * InfiniteCode type definitions.
 *
 * Re-exports canonical types from @infinitecode-ai/sdk where available,
 * and defines local aliases for convenience in the converter.
 */

// ─── Re-exports from SDK ─────────────────────────────────────────────
// These are the authoritative types generated from the InfiniteCode OpenAPI spec.

export type {
	// Agent (runtime, from server)
	Agent as InfiniteCodeAgent,
	// Agent (config-time)
	AgentConfig as InfiniteCodeAgentConfig,
	AgentPart as InfiniteCodeAgentPart,
	AssistantMessage as InfiniteCodeAssistantMessage,
	// Commands
	Command as InfiniteCodeCommand,
	CompactionPart as InfiniteCodeCompactionPart,
	// Top-level config
	Config as InfiniteCodeConfig,
	// Events (v1.2.0+)
	EventMessagePartDelta as InfiniteCodePartDelta,
	FilePart as InfiniteCodeFilePart,
	// MCP
	McpLocalConfig as InfiniteCodeMcpLocal,
	McpOAuthConfig as InfiniteCodeMcpOAuth,
	McpRemoteConfig as InfiniteCodeMcpRemote,
	Message as InfiniteCodeMessage,
	// Models
	Model as InfiniteCodeModel,
	Part as InfiniteCodePart,
	PatchPart as InfiniteCodePatchPart,
	// Permissions (runtime format)
	PermissionAction,
	PermissionActionConfig as InfiniteCodePermissionAction,
	// Permissions (config-time format)
	PermissionConfig as InfiniteCodePermission,
	PermissionObjectConfig as InfiniteCodePermissionObject,
	PermissionRule,
	PermissionRuleConfig as InfiniteCodePermissionRule,
	PermissionRuleset,
	Provider as InfiniteCodeProvider,
	// Provider
	ProviderConfig as InfiniteCodeProviderConfig,
	ReasoningPart as InfiniteCodeReasoningPart,
	RetryPart as InfiniteCodeRetryPart,
	// Server config
	ServerConfig as InfiniteCodeServerConfig,
	// Session / Messages / Parts
	Session as InfiniteCodeSession,
	SnapshotPart as InfiniteCodeSnapshotPart,
	StepFinishPart as InfiniteCodeStepFinishPart,
	StepStartPart as InfiniteCodeStepStartPart,
	SubtaskPart as InfiniteCodeSubtaskPart,
	TextPart as InfiniteCodeTextPart,
	ToolPart as InfiniteCodeToolPart,
	UserMessage as InfiniteCodeUserMessage,
} from "@infinitecode-ai/sdk/v2/client"

// ─── Local convenience types ─────────────────────────────────────────
// These are for converter internals only -- types that don't come from the SDK.

/** MCP config union (matches SDK's Config.mcp values) */
export type InfiniteCodeMcp =
	| import("@infinitecode-ai/sdk/v2/client").McpLocalConfig
	| import("@infinitecode-ai/sdk/v2/client").McpRemoteConfig
	| { enabled: boolean }

/** Agent markdown frontmatter for .infinitecode/agents/*.md */
export interface InfiniteCodeAgentFrontmatter {
	description?: string
	mode?: "subagent" | "primary" | "all"
	model?: string
	temperature?: number
	color?: string
	steps?: number
	permission?: import("@infinitecode-ai/sdk/v2/client").PermissionConfig
	hidden?: boolean
}

/** Command markdown frontmatter for .infinitecode/commands/*.md */
export interface InfiniteCodeCommandFrontmatter {
	description?: string
	agent?: string
	model?: string
	subtask?: boolean
}
