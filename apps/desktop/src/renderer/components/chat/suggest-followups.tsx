import { SparklesIcon } from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { useAtom, useSetAtom } from "jotai"

import type { ChatTurn as ChatTurnType } from "../../hooks/use-session-chat"
import type { ToolPart } from "../../lib/types"
import { cn } from "@infinitecode/ui/lib/utils"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@infinitecode/ui/components/tooltip"

import {
	suggestedFollowupsAtom,
	toggleFollowupClickedAtom,
} from "../../atoms/suggest-followups"

// ============================================================
// Helpers
// ============================================================

interface FollowupItem {
	emoji: string
	label: string
	prompt: string
}

const MAX_LABEL_CHARS = 60
const MAX_PROMPT_CHARS = 800

/** Extract followups from a tool-part's already-parsed input. The chip only
 *  mounts after the turn settles, so we can rely on `state.input`. */
function extractFollowups(part: ToolPart): FollowupItem[] {
	if (part.tool !== "suggest_followups") return []
	const input = (part.state as { input?: Record<string, unknown> }).input
	const raw = input?.followups
	if (!Array.isArray(raw)) return []
	const result: FollowupItem[] = []
	for (const item of raw) {
		if (!item || typeof item !== "object") continue
		const obj = item as Record<string, unknown>
		const label = typeof obj.label === "string" ? obj.label : ""
		const prompt = typeof obj.prompt === "string" ? obj.prompt : ""
		if (!label || !prompt) continue
		const emoji = typeof obj.emoji === "string" && obj.emoji ? obj.emoji : "✨"
		result.push({
			emoji,
			label: label.slice(0, MAX_LABEL_CHARS),
			prompt: prompt.slice(0, MAX_PROMPT_CHARS),
		})
	}
	return result
}

/** The most recent suggest_followups tool call in the turn (or undefined). */
function findLatestFollowupCall(turn: ChatTurnType): ToolPart | undefined {
	// Scan all assistant messages' parts (ChatTurn has assistantMessages[], each with its own parts[])
	for (let i = turn.assistantMessages.length - 1; i >= 0; i--) {
		const parts = turn.assistantMessages[i].parts
		if (!parts) continue
		for (let j = parts.length - 1; j >= 0; j--) {
			const part = parts[j]
			if (typeof part === "object" && "tool" in part && (part as ToolPart).tool === "suggest_followups") return part as ToolPart
		}
	}
	return undefined
}

// ============================================================
// Single chip
// ============================================================

interface FollowupChipProps {
	item: FollowupItem
	index: number
	clicked: boolean
	disabled: boolean
	onSubmit: (prompt: string, index: number) => void
}

const FollowupChip = memo(function FollowupChip({
	item,
	index,
	clicked,
	disabled,
	onSubmit,
}: FollowupChipProps) {
	const handleClick = useCallback(() => {
		if (disabled) return
		onSubmit(item.prompt, index)
	}, [disabled, onSubmit, item.prompt, index])

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<button
						type="button"
						onClick={handleClick}
						disabled={disabled}
						aria-label={`Send followup: ${item.prompt}`}
						className={cn(
							"group inline-flex max-w-full items-center gap-2 rounded-2xl border px-3.5 py-1.5 text-left text-[12.5px] font-medium transition-all duration-150",
							clicked
								? "border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
								: disabled
									? "cursor-not-allowed border-border/50 bg-muted/40 text-muted-foreground/60"
									: "border-border/70 bg-card text-foreground/90 hover:-translate-y-0.5 hover:border-violet-400/60 hover:bg-gradient-to-br hover:from-violet-500/10 hover:to-pink-500/10 hover:shadow-md active:translate-y-0",
						)}
					/>
				}
			>
				<span aria-hidden="true" className="text-[15px] leading-none">
					{item.emoji}
				</span>
				<span className="truncate font-semibold">{item.label}</span>
				{clicked && (
					<span aria-hidden="true" className="ml-0.5 text-emerald-500">
						✓
					</span>
				)}
			</TooltipTrigger>
			<TooltipContent side="top" className="max-w-md">
				<p className="text-xs">
					<span className="font-medium">Sends:</span>{" "}
					<span className="text-muted-foreground">{item.prompt}</span>
				</p>
			</TooltipContent>
		</Tooltip>
	)
})

// ============================================================
// Section
// ============================================================

interface SuggestFollowupsProps {
	turn: ChatTurnType
	isLast: boolean
	isWorking: boolean
	onSubmit: (prompt: string, index: number) => void
}

/**
 * Renders the emoji chip suggestions emitted by the agent's
 * `suggest_followups` tool. Mounts only on the LAST turn, only after the
 * response has settled (so we don't show stale chips mid-stream), and
 * collapses older turns' chips into a toggle.
 *
 * Active-set + clicked-set state lives in `atoms/suggest-followups.ts`.
 */
function SuggestFollowupsImpl({
	turn,
	isLast,
	isWorking,
	onSubmit,
}: SuggestFollowupsProps) {
	const [active, setActive] = useAtom(suggestedFollowupsAtom)
	const toggleClicked = useSetAtom(toggleFollowupClickedAtom)

	const toolPart = useMemo(() => findLatestFollowupCall(turn), [turn])
	const items = useMemo(
		() => (toolPart ? extractFollowups(toolPart) : []),
		[toolPart],
	)

	// Sync the active atom with the latest tool call. Runs only when the
	//(toolCallId, turnId, items) tuple actually changes — no re-render
	// storms, no in-render scheduling.
	const turnId = turn.userMessage.info.id
	const toolCallId = toolPart?.callID ?? null
	useEffect(() => {
		setActive({
			toolCallId,
			turnId,
			followups: items.map((i) => ({
				label: i.label,
				prompt: i.prompt,
				emoji: i.emoji,
			})),
			clickedByToolCall: active?.clickedByToolCall ?? new Map(),
		})
		// Intentionally NOT depending on `active` — we only want this to run
		// when the underlying tool call changes, not on every state update.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [toolCallId, turnId, items.length])

	if (items.length === 0) return null
	const clickedSet =
		active?.clickedByToolCall.get(toolCallId ?? "") ?? new Set<number>()

	if (!isLast) {
		return <PastFollowupsToggle items={items} />
	}

	return (
		<section
			aria-label="Suggested follow-up chips"
			className={cn(
				"mt-3 flex flex-col gap-2 rounded-xl border border-violet-300/30 bg-gradient-to-br from-violet-500/5 via-fuchsia-500/5 to-pink-500/5 px-3.5 py-2.5",
				isWorking && "opacity-60",
			)}
		>
			<header className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider">
				<SparklesIcon className="size-3 text-violet-500" aria-hidden="true" />
				<span className="bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500 bg-clip-text text-transparent">
					What's next?
				</span>
				<span className="ml-1 text-[10px] font-normal normal-case tracking-normal text-muted-foreground/70">
					click a chip to continue
				</span>
			</header>
			<div className="flex flex-wrap gap-1.5">
				{items.map((item, idx) => (
					<FollowupChip
						key={`${turnId}-${toolCallId ?? "latest"}-${idx}`}
						item={item}
						index={idx}
						clicked={clickedSet.has(idx)}
						disabled={isWorking}
						onSubmit={(prompt, index) => {
							toggleClicked({ toolCallId, index })
							onSubmit(prompt, index)
						}}
					/>
				))}
			</div>
		</section>
	)
}

// ============================================================
// Past (collapsed) toggle
// ============================================================

function PastFollowupsToggle({ items }: { items: FollowupItem[] }) {
	const [open, setOpen] = useState(false)
	return (
		<section className="mt-2 flex flex-col gap-1.5">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="flex items-center gap-1 self-start rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
			>
				<span aria-hidden="true">{open ? "▾" : "▸"}</span>
				<SparklesIcon className="size-3" aria-hidden="true" />
				<span>Previously suggested followups</span>
			</button>
			{open && (
				<div className="flex flex-wrap gap-1.5">
					{items.map((item, idx) => (
						<div
							key={`past-${idx}`}
							className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/30 px-2.5 py-1 text-[11px] text-muted-foreground"
						>
							<span aria-hidden="true">{item.emoji}</span>
							<span className="font-medium">{item.label}</span>
						</div>
					))}
				</div>
			)}
		</section>
	)
}

export const SuggestFollowups = memo(SuggestFollowupsImpl)
