import { Button } from "@infinitecode/ui/components/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@infinitecode/ui/components/dropdown-menu"
import { useAtomValue } from "jotai"
import {
	ChevronDownIcon,
	Loader2Icon,
	ZapIcon,
} from "lucide-react"
import { memo, useMemo, useState } from "react"
import { messagesFamily } from "../../atoms/messages"
import { partStorageKey, partsFamily } from "../../atoms/parts"
import { streamingVersionFamily } from "../../atoms/streaming"
import { appStore } from "../../atoms/store"
import type { Agent, PermissionRequest, Part } from "../../lib/types"
import { getToolInfo } from "./chat-tool-call"

interface PermissionItemProps {
	agent: Agent
	permission: PermissionRequest
	onApprove?: (
		agent: Agent,
		permissionSessionId: string,
		permissionId: string,
		response?: "once" | "always",
	) => Promise<void>
	onDeny?: (agent: Agent, permissionSessionId: string, permissionId: string) => Promise<void>
	isConnected?: boolean
	/** When true, the permission originated from a sub-agent session */
	isFromSubAgent?: boolean
}

// ============================================================
// Human-readable tool verb resolution
// ============================================================

/**
 * Map raw SDK tool names → friendly title used in the permission card header.
 * Icons are NOT here on purpose: `getToolInfo` from chat-tool-call.tsx is the
 * single source of truth for icon→tool mapping so adding a new tool there
 * automatically picks up an icon here via `getToolInfo(tool).icon`.
 */
const PERMISSION_VERBS: Record<string, string> = {
	read: "Read file",
	glob: "Search files",
	grep: "Search codebase",
	list: "List directory",
	webfetch: "Fetch URL",
	bash: "Run shell command",
	edit: "Edit file",
	write: "Write file",
	apply_patch: "Apply patch",
	task: "Delegate to sub-agent",
	todowrite: "Update plan",
	todoread: "Read plan",
	question: "Ask a question",
	request_user_input: "Ask a question",
}

// ============================================================
// Cross-message part lookup (re-render subscribed via streaming version)
// ============================================================

type PendingToolPart = {
	id: string
	tool: string
	input: Record<string, unknown>
	/** Partial JSON string streamed by the server while the tool is in
	 *  pending state. Used as a fallback when a field (e.g. filePath on
	 *  edit) hasn't yet been parsed into `input`. While running/completed,
	 *  every field should be reflected on `input` instead. */
	raw?: string
	title?: string
}

/**
 * Pulls the first non-empty string match for any of `fields` out of a
 * partial-JSON blob. Mirrors `extractFromRaw` in chat-tool-call.tsx but
 * scoped to this card and duplicated here to avoid creating an import
 * dependency between two files that don't otherwise need to share code.
 *
 * Example: `{"filePath": "/a.ts", "oldS` matched against ["filePath","path"]
 *          returns "/a.ts".
 */
function extractFieldFromRaw(
	raw: string | undefined,
	fields: string[],
): string | undefined {
	if (!raw) return undefined
	for (const field of fields) {
		const pattern = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`)
		const match = raw.match(pattern)
		if (match?.[1]) return match[1]
	}
	return undefined
}

// ============================================================
// Helper — defined ABOVE the hook so the const arrow is in scope when
// the hook runs. JS only hoists `function` declarations, not `const`s.
// ============================================================

/**
 * Reads the parts list for one message, preferring the legacy-keyed atom
 * (matches how chat-turn.tsx and use-session-chat consume parts) and
 * falling back to the scoped key written by `upsertPartAtom`.
 *
 * Uses an imperative `appStore.get` because `partsFamily` is keyed by
 * per-message atom and we need to iterate across many messages inside a
 * single hook. We re-run this every render via `streamingVersionFamily`
 * subscription upstream so any `message.part.updated` event invalidates
 * the memoization.
 */
function readPartsForMessage(sessionId: string, messageId: string): Part[] | undefined {
	const legacy = appStore.get(partsFamily(messageId)) as Part[] | undefined
	if (legacy && legacy.length > 0) return legacy
	const scoped = appStore.get(partsFamily(partStorageKey(sessionId, messageId))) as
		| Part[]
		| undefined
	return scoped && scoped.length > 0 ? scoped : undefined
}

/**
 * Finds the most-recent pending ToolPart in the same session whose `tool`
 * matches this permission's `metadata.tool`. Returns undefined when no
 * matching pending tool has been streamed yet — the card falls back to
 * the generic metadata-only view in that case.
 *
 * Subscribes to BOTH `messagesFamily` (so new assistant messages invalidate)
 * AND `streamingVersionFamily` (so per-part updates while the message is
 * already in the store still fire a re-scan — without that subscription
 * a streamed `state.input.filePath` mid-pending would never reach the
 * permission card).
 */
function usePendingToolPart(
	sessionId: string,
	toolName: string | undefined,
): PendingToolPart | undefined {
	const messages = useAtomValue(messagesFamily(sessionId))
	// Subscribe to the per-session streaming bump so part updates in
	// already-known messages still invalidate this memo.
	useAtomValue(streamingVersionFamily(sessionId))
	return useMemo(() => {
		if (!messages || !toolName) return undefined
		for (let i = messages.length - 1; i >= 0; i--) {
			const messageId = messages[i]?.id
			if (!messageId) continue
			const parts = readPartsForMessage(sessionId, messageId)
			if (!parts) continue
			for (let j = parts.length - 1; j >= 0; j--) {
				const part = parts[j]
				if (!part || part.type !== "tool") continue
				if (part.tool !== toolName) continue
				// ToolPart is typed `any` in the SDK; narrow with a runtime shape
				// check so we never crash on a non-standard payload.
				const record = part as Record<string, unknown>
				const state = record.state as { status?: string; input?: Record<string, unknown>; raw?: unknown; title?: unknown } | undefined
				const status = state?.status
				if (status !== "pending" && status !== "running") continue
				return {
					id: part.id,
					tool: part.tool,
					input: state?.input ?? {},
					...(typeof state?.raw === "string" ? { raw: state.raw } : {}),
					...(typeof state?.title === "string" ? { title: state.title } : {}),
				}
			}
		}
		return undefined
	}, [messages, toolName, sessionId])
}

// ============================================================
// Subtitle + inline preview helpers
// ============================================================

function nonEmptyString(v: unknown): string | undefined {
	return typeof v === "string" && v.trim() ? v : undefined
}

/**
 * One-line subtitle summarising the tool's intent. Pulled from the
 * pending ToolPart's input. Falls back to undefined (caller suppresses
 * row) when nothing meaningful is available.
 *
 * The `raw` parameter is the partial-JSON string streamed by the server
 * while the tool is in `pending` state. We fall back to it on a per-field
 * basis because for tools like `edit` the model often emits filePath
 * BEFORE the parser has filled `state.input.filePath`, leaving the user
 * staring at an empty card. Matching `chat-tool-call.tsx`'s
 * `extractFromRaw` keeps the two cards visually consistent.
 */
function extractSubtitle(
	toolName: string,
	input: Record<string, unknown>,
	raw?: string,
): string | undefined {
	switch (toolName) {
		case "read":
		case "edit":
		case "write":
		case "apply_patch":
			return (
				nonEmptyString(input.filePath) ??
				nonEmptyString(input.path) ??
				nonEmptyString((input.patch as { filePath?: string } | undefined)?.filePath) ??
				nonEmptyString((input.diff as { filePath?: string } | undefined)?.filePath) ??
				extractFieldFromRaw(raw, ["filePath", "path", "patch.filePath", "diff.filePath"])
			)
		case "bash":
			return (
				nonEmptyString(input.description) ??
				nonEmptyString(input.command) ??
				extractFieldFromRaw(raw, ["description", "command"])
			)
		case "webfetch":
			return nonEmptyString(input.url) ?? extractFieldFromRaw(raw, ["url"])
		case "grep":
		case "glob":
			return (
				nonEmptyString(input.pattern) ??
				nonEmptyString(input.path) ??
				extractFieldFromRaw(raw, ["pattern", "path"])
			)
		case "task":
			return (
				nonEmptyString(input.description) ??
				extractFieldFromRaw(raw, ["description"])
			)
		default:
			// MCP / unknown: best-effort input params as compact [k=v, k=v]
			const entries = Object.entries(input).filter(([, v]) => v != null)
			if (entries.length === 0) return undefined
			return entries
				.slice(0, 3)
				.map(([k, v]) => `${k}=${shortValue(v)}`)
				.join(", ")
	}
}

function shortValue(v: unknown): string {
	const s = typeof v === "string" ? v : JSON.stringify(v)
	return s.length > 60 ? `${s.slice(0, 57)}...` : s
}

// ============================================================
// PermissionItem
// ============================================================

/**
 * Single permission request card — compact style matching the task list.
 *
 * UX: shows the human-readable tool verb (e.g. "Write file"), a concrete
 * subtitle (file path / URL / command / description) pulled from the
 * matching pending ToolPart when available, and an inline preview of the
 * diff (edit) or content (write) when small enough. Icons come from
 * `getToolInfo` in chat-tool-call.tsx so this card and the tool card below
 * stay visually consistent.
 *
 * When `isFromSubAgent` is true an inline arrow badge prefixes the verb
 * so the user can immediately tell the request came from a child task,
 * not the current session.
 */
export const PermissionItem = memo(function PermissionItem({
	agent,
	permission,
	onApprove,
	onDeny,
	isConnected,
	isFromSubAgent,
}: PermissionItemProps) {
	const [responding, setResponding] = useState(false)

	async function handleApprove(response: "once" | "always" = "once") {
		if (!onApprove || responding) return
		setResponding(true)
		try {
			// Pass the permission's own sessionID so sub-agent permissions are
			// routed to the correct session, not the parent agent's session.
			await onApprove(agent, permission.sessionID, permission.id, response)
		} finally {
			setResponding(false)
		}
	}

	async function handleDeny() {
		if (!onDeny || responding) return
		setResponding(true)
		try {
			await onDeny(agent, permission.sessionID, permission.id)
		} finally {
			setResponding(false)
		}
	}

	// Resolve the tool name. The SDK sets `permission.permission` to the
	// tool name string (e.g. "write") and `metadata.tool` is a duplicate.
	// Prefer `metadata.tool` because future SDK versions may repurpose
	// `permission` as a proper noun like "fs.write" while keeping the
	// raw tool name on `metadata.tool`.
	const tool = (permission.metadata?.tool as string | undefined) ?? permission.permission
	const command = permission.metadata?.command as string | undefined

	// Single source of truth for the tool icon (mirrors chat-tool-call's
	// tool card UI). Unknown tools fall through to WrenchIcon via the
	// default branch in getToolInfo.
	const toolInfo = getToolInfo(tool ?? "")
	const ToolIcon = toolInfo.icon

	// Subtitle: prefer the tool input (live, from the streaming ToolPart)
	// over the static `metadata.command` which is bash-only.
	const pendingPart = usePendingToolPart(permission.sessionID, tool)

	const toolVerb = useMemo(() => {
		if (!tool) return "Tool action"
		return PERMISSION_VERBS[tool] ?? tool
	}, [tool])

	const subtitle = useMemo(() => {
		// Bash: the metadata.command is the most authoritative source — use
		// it ahead of any pending ToolPart so the user sees the full command.
		if (tool === "bash" && command) {
			return command.length > 200 ? `${command.slice(0, 197)}...` : command
		}
		if (pendingPart) {
			return extractSubtitle(pendingPart.tool, pendingPart.input, pendingPart.raw)
		}
		return undefined
	}, [tool, command, pendingPart])

	// Inline preview for write (content) + edit (oldString → newString).
	// Only when the content is small enough to fit comfortably, otherwise
	// the user can still see full content in the tool card below.
	//
	// Falls back to `state.raw` partial-JSON parsing when `state.input`
	// is still `{}` (common during `pending` for edit: the model emits
	// `{"filePath":"...", "oldString": "..."` incrementally and the
	// parser fills input fields on a delay).
	const inlinePreview = useMemo(() => {
		if (!pendingPart) return null
		const input = pendingPart.input
		const raw = pendingPart.raw
		if (tool === "write") {
			const content =
				(typeof input.content === "string" && input.content) ||
				extractFieldFromRaw(raw, ["content"])
			if (!content) return null
			if (content.length > 400) {
				return { kind: "write" as const, body: content.slice(0, 400), truncated: true, total: content.length }
			}
			return { kind: "write" as const, body: content, truncated: false, total: content.length }
		}
		if (tool === "edit") {
			const oldString =
				(typeof input.oldString === "string" && input.oldString) ||
				extractFieldFromRaw(raw, ["oldString"])
			const newString =
				(typeof input.newString === "string" && input.newString) ||
				extractFieldFromRaw(raw, ["newString"])
			if (!oldString && !newString) return null
			return {
				kind: "edit" as const,
				oldText: oldString ? truncate(oldString, 200) : null,
				newText: newString ? truncate(newString, 200) : null,
			}
		}
		return null
	}, [pendingPart, tool])

	return (
		<div className="mb-2 overflow-hidden rounded-xl border border-border bg-card">
			<div className="px-3 py-2.5">
				{isFromSubAgent && (
					<div className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-600 dark:text-violet-300">
						<ZapIcon className="size-3 shrink-0" aria-hidden="true" />
						<span>Sub-agent</span>
						<span className="text-violet-600/60 dark:text-violet-300/60">·</span>
						<span>needs approval</span>
					</div>
				)}
				<div className="flex items-center gap-1.5">
					<ToolIcon
						className="size-3.5 shrink-0 text-muted-foreground"
						aria-hidden="true"
					/>
					<span className="text-sm font-medium text-foreground">{toolVerb}</span>
					{!isFromSubAgent && (
						<span className="text-xs text-muted-foreground/60">needs approval</span>
					)}
				</div>
				{subtitle && (
					<div className="mt-1.5 truncate font-mono text-xs text-muted-foreground/80">
						{subtitle}
					</div>
				)}
				{inlinePreview && (
					<PermissionInlinePreview preview={inlinePreview} />
				)}
			</div>
			<div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
				<button
					type="button"
					onClick={handleDeny}
					disabled={!isConnected || responding}
					className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
				>
					Deny
				</button>
				<div className="flex items-center">
					<Button
						size="sm"
						onClick={() => handleApprove("once")}
						disabled={!isConnected || responding}
						className="h-7 rounded-r-none px-2.5 text-xs"
					>
						{responding && <Loader2Icon className="size-3 animate-spin" aria-hidden="true" />}
						Allow
					</Button>
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button
									size="sm"
									disabled={!isConnected || responding}
									className="h-7 rounded-l-none border-l border-primary-foreground/20 px-1"
									aria-label="More approval options"
								/>
							}
						>
							<ChevronDownIcon className="size-3" aria-hidden="true" />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onClick={() => handleApprove("once")}>Allow once</DropdownMenuItem>
							<DropdownMenuItem onClick={() => handleApprove("always")}>
								Always allow
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
		</div>
	)
})

// ============================================================
// Inline preview renderer — colorised + / − for diffs, plain for writes
// ============================================================

type WritePreview = { kind: "write"; body: string; truncated: boolean; total: number }
type EditPreview = { kind: "edit"; oldText: string | null; newText: string | null }
type InlinePreview = WritePreview | EditPreview

function PermissionInlinePreview({ preview }: { preview: InlinePreview }) {
	if (preview.kind === "write") {
		return (
			<div className="mt-1.5 overflow-hidden rounded border border-border/50 bg-muted/30">
				<pre className="max-h-40 overflow-auto px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground/85">
					<code>{preview.body}</code>
				</pre>
				{preview.truncated && (
					<div className="border-t border-border/40 bg-background/50 px-2 py-1 text-[10px] text-muted-foreground/70">
						preview truncated · full {preview.total} chars
					</div>
				)}
			</div>
		)
	}
	// Edit: render side-by-side style with red − / green + spans
	const { oldText, newText } = preview
	return (
		<div className="mt-1.5 overflow-hidden rounded border border-border/50 bg-muted/30 font-mono text-[11px] leading-relaxed">
			{oldText !== null && (
				<div className="flex gap-1.5 border-b border-border/40 bg-diff-deletion/5 px-2 py-1 text-diff-deletion-foreground">
					<span className="select-none text-diff-deletion-foreground/70">−</span>
					<span className="break-all whitespace-pre-wrap">{oldText}</span>
				</div>
			)}
			{newText !== null && (
				<div className="flex gap-1.5 bg-diff-addition/5 px-2 py-1 text-diff-addition-foreground">
					<span className="select-none text-diff-addition-foreground/70">+</span>
					<span className="break-all whitespace-pre-wrap">{newText}</span>
				</div>
			)}
		</div>
	)
}

function truncate(s: string, max: number): string {
	return s.length > max ? `${s.slice(0, max - 3)}...` : s
}
