import {
	Message,
	MessageAction,
	MessageActions,
	MessageContent,
	MessageResponse,
} from "@infinitecode/ui/components/ai-elements/message";
import { Shimmer } from "@infinitecode/ui/components/ai-elements/shimmer";
import {
	Dialog,
	DialogContent,
	DialogTitle,
	DialogTrigger,
} from "@infinitecode/ui/components/dialog";

import {
	ArrowUpToLineIcon,
	BotIcon,
	CheckIcon,
	ChevronDownIcon,
	CopyIcon,
	FileIcon,
	GitForkIcon,
	Loader2Icon,
	Undo2Icon,
	XIcon,
} from "lucide-react";
import {
	memo,
	useCallback,
	useDeferredValue,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { SessionCompactionStatus } from "../../atoms/compaction";
import type { ProviderRetryStatus } from "../../atoms/sessions";
import { useDisplayMode } from "../../hooks/use-agents";
import type {
	ChatMessageEntry,
	ChatTurn as ChatTurnType,
} from "../../hooks/use-session-chat";
import {
	computeTurnCost,
	computeTurnWorkTime,
	formatCost,
	formatWorkDuration,
	shortModelName,
} from "../../lib/session-metrics";
import type {
	Agent,
	FilePart,
	Part,
	PermissionRequest,
	ReasoningPart,
	TextPart,
	ToolPart,
} from "../../lib/types";
import { PermissionItem } from "./chat-permission";
import { SuggestFollowups } from "./suggest-followups";
import { useAgentActions } from "../../hooks/use-server";
import { createLogger } from "../../lib/logger";

const log = createLogger("chat-turn");

/**
 * Module-level — resets on every app restart / HMR reload.
 * Snapshots all existing turn IDs when the user sends their first
 * message. Turns with those IDs are "history" and never get ads.
 * Only turns created AFTER the snapshot get ads.
 */
let historyTurnIds = new Set<string>()
let adsEnabled = false

export function enableAdsForSession(allTurnIds: string[]) {
	historyTurnIds = new Set(allTurnIds)
	adsEnabled = true
}

function isAdsDisabled(turnId: string): boolean {
	return !adsEnabled || historyTurnIds.has(turnId)
}

import {
	CompactionStatusDivider,
	isCompactionStatusText,
} from "./compaction-status-divider";
import { AdsterraAd } from "./adsterra-ad"
import {
	buildProcessTimeline,
	processTimelineRowId,
} from "./process-timeline";
import { ProcessTimelineView } from "./process-timeline-view";

// ============================================================
// Utility functions
// ============================================================

const INFINITECODE_ITEM_KIND_META = "infinitecode/itemKind";
const INFINITECODE_RESEARCH_ARTIFACT_TITLE_META =
	"infinitecode/researchArtifactTitle";

/**
 * Formats a timestamp (milliseconds) to relative or absolute time.
 */
export function formatTimestamp(ms: number): string {
	const date = new Date(ms);
	return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ============================================================
// Status computation — follows into sub-agents
// ============================================================

/**
 * Computes a status string from the last active part.
 * Follows into sub-agent sessions for deeper status.
 */
function computeStatus(parts: Part[]): string {
	for (let i = parts.length - 1; i >= 0; i--) {
		const part = parts[i];
		if (part.type === "tool") {
			switch (part.tool) {
				case "task": {
					// Show what the sub-agent is actually doing
					const desc = part.state.input?.description as string | undefined;
					const shortDesc =
						desc && desc.length > 30 ? `${desc.slice(0, 27)}...` : desc;
					return shortDesc ? `Agent: ${shortDesc}` : "Delegating...";
				}
				case "todowrite":
				case "todoread":
					return "Planning...";
				case "read":
					return "Reading files...";
				case "list":
				case "grep":
				case "glob":
					return "Searching codebase...";
				case "webfetch":
					return "Fetching web content...";
				case "edit":
				case "write":
				case "apply_patch":
					return "Making edits...";
				case "bash":
					return "Running command...";
				case "question":
					return "Asking a question...";
				default:
					return `Running ${part.tool}...`;
			}
		}
		if (part.type === "reasoning") return "Thinking...";
		if (part.type === "text") return "Composing response...";
	}
	return "Working...";
}

// ============================================================
// Synthetic message helpers
// ============================================================

function isSyntheticMessage(entry: ChatMessageEntry): boolean {
	const textParts = entry.parts.filter((p): p is TextPart => p.type === "text");
	// All text parts are synthetic (e.g. compaction continuation, shell execution)
	if (textParts.length > 0 && textParts.every((p) => p.synthetic === true))
		return true;
	// No text parts at all — e.g. a user message with only a compaction part
	if (textParts.length === 0 && entry.parts.length > 0) return true;
	return false;
}

function getUserText(entry: ChatMessageEntry): string {
	return entry.parts
		.filter((p): p is TextPart => p.type === "text" && !p.synthetic)
		.map((p) => p.text)
		.join("\n");
}

function getSyntheticLabel(entry: ChatMessageEntry): string {
	const text = entry.parts
		.filter((p): p is TextPart => p.type === "text")
		.map((p) => p.text)
		.join("\n")
		.toLowerCase();

	if (text.includes("continue if you have next steps"))
		return "Auto-continued after compaction";
	if (text.includes("summarize the task tool output"))
		return "Auto-continued after task";
	if (text.includes("tool was executed by the user"))
		return "Shell command executed";
	if (text.includes("plan has been approved")) return "Plan approved";
	if (text.includes("enter plan mode")) return "Entered plan mode";
	if (text.includes("switch") && text.includes("plan")) return "Mode switched";
	// No text parts — check for compaction part (user message that triggers compaction)
	if (entry.parts.some((p) => p.type === "compaction"))
		return "Compacting conversation";
	return "Auto-continued";
}

function getFileParts(entry: ChatMessageEntry): FilePart[] {
	return entry.parts.filter(
		(p): p is FilePart =>
			p.type === "file" &&
			(p.mime.startsWith("image/") || p.mime === "application/pdf"),
	);
}

// ============================================================
// Attachment grid
// ============================================================

const AttachmentGrid = memo(function AttachmentGrid({
	files,
	onDelete,
}: {
	files: FilePart[];
	onDelete?: (file: FilePart) => void;
}) {
	if (files.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-2">
			{files.map((file) => (
				<AttachmentThumbnail key={file.id} file={file} onDelete={onDelete} />
			))}
		</div>
	);
});

function AttachmentThumbnail({
	file,
	onDelete,
}: {
	file: FilePart;
	onDelete?: (file: FilePart) => void;
}) {
	const isImage = file.mime.startsWith("image/");
	const [deleting, setDeleting] = useState(false);

	const handleDelete = useCallback(
		async (e: React.MouseEvent) => {
			e.stopPropagation();
			if (!onDelete || deleting) return;
			setDeleting(true);
			try {
				await onDelete(file);
			} finally {
				setDeleting(false);
			}
		},
		[onDelete, file, deleting],
	);

	return (
		<Dialog>
			<div className="group/thumb relative size-16 shrink-0">
				{onDelete && (
					<button
						type="button"
						onClick={handleDelete}
						disabled={deleting}
						className="absolute -right-1 -top-1 z-10 flex size-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 shadow-sm transition-opacity hover:bg-destructive/90 group-hover/thumb:opacity-100 disabled:opacity-50"
						title="Remove attachment"
					>
						<XIcon className="size-2.5" />
					</button>
				)}
				<DialogTrigger
					render={
						<button
							type="button"
							className="size-full overflow-hidden rounded-lg border border-border bg-muted transition-colors hover:border-muted-foreground/30"
						/>
					}
				>
					{isImage ? (
						<img
							src={file.url}
							alt={file.filename ?? "Image attachment"}
							className="size-full object-cover"
						/>
					) : (
						<div className="flex size-full items-center justify-center">
							<FileIcon className="size-6 text-muted-foreground" />
						</div>
					)}
					{file.filename && (
						<div className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 text-[9px] leading-tight text-white opacity-0 transition-opacity group-hover/thumb:opacity-100">
							<span className="line-clamp-1">{file.filename}</span>
						</div>
					)}
				</DialogTrigger>
			</div>
			<DialogContent className="max-h-[90vh] max-w-4xl overflow-auto p-0">
				<DialogTitle className="sr-only">
					{file.filename ?? "Attachment preview"}
				</DialogTitle>
				{isImage ? (
					<img
						src={file.url}
						alt={file.filename ?? "Image attachment"}
						className="max-h-[85vh] w-full object-contain"
					/>
				) : (
					<div className="flex flex-col items-center justify-center gap-2 p-8">
						<FileIcon className="size-12 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">
							{file.filename ?? "PDF attachment"}
						</p>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}

// ============================================================
// Part extraction helpers
// ============================================================

/** A renderable part — either a tool call, an intermediate text block, or reasoning */
type RenderablePart =
	| { kind: "tool"; part: ToolPart }
	| {
			kind: "text";
			id: string;
			text: string;
			metadata?: Record<string, unknown>;
	  }
	| { kind: "reasoning"; part: ReasoningPart };

type TextRenderablePart = Extract<RenderablePart, { kind: "text" }>;

/**
 * Flattens all assistant parts into an ordered list of renderable items
 * AND extracts the tool-only subset in a single pass.
 * Preserves the natural order: text, reasoning, tool, text, tool, text...
 * Filters out synthetic text, todoread without output, and empty text.
 * Strips OpenRouter [REDACTED] chunks from reasoning and skips empty reasoning.
 */
function getPartsAndTools(assistantMessages: ChatMessageEntry[]): {
	ordered: RenderablePart[];
	tools: ToolPart[];
} {
	const ordered: RenderablePart[] = [];
	const tools: ToolPart[] = [];
	for (const msg of assistantMessages) {
		for (const part of msg.parts) {
			if (part.type === "tool") {
				tools.push(part);
				if (part.tool === "todoread" && part.state.status !== "completed")
					continue;
				ordered.push({ kind: "tool", part });
			} else if (part.type === "text" && !part.synthetic && part.text.trim()) {
				if (isCompactionStatusText(part.text)) continue;
				const metadata = (part as { metadata?: Record<string, unknown> })
					.metadata;
				ordered.push({ kind: "text", id: part.id, text: part.text, metadata });
			} else if (part.type === "reasoning") {
				// Strip OpenRouter's encrypted [REDACTED] chunks
				const cleaned = part.text.replace("[REDACTED]", "").trim();
				if (cleaned) {
					ordered.push({ kind: "reasoning", part });
				}
			}
		}
	}
	return { ordered, tools };
}

function hasCompactionStatusMarker(
	assistantMessages: ChatMessageEntry[],
): boolean {
	return assistantMessages.some((msg) =>
		msg.parts.some(
			(part) => part.type === "text" && isCompactionStatusText(part.text),
		),
	);
}

/**
 * Gets the last text part's content — used for the final streaming response
 * and the copy action. Returns undefined if no text parts exist.
 */
function getLastResponseText(
	orderedParts: RenderablePart[],
): string | undefined {
	for (let i = orderedParts.length - 1; i >= 0; i--) {
		const item = orderedParts[i];
		if (item.kind === "text") return item.text;
	}
	return undefined;
}

function splitCompletedTurnParts(orderedParts: RenderablePart[]): {
	completedProcessParts: RenderablePart[];
	finalResponsePart: TextRenderablePart | undefined;
} {
	let finalResponseIndex = -1;
	for (let i = orderedParts.length - 1; i >= 0; i--) {
		if (orderedParts[i].kind === "text") {
			finalResponseIndex = i;
			break;
		}
	}

	if (finalResponseIndex === -1) {
		return {
			completedProcessParts: orderedParts,
			finalResponsePart: undefined,
		};
	}

	const finalResponsePart = orderedParts[
		finalResponseIndex
	] as TextRenderablePart;
	const completedProcessParts = orderedParts.filter(
		(_, index) => index !== finalResponseIndex,
	);
	return { completedProcessParts, finalResponsePart };
}

/**
 * Threshold below which a turn is considered "short" and defaults the
 * "Worked for Xs" expandable summary to OPEN. Tuned for ad-visibility UX:
 *   - ≤ SHORT_TURN_ITEM_LIMIT items: default OPEN so mid_timeline +
 *     mid_response Ad ads are visible without a manual click.
 *   -  > SHORT_TURN_ITEM_LIMIT items: default CLOSED to keep density
 *     UX manageable on long agentic turns (no first-paint flood of
 *     shell/think/edit blocks when no ad is involved).
 *
 * Centralizing the threshold as a named constant — rather than a bare
 * `<= 3` literal in the helper — makes future tuning a one-edit change
 * that future reviewers can audit instead of re-introducing the bug
 * that motivated this rule (always-expanded → 50-card flood).
 */
const SHORT_TURN_ITEM_LIMIT = 3;

/**
 * Returns true when this turn's completed process timeline has few grouped
 * items (≤ SHORT_TURN_ITEM_LIMIT) — used to decide the default for the
 * "Worked for Xs" expandable summary (`completedProcessExpanded` in
 * ChatTurnComponent).
 *
 * Active-turn note: when `isWorking` is true the turn is still streaming
 * and the completed-parts slice is partial. The helper still runs at
 * first mount with whatever the completed slice has so far, which means:
 *   - For a streaming turn with < LIMIT items at first mount: default
 *     OPEN, persisting for the lifetime of that turn. If a later chunk
 *     pushes the count past LIMIT within the same turn, the chevron
 *     does NOT auto-collapse — the user retains whichever state they
 *     had at first mount. (The rule re-applies only on `turn.id` change
 *     via the useEffect reset, so each fresh turn gets the right default
 *     for its starting shape.)
 *   - This avoids re-evaluating the rule on every streaming chunk and
 *     prevents mid-stream UI jank.
 *
 * Mirrors the same `processOrderedParts → buildProcessTimeline` chain as
 * `processTimelineItems` useMemo downstream, but uses the *completed*
 * branch (not the active-turn branch) because this toggle only resolves
 * for completed turns where the "Worked for Xs" header is rendered.
 */
function defaultCompletedProcessExpanded(turn: ChatTurnType): boolean {
	const { ordered: orderedParts } = getPartsAndTools(turn.assistantMessages);
	const { completedProcessParts } = splitCompletedTurnParts(orderedParts);
	return buildProcessTimeline(completedProcessParts).length <= SHORT_TURN_ITEM_LIMIT;
}

function researchArtifactTitle(item: TextRenderablePart): string | undefined {
	const metadata = item.metadata;
	if (metadata?.[INFINITECODE_ITEM_KIND_META] !== "research_artifact")
		return undefined;
	const title = metadata[INFINITECODE_RESEARCH_ARTIFACT_TITLE_META];
	return typeof title === "string" && title.trim() ? title : undefined;
}

function ResearchArtifactBlock({ item }: { item: TextRenderablePart }) {
	const title = researchArtifactTitle(item);
	if (!title) {
		return (
			<Message from="assistant">
				<MessageContent>
					<MessageResponse>{item.text}</MessageResponse>
				</MessageContent>
			</Message>
		);
	}
	return (
		<div className="border-l border-primary/30 pl-3">
			<div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
				<FileIcon className="size-3" aria-hidden="true" />
				<span>{title}</span>
			</div>
			<Message from="assistant">
				<MessageContent>
					<MessageResponse>{item.text}</MessageResponse>
				</MessageContent>
			</Message>
		</div>
	);
}

function getError(assistantMessages: ChatMessageEntry[]): string | undefined {
	for (const msg of assistantMessages) {
		if (msg.info.role === "assistant" && msg.info.error) {
			const error = msg.info.error;
			const errorData = error.data;
			// Most error types have a `message` string in data
			if ("message" in errorData && errorData.message) {
				return typeof errorData.message === "string"
					? errorData.message
					: String(errorData.message);
			}
			// Fallback: use the error name (e.g. "MessageOutputLengthError") +
			// any stringifiable data for types like MessageOutputLengthError
			// whose data is { [key: string]: unknown }
			const dataStr =
				Object.keys(errorData).length > 0
					? JSON.stringify(errorData)
					: undefined;
			return dataStr ? `${error.name}: ${dataStr}` : error.name;
		}
	}
	return undefined;
}

// ============================================================
// Turn comparison for memo
// ============================================================

/**
 * Lightweight fingerprint for a ChatMessageEntry to detect real content changes
 * without comparing the full object tree. Mirrors the logic in session-chat.ts
 * but kept local to avoid coupling.
 */
function messageEntryFingerprint(entry: ChatMessageEntry): string {
	const lastPart = entry.parts.at(-1);
	const completed =
		entry.info.role === "assistant" ? (entry.info.time.completed ?? 0) : 0;
	let textLen = 0;
	const toolSegments: string[] = [];
	const textMetadataSegments: string[] = [];
	for (const part of entry.parts) {
		if (part.type === "text" || part.type === "reasoning") {
			textLen += part.text.length;
			if (part.type === "text") {
				const metadata = (part as { metadata?: Record<string, unknown> })
					.metadata;
				if (metadata?.[INFINITECODE_ITEM_KIND_META] === "research_artifact") {
					textMetadataSegments.push(
						`${part.id}:${metadata[INFINITECODE_ITEM_KIND_META]}:${metadata[INFINITECODE_RESEARCH_ARTIFACT_TITLE_META] ?? ""}`,
					);
				}
			}
		} else if (part.type === "tool") {
			const outLen =
				part.state.status === "completed"
					? part.state.output.length
					: part.state.status === "error"
						? part.state.error.length
						: 0;
			toolSegments.push(`${part.id}:${part.state.status}:${outLen}`);
		}
	}
	return `${entry.info.id}:${completed}:${entry.parts.length}:${lastPart?.id ?? ""}:${textLen}:${textMetadataSegments.join(",")}:${toolSegments.join(",")}`;
}

/** Compare two turns by content fingerprint rather than reference equality */
function areTurnsEqual(a: ChatTurnType, b: ChatTurnType): boolean {
	if (a === b) return true;
	if (a.id !== b.id) return false;
	if (
		messageEntryFingerprint(a.userMessage) !==
		messageEntryFingerprint(b.userMessage)
	)
		return false;
	if (a.assistantMessages.length !== b.assistantMessages.length) return false;
	for (let i = 0; i < a.assistantMessages.length; i++) {
		if (
			messageEntryFingerprint(a.assistantMessages[i]) !==
			messageEntryFingerprint(b.assistantMessages[i])
		)
			return false;
	}
	return true;
}

// ============================================================
// ChatTurnComponent
// ============================================================

type PendingPermission = {
	request: PermissionRequest;
	sessionId: string;
};

interface ChatTurnProps {
	turn: ChatTurnType;
	isLast: boolean;
	isWorking: boolean;
	agent?: Agent;
	pendingPermission?: PendingPermission;
	isConnected?: boolean;
	compactionStatus?: SessionCompactionStatus | null;
	retryStatus?: ProviderRetryStatus;
	onApprovePermission?: (
		agent: Agent,
		permissionSessionId: string,
		permissionId: string,
		response?: "once" | "always",
	) => Promise<void>;
	onDenyPermission?: (
		agent: Agent,
		permissionSessionId: string,
		permissionId: string,
	) => Promise<void>;
	/** Revert to this turn's user message (for per-turn undo) */
	onRevertToMessage?: (messageId: string) => Promise<void>;
	/** Fork the conversation from this turn boundary */
	onForkFromTurn?: () => Promise<void>;
	/** Delete a specific part from a message (for error recovery) */
	onDeletePart?: (
		sessionId: string,
		messageId: string,
		partId: string,
	) => Promise<void>;
}

function pendingPermissionFingerprint(
	permission: PendingPermission | undefined,
): string {
	if (!permission) return "";
	const requestId =
		typeof permission.request.id === "string"
			? permission.request.id
			: typeof permission.request.requestID === "string"
				? permission.request.requestID
				: "";
	return `${permission.sessionId}:${requestId}`;
}

function retryStatusText(status: ProviderRetryStatus): string {
	if (status.message.trim()) return status.message;
	const seconds = Math.max(status.backoffMs / 1000, 0.1);
	return `Retrying provider request in ${seconds.toFixed(1)}s (attempt ${status.attempt})`;
}

function WorkingTurnStatusStrip({
	turn,
	retryStatus,
}: {
	turn: ChatTurnType;
	retryStatus?: ProviderRetryStatus;
}) {
	const [display, setDisplay] = useState(() =>
		formatWorkDuration(computeTurnWorkTime(turn, { active: true })),
	);

	useEffect(() => {
		const updateDisplay = () => {
			setDisplay(
				formatWorkDuration(computeTurnWorkTime(turn, { active: true })),
			);
		};
		updateDisplay();
		const id = setInterval(updateDisplay, 1_000);
		return () => clearInterval(id);
	}, [turn]);

	return (
		<div className="space-y-2 pt-1">
			<div className="text-sm tabular-nums text-muted-foreground/70">
				{retryStatus ? (
					retryStatusText(retryStatus)
				) : (
					<>Working for {display}</>
				)}
			</div>
			<div className="h-px bg-border/70" />
		</div>
	);
}

function CompletedTurnProcessDisclosure({
	duration,
	expanded,
	hasProcessDetails,
	onToggle,
}: {
	duration: string;
	expanded: boolean;
	hasProcessDetails: boolean;
	onToggle: () => void;
}) {
	const content = (
		<>
			<span>
				{duration ? "Worked for " : "Worked"}
				{duration}
			</span>
			{hasProcessDetails && (
				<ChevronDownIcon
					className={
						expanded
							? "size-4 rotate-180 transition-transform"
							: "size-4 transition-transform"
					}
					aria-hidden="true"
				/>
			)}
		</>
	);

	if (!hasProcessDetails) {
		return (
			<div className="flex w-fit max-w-full items-center gap-1.5 border-b border-border/70 pb-1 text-sm tabular-nums text-muted-foreground/70">
				{content}
			</div>
		);
	}

	return (
		<button
			type="button"
			onClick={onToggle}
			aria-expanded={expanded}
			className="flex w-fit max-w-full items-center gap-1.5 border-b border-border/70 pb-1 text-left text-sm tabular-nums text-muted-foreground/70 transition-colors hover:text-foreground"
		>
			{content}
		</button>
	);
}

/**
 * Renders a single turn: user message + assistant response.
 *
 * Two modes based on turn state:
 * - **Active turn** (last + working): tool calls are individually rendered with
 *   per-tool ToolCards, smart default expand/collapse, and live activity.
 * - **Completed turn**: icon-pill summary bar with one-click expand to show
 *   individual tools. Response text is always visible.
 *
 * Display mode preference (default/verbose) modifies behavior:
 * - default: interleaved text + grouped tool summaries as collapsible rows.
 * - verbose: all turns show all tools expanded with full content.
 */
export const ChatTurnComponent = memo(
	function ChatTurnComponent({
		turn,
		isLast,
		isWorking,
		agent,
		pendingPermission,
		isConnected = false,
		compactionStatus,
		retryStatus,
		onApprovePermission,
		onDenyPermission,
		onRevertToMessage,
		onForkFromTurn,
		onDeletePart,
	}: ChatTurnProps) {
		const [completedProcessExpanded, setCompletedProcessExpanded] = useState(
			// Lazy init: smart-default reads from `turn.assistantMessages`
			// and we don't want to recompute on every render. We reuse
			// `defaultCompletedProcessExpanded` (defined at module scope
			// above) — can't reference the in-component
			// `processTimelineItems` useMemo here because it's declared
			// later in the function body.
			() => defaultCompletedProcessExpanded(turn),
		);
		const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(
			() => new Set(),
		);
		const [copied, setCopied] = useState(false);
		const displayMode = useDisplayMode();
		const toolPathRoot =
			agent?.worktreePath ?? agent?.directory ?? agent?.projectDirectory;
		const turnRef = useRef<HTMLDivElement>(null);

		useEffect(() => {
			// Smart default per fresh turn: short turns expand (ads visible);
			// long turns stay collapsed (density UX preserved). User can
			// override either way by clicking the chevron. The helper here
			// is the same one used for lazy useState init above so first
			// render and post-mount navigation both apply the same rule.
			//
			// Deps are scoped to `turn.id` deliberately: within-turn
			// streaming pushes that change `turn.assistantMessages`
			// should NOT re-fire the smart default (the chevron override
			// stays valid until turn roll-over). Adding `turn` or
			// `turn.assistantMessages` to deps would re-fire on every
			// streaming chunk and cause UI jank. Don't widen this array
			// without a real reason.
			setCompletedProcessExpanded(defaultCompletedProcessExpanded(turn));
			setExpandedRowIds(new Set());
		}, [turn.id]);

		const isSynthetic = useMemo(
			() => isSyntheticMessage(turn.userMessage),
			[turn.userMessage],
		);
		const userText = useMemo(
			() => getUserText(turn.userMessage),
			[turn.userMessage],
		);
		const syntheticLabel = useMemo(
			() => (isSynthetic ? getSyntheticLabel(turn.userMessage) : ""),
			[isSynthetic, turn.userMessage],
		);
		const userFiles = useMemo(
			() => getFileParts(turn.userMessage),
			[turn.userMessage],
		);

		// Ordered parts + tool-only subset in a single pass (avoids double iteration)
		const { ordered: orderedParts } = useMemo(
			() => getPartsAndTools(turn.assistantMessages),
			[turn.assistantMessages],
		);

		const { completedProcessParts, finalResponsePart } = useMemo(
			() => splitCompletedTurnParts(orderedParts),
			[orderedParts],
		);
		const hasCompactionMarker = useMemo(
			() => hasCompactionStatusMarker(turn.assistantMessages),
			[turn.assistantMessages],
		);
		const displayedCompactionStatus: SessionCompactionStatus | null =
			hasCompactionMarker
				? compactionStatus === "completed"
					? "completed"
					: "started"
				: null;

		// The last text for streaming display and copy action
		const rawResponseText = useMemo(
			() => getLastResponseText(orderedParts),
			[orderedParts],
		);
		const responseText = useDeferredValue(rawResponseText);

		// Per-turn Ad ad context (above_response, inline_response, and
		// below_response all read this). Captures THIS turn's user prompt +
		// final assistant response so the contextual match aligns with the
		// response that each ad sits next to. Derived per-turn rather than a
		// shared ChatView-level last-4-turns slice so prior turns' ads stay
		// stable when a new turn begins (the slice would shift, every pill
		// would reset to "none", and Gravity's per-session sessionId would
		// churn on every streamed token). Single source of truth here is
		// critical — feed all three slots this exact array reference.
		const turnAdMessages = useMemo<{ role: string; content: string }[]>(() => {
			const msgs: { role: string; content: string }[] = [];
			const userText = turn.userMessage.parts
				.filter((p) => p.type === "text" || p.type === "reasoning")
				.map((p) => p.text)
				.join(" ")
				.trim();
			if (userText) msgs.push({ role: "user", content: userText.slice(0, 800) });
			if (responseText)
				msgs.push({ role: "assistant", content: responseText.slice(0, 800) });
			return msgs;
		}, [turn.userMessage.parts, responseText]);

		const errorText = useMemo(
			() => getError(turn.assistantMessages),
			[turn.assistantMessages],
		);

		// Compute status by walking the last message's parts in reverse — no
		// need to flatMap all messages into a temporary array.
		const statusText = useMemo(() => {
			if (retryStatus) return retryStatusText(retryStatus);
			for (let m = turn.assistantMessages.length - 1; m >= 0; m--) {
				const status = computeStatus(turn.assistantMessages[m].parts);
				if (status !== "Working...") return status;
			}
			return "Working...";
		}, [retryStatus, turn.assistantMessages]);

		const working = isLast && isWorking;

		// Suggested-followup chip handler. Clicking a chip sends the chip's
		// `prompt` as a new user turn via the existing agent socket.
		const { sendPrompt } = useAgentActions();
		const handleFollowupSubmit = useCallback(
			async (prompt: string) => {
				if (!agent) return;
				log.debug("followup submit", { prompt, agent: agent.name });
				try {
					await sendPrompt(agent.directory, agent.sessionId, prompt, {
						agent: agent.name,
					});
				} catch (error) {
					log.error(
						"followup submit failed",
						{ prompt, agent: agent.name },
						error,
					);
				}
			},
			[agent, sendPrompt],
		);

		// User requirement: queue state belongs in the composer status stack;
		// this transcript must not infer queued state from an empty assistant response.
		const processOrderedParts = working ? orderedParts : completedProcessParts;
		const processTimelineItems = useMemo(
			() => buildProcessTimeline(processOrderedParts),
			[processOrderedParts],
		);
		const processToolParts = useMemo(
			() =>
				processOrderedParts.flatMap((part) =>
					part.kind === "tool" ? [part.part] : [],
				),
			[processOrderedParts],
		);
		const hasSteps = processToolParts.length > 0;
		const hasWorkToDisclose = !working && processTimelineItems.length > 0;
		const hasCompletedProcessDetails = hasWorkToDisclose;
		const workTimeMs = useMemo(
			() => computeTurnWorkTime(turn, { active: working }),
			[turn, working],
		);
		const showWorkedForSummary = useMemo(() => {
			if (working) return false;
			return turn.assistantMessages.length > 0;
		}, [turn.assistantMessages.length, working]);
		const processSectionVisible =
			(working && processTimelineItems.length > 0) ||
			(!working && hasCompletedProcessDetails && completedProcessExpanded);

		const duration = useMemo(() => {
			if (workTimeMs <= 0) return "";
			return formatWorkDuration(workTimeMs);
		}, [workTimeMs]);
		const turnCostStr = useMemo(() => {
			const cost = computeTurnCost(turn);
			return cost > 0 ? formatCost(cost) : "";
		}, [turn]);
		const turnModel = useMemo(() => {
			for (let i = turn.assistantMessages.length - 1; i >= 0; i--) {
				const info = turn.assistantMessages[i].info;
				if (info.role === "assistant" && info.modelID) {
					return shortModelName(info.modelID);
				}
			}
			return "";
		}, [turn.assistantMessages]);

		// Determine if tools should be shown individually (active turn behavior)
		const isActiveTurn = working;
		const showVerboseTools = displayMode === "verbose";

		// Mid-timeline ad cadence — per-kind so thoughts get dense coverage
		// while tools stay at a saner auction rate. User feedback moved
		// thoughts from cadence=3 down to cadence=1 (every thought block)
		// because reasoning-heavy turns were capping at 4 ads across 10+
		// thoughts. Tools keep cadence=3 (production) / cadence=2 (dev) so
		// the underlying auction density stays sane when a turn has many
		// file ops.
		//
		// Separate per-kind caps so a 20-thought turn doesn't crowd out
		// tool-ads entirely (and vice versa). User requirement was
		// "ad after every thought block" — thoughts get a generous cap
		// (16) so the user almost never sees a missed thought-ad; tools
		// and text keep a tighter cap (4) so we don't auction-storm a
		// run of shell commands.
		const MAX_THOUGHT_ADS_PER_TURN = 16;
		const MAX_OTHER_ADS_PER_TURN = 4;

		// The renderMidAd closure needs to count "how many of THIS kind
		// have already rendered an ad, before this one?" so the per-kind
		// cap applies independently. We pre-compute per-item slot
		// numbers via items (in scope above as processTimelineItems),
		// then expose them via a Map keyed by rowId. The slot map is
		// O(n) once per render and avoids the closure needing the full
		// items array every call.
		const midAdSlotMap = useMemo(() => {
			const map = new Map<string, { cap: number; cadence: number; slot: number }>()
			let thoughtSlot = 0
			let otherSlot = 0
			processTimelineItems.forEach((item, idx) => {
				let cadence: number
				let cap: number
				if (item.kind === "thought") {
					cadence = 1
					cap = MAX_THOUGHT_ADS_PER_TURN
					thoughtSlot += 1
				} else if (item.kind === "tool" || item.kind === "tool-group") {
					cadence = import.meta.env.DEV ? 2 : 3
					cap = MAX_OTHER_ADS_PER_TURN
					if ((idx + 1) % cadence === 0) otherSlot += 1
				} else {
					cadence = 4
					cap = MAX_OTHER_ADS_PER_TURN
					if ((idx + 1) % cadence === 0) otherSlot += 1
				}
				const slot =
					item.kind === "thought"
						? thoughtSlot
						: (idx + 1) % cadence === 0
							? otherSlot
							: 0
				const rowId = processTimelineRowId(item, idx)
				map.set(rowId, { cap, cadence, slot })
			})
			return map
		}, [processTimelineItems])

		const renderMidAd = useCallback(
			(itemIndex: number, rowId: string) => {
				if (!isLast || isAdsDisabled(turn.id)) return null
				const meta = midAdSlotMap.get(rowId)
				if (!meta) return null
				if (meta.cadence > 1 && (itemIndex + 1) % meta.cadence !== 0) return null
				if (meta.slot === 0) return null
				if (meta.slot > meta.cap) return null
			return <AdsterraAd key={`ad-${rowId}`} placement="mid_timeline" />
			},
			[isLast, isActiveTurn, turnAdMessages, midAdSlotMap],
		)

		const textAlreadyInline =
			processSectionVisible &&
			processOrderedParts.some((p) => p.kind === "text");

		const handleToggleTimelineRow = useCallback(
			(rowId: string, open: boolean) => {
				setExpandedRowIds((previous) => {
					const next = new Set(previous);
					if (open) next.add(rowId);
					else next.delete(rowId);
					return next;
				});
			},
			[],
		);

		const handleCopyResponse = useCallback(async () => {
			if (!responseText) return;
			await navigator.clipboard.writeText(responseText);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}, [responseText]);

		const handleRevertHere = useCallback(async () => {
			if (!onRevertToMessage) return;
			await onRevertToMessage(turn.userMessage.info.id);
		}, [onRevertToMessage, turn.userMessage.info.id]);

		const handleScrollToTop = useCallback(() => {
			turnRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
		}, []);

		const handleToggleCompletedProcess = useCallback(() => {
			setCompletedProcessExpanded((expanded) => !expanded);
		}, []);

		const [forking, setForking] = useState(false);
		const handleFork = useCallback(async () => {
			if (!onForkFromTurn || forking) return;
			setForking(true);
			try {
				await onForkFromTurn();
			} finally {
				setForking(false);
			}
		}, [onForkFromTurn, forking]);

		const handleDeleteFile = useCallback(
			async (file: FilePart) => {
				if (!onDeletePart) return;
				await onDeletePart(file.sessionID, file.messageID, file.id);
			},
			[onDeletePart],
		);

		const handleDeleteToolPart = useCallback(
			async (toolPart: ToolPart) => {
				if (!onDeletePart) return;
				await onDeletePart(toolPart.sessionID, toolPart.messageID, toolPart.id);
			},
			[onDeletePart],
		);

		return (
			<div ref={turnRef} className="group/turn space-y-4">
				{/* User message */}
				{isSynthetic ? (
					<div className="flex items-center justify-end gap-1.5 text-[11px] italic text-muted-foreground/50">
						<BotIcon className="size-3" aria-hidden="true" />
						<span>{syntheticLabel}</span>
					</div>
				) : (
					<Message from="user">
						<MessageContent>
							{userFiles.length > 0 && (
								<AttachmentGrid
									files={userFiles}
									onDelete={onDeletePart ? handleDeleteFile : undefined}
								/>
							)}
							<p className="whitespace-pre-wrap">{userText}</p>
						</MessageContent>
					</Message>
				)}

				{working && (
					<WorkingTurnStatusStrip turn={turn} retryStatus={retryStatus} />
				)}

				{!working && showWorkedForSummary && (
					<CompletedTurnProcessDisclosure
						duration={duration}
						expanded={completedProcessExpanded}
						hasProcessDetails={hasCompletedProcessDetails}
						onToggle={handleToggleCompletedProcess}
					/>
				)}

				{/* Interleaved thought/tool process timeline */}
				{processSectionVisible && (
					<div className="space-y-2">
						<ProcessTimelineView
							defaultExpandAll={showVerboseTools}
							expandedRowIds={showVerboseTools ? undefined : expandedRowIds}
							isActiveTurn={isActiveTurn}
							items={processTimelineItems}
							onDeleteToolPart={onDeletePart ? handleDeleteToolPart : undefined}
							onToggleRow={
								showVerboseTools ? undefined : handleToggleTimelineRow
							}
							orderedParts={processOrderedParts}
							projectRoot={toolPathRoot}
							renderMidAd={renderMidAd}
							renderText={(item) => (
								<div className="py-0.5">
									<ResearchArtifactBlock item={item} />
								</div>
							)}
							turnHasError={!!errorText}
							working={working}
						/>

						{working && hasSteps && (
							<div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
								<Loader2Icon className="size-3 animate-spin text-muted-foreground/30" />
								<Shimmer className="text-[11px]">{statusText}</Shimmer>
							</div>
						)}
					</div>
				)}

				{pendingPermission && agent && (
					<PermissionItem
						agent={agent}
						permission={pendingPermission.request}
						onApprove={onApprovePermission}
						onDeny={onDenyPermission}
						isConnected={isConnected}
						isFromSubAgent={pendingPermission.sessionId !== agent.sessionId}
					/>
				)}

				{/* Error */}
				{errorText && (
					<div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
						{errorText.length > 300
							? `${errorText.slice(0, 300)}...`
							: errorText}
					</div>
				)}{/* Above-response Adsterra primary — sits above the main response area
			but below the user message. Only on fresh messages this session. */}
			{!isAdsDisabled(turn.id) && !working && isLast &&
				finalResponsePart &&
				responseText &&
				turnAdMessages.length > 0 && (
				<>
					<AdsterraAd placement="above_response" />
				</>
			)}			{/* Mid-response Adsterra primary — mounted between the
		    active process timeline and the final response Message bubble.
		    Same ready-gate as inline_response / below_response (only after
		    `!working && finalResponsePart && responseText`) plus the extra
		    `processTimelineItems.length > 0` requirement so a thought-only
		    response without tool activity doesn't get the divider. Adsterra
		    mounts independently of Gravity; Ad is conditionally enabled
		    60-s rotation offset vs the bottom-page 60-s timer. */}
			{!isAdsDisabled(turn.id) && !working && isLast &&
				finalResponsePart &&
				responseText &&
				turnAdMessages.length > 0 &&
				processTimelineItems.length > 0 && (
				<>
					<AdsterraAd placement="mid_response" />
				</>
			)}

			{/* Completed final response — only mounts after the response has
		    settled so the IO observer counts a stable impression (no
		    mid-stream impression). */}
			{!working &&
				finalResponsePart &&
				responseText &&
				(researchArtifactTitle(finalResponsePart) ? (
					<ResearchArtifactBlock
						item={{ ...finalResponsePart, text: responseText }}
					/>
				) : (
					<Message from="assistant">
						<MessageContent>
							<MessageResponse>{responseText}</MessageResponse>				</MessageContent>
				</Message>
			))}

			{/* Suggested followups chips sent by the agent's
		    `suggest_followups` tool. Only the LAST turn shows live; older
		    turns collapse into a toggle inside the component itself. */}
			{!working && finalResponsePart && responseText && (
				<SuggestFollowups
					turn={turn}
					isLast={isLast}
					isWorking={working}
					onSubmit={handleFollowupSubmit}
				/>
			)}

			{/* Inline Ad float-note attached at the very bottom of the
		    response bubble (sibling of the bubble, NOT inside it). Per-turn
		    context keeps prior turns' pills stable across the user's next
		    message, and the ready-gate prevents mid-stream impression
		    corruption.

		    Note: the chat carries 2 ads per turn total — Inline footer note
		    + Below-Response pill — matching freebuff's "Chat Response (Inline)"
		    + "Chat Response (Below)" pair exactly. */}
			{!isAdsDisabled(turn.id) && !working && isLast &&
				finalResponsePart &&
				responseText &&
				turnAdMessages.length > 0 && (
				<>
					<AdsterraAd placement="inline_response" />
					<AdsterraAd placement="below_response" />
				</>
			)}

				{/* Streaming response — visible while working, when text isn't already inline */}
				{working && responseText && !textAlreadyInline && (
					<Message from="assistant">
						<MessageContent>
							<MessageResponse animated>{responseText}</MessageResponse>
						</MessageContent>
					</Message>
				)}

				{/* User requirement: render compaction lifecycle as a transcript divider,
				   not as a normal assistant message that can hide the previous reply. */}
				{displayedCompactionStatus && (
					<CompactionStatusDivider status={displayedCompactionStatus} />
				)}

				{/* Per-turn metadata — shown on completed turns so badges are visible after long responses */}
				{!working &&
					turn.assistantMessages.length > 0 &&
					(turnModel || turnCostStr) && (
						<div className="flex items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground/40">
							{turnModel && <span>{turnModel}</span>}
							{turnModel && turnCostStr && <span>·</span>}
							{turnCostStr && <span>{turnCostStr}</span>}
						</div>
					)}

				{/* Turn-level message actions — always visible across all display modes */}
				{responseText && (
					<MessageActions>
						<MessageAction tooltip="Scroll to top" onClick={handleScrollToTop}>
							<ArrowUpToLineIcon className="size-3" />
						</MessageAction>
						<MessageAction
							tooltip={copied ? "Copied" : "Copy response"}
							onClick={handleCopyResponse}
						>
							{copied ? (
								<CheckIcon className="size-3" />
							) : (
								<CopyIcon className="size-3" />
							)}
						</MessageAction>
						{onForkFromTurn && !working && (
							<MessageAction
								tooltip={forking ? "Forking..." : "Fork from here"}
								onClick={handleFork}
								disabled={forking}
							>
								<GitForkIcon className="size-3" />
							</MessageAction>
						)}
						{onRevertToMessage && !working && (
							<MessageAction
								tooltip="Undo from here"
								onClick={handleRevertHere}
							>
								<Undo2Icon className="size-3" />
							</MessageAction>
						)}
					</MessageActions>
				)}
			</div>
		);
	},
	(prev, next) => {
		if (!areTurnsEqual(prev.turn, next.turn)) return false;
		if (prev.isLast !== next.isLast) return false;
		if (prev.isWorking !== next.isWorking) return false;
		if (prev.retryStatus !== next.retryStatus) return false;
		if (prev.agent?.sessionId !== next.agent?.sessionId) return false;
		if (prev.agent?.directory !== next.agent?.directory) return false;
		if (prev.agent?.projectDirectory !== next.agent?.projectDirectory)
			return false;
		if (prev.agent?.worktreePath !== next.agent?.worktreePath) return false;
		if (prev.isConnected !== next.isConnected) return false;
		if (prev.compactionStatus !== next.compactionStatus) return false;
		if (
			pendingPermissionFingerprint(prev.pendingPermission) !==
			pendingPermissionFingerprint(next.pendingPermission)
		) {
			return false;
		}
		// Skip reference comparison for callbacks - they close over stable values
		// and their identity changes don't affect rendered output
		return true;
	},
);
