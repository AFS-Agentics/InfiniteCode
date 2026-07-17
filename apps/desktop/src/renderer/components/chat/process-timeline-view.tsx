import { Loader2Icon } from "lucide-react";
import { Fragment, memo, type ReactNode, useCallback } from "react";
import type { ToolPart } from "../../lib/types";
import {
	ChatToolCall,
	describeToolGroup,
	getToolInfo,
	isGroupRunning,
} from "./chat-tool-call";
import {
	buildProcessTimeline,
	isReasoningPartActivelyStreaming,
	type ProcessTimelineInput,
	type ProcessTimelineItem,
	processTimelineRowId,
} from "./process-timeline";
import { ThoughtRow } from "./thought-row";
import type { ToolCategory } from "./tool-card";
import {
	TranscriptDisclosure,
	TranscriptDisclosureContent,
	TranscriptDisclosureTrigger,
} from "./transcript-disclosure";

export { buildProcessTimeline, isReasoningPartActivelyStreaming };

const TranscriptToolGroupRow = memo(function TranscriptToolGroupRow({
	category,
	tools,
	isActiveTurn,
	projectRoot,
	defaultOpen = false,
	open,
	onOpenChange,
}: {
	category: ToolCategory;
	tools: ToolPart[];
	isActiveTurn: boolean;
	projectRoot?: string | null;
	defaultOpen?: boolean;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}) {
	const description = describeToolGroup(category, tools, projectRoot);
	const running = isGroupRunning(tools);
	const { icon: GroupIcon } = getToolInfo(tools[0].tool);

	return (
		<TranscriptDisclosure
			className="mb-0"
			defaultOpen={defaultOpen}
			open={open}
			onOpenChange={onOpenChange}
		>
			<TranscriptDisclosureTrigger
				leading={
					<GroupIcon
						className={`size-4 shrink-0 ${
							running
								? "animate-pulse text-muted-foreground"
								: "text-muted-foreground/50"
						}`}
					/>
				}
				label={<span>{description}</span>}
				trailing={
					running ? (
						<Loader2Icon className="size-3 animate-spin text-muted-foreground/30" />
					) : undefined
				}
			/>
			<TranscriptDisclosureContent className="space-y-2">
				{tools.map((tool) => (
					<ChatToolCall
						key={tool.id}
						isActiveTurn={isActiveTurn}
						part={tool}
						projectRoot={projectRoot}
					/>
				))}
			</TranscriptDisclosureContent>
		</TranscriptDisclosure>
	);
});

export interface ProcessTimelineViewProps {
	items: ProcessTimelineItem[];
	orderedParts: ProcessTimelineInput[];
	working: boolean;
	isActiveTurn: boolean;
	projectRoot?: string | null;
	defaultExpandAll?: boolean;
	expandedRowIds?: Set<string>;
	onToggleRow?: (rowId: string, open: boolean) => void;
	renderText: (
		item: Extract<ProcessTimelineItem, { kind: "text" }>,
	) => ReactNode;
	turnHasError?: boolean;
	onDeleteToolPart?: (part: ToolPart) => Promise<void>;
	/**
	 * Optional callback that injects a Gravity mid-timeline ad after the
	 * item at the given 0-based index. Returning null skips insertion.
	 * Encapsulated here as a closure so callers (chat-turn) own the
	 * cadence + per-turn cap. Items wrap in a Fragment keyed by `rowId`
	 * so React doesn't confuse the ad's slot with adjacent item slots,
	 * and `rowId` is passed through so the closure can stamp a stable
	 * inner key on the returned ad element — keeping its React identity
	 * (and IntersectionObserver registration) stable when the cadence
	 * Math flips between null and JSX across renders.
	 */
	renderMidAd?: (itemIndex: number, rowId: string) => ReactNode;
}

export const ProcessTimelineView = memo(function ProcessTimelineView({
	items,
	orderedParts,
	working,
	isActiveTurn,
	projectRoot,
	defaultExpandAll = false,
	expandedRowIds,
	onToggleRow,
	renderText,
	turnHasError,
	onDeleteToolPart,
	renderMidAd,
}: ProcessTimelineViewProps) {
	const resolveOpen = useCallback(
		(rowId: string, fallbackDefault: boolean) => {
			if (defaultExpandAll) return true;
			if (expandedRowIds?.has(rowId)) return true;
			return fallbackDefault;
		},
		[defaultExpandAll, expandedRowIds],
	);

	return (
		<div className="space-y-1">
			{items.map((item, index) => {
				const rowId = processTimelineRowId(item, index);
				const midAdNode = renderMidAd ? renderMidAd(index, rowId) : null;

				// Wrap the item + optional ad in a Fragment keyed by `rowId` so
				// the loop returns a single keyed child per item. The ad gets
				// its own stable inner key so React doesn't churn its
				// IntersectionObserver when items stream in above it.
				if (item.kind === "text") {
					return (
						<Fragment key={rowId}>
							<div>{renderText(item)}</div>
							{midAdNode}
						</Fragment>
					);
				}

				if (item.kind === "thought") {
					const isStreaming =
						working &&
						isReasoningPartActivelyStreaming(orderedParts, item.part);
					return (
						<Fragment key={rowId}>
							<ThoughtRow
								// Show the Reasoning block expanded by default; click the
								// chevron/header to collapse. Tools still respect
								// defaultExpandAll so verbose-mode toggling is unaffected.
								defaultOpen={true}
								isStreaming={isStreaming}
								onOpenChange={
									onToggleRow ? (open) => onToggleRow(rowId, open) : undefined
								}
								open={expandedRowIds ? expandedRowIds.has(rowId) : undefined}
								part={item.part}
							/>
							{midAdNode}
						</Fragment>
					);
				}

				if (item.kind === "tool") {
					return (
						<Fragment key={rowId}>
							<ChatToolCall
								defaultOpen={defaultExpandAll}
								isActiveTurn={isActiveTurn}
								onDelete={onDeleteToolPart}
								open={expandedRowIds ? expandedRowIds.has(rowId) : undefined}
								onOpenChange={
									onToggleRow ? (open) => onToggleRow(rowId, open) : undefined
								}
								part={item.part}
								projectRoot={projectRoot}
								turnHasError={turnHasError}
							/>
							{midAdNode}
						</Fragment>
					);
				}

				return (
					<Fragment key={rowId}>
						<TranscriptToolGroupRow
							category={item.category}
							defaultOpen={resolveOpen(rowId, defaultExpandAll)}
							isActiveTurn={isActiveTurn}
							onOpenChange={
								onToggleRow ? (open) => onToggleRow(rowId, open) : undefined
							}
							open={expandedRowIds ? expandedRowIds.has(rowId) : undefined}
							projectRoot={projectRoot}
							tools={item.tools}
						/>
						{midAdNode}
					</Fragment>
				);
			})}
		</div>
	);
});
