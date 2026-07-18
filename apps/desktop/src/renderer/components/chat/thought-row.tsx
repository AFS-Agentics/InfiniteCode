import { ReasoningText } from "@infinitecode/ui/components/ai-elements/reasoning"
import { Shimmer } from "@infinitecode/ui/components/ai-elements/shimmer"
import { memo } from "react"
import type { ReasoningPart } from "../../lib/types"
import {
	TranscriptDisclosure,
	TranscriptDisclosureContent,
	TranscriptDisclosureTrigger,
} from "./transcript-disclosure"

export const ThoughtRow = memo(function ThoughtRow({
	part,
	isStreaming,
	open,
	defaultOpen = false,
	onOpenChange,
}: {
	part: ReasoningPart
	isStreaming: boolean
	open?: boolean
	defaultOpen?: boolean
	onOpenChange?: (open: boolean) => void
}) {
	const text = part.text.replace("[REDACTED]", "").trim()
	if (!text) return null

	return (
		<TranscriptDisclosure
			className="mb-0"
			defaultOpen={defaultOpen}
			open={open}
			onOpenChange={onOpenChange}
			streamingMaxHeight={isStreaming ? 120 : 0}
		>
			<TranscriptDisclosureTrigger
				aria-label="Reasoning details"
				label={
					isStreaming ? (
						<Shimmer duration={1}>Thinking...</Shimmer>
					) : (
						<span>Thought</span>
					)
				}
			/>
			<TranscriptDisclosureContent
				maxHeightPx={isStreaming ? 120 : 0}
				className="pt-1"
			>
				<div aria-label="Reasoning details" className="text-sm text-muted-foreground/80">
					<ReasoningText animated={isStreaming}>{text}</ReasoningText>
				</div>
			</TranscriptDisclosureContent>
		</TranscriptDisclosure>
	)
})
