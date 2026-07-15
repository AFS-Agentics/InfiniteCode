import { cn } from "@infinitecode/ui/lib/utils"

interface ModelSelectorTriggerLabelProps {
	displayName: string
	variantLabel?: string | null
}

export function ModelSelectorTriggerLabel({
	displayName,
	variantLabel,
}: ModelSelectorTriggerLabelProps) {
	return (
		<span className="flex min-w-0 items-center gap-1.5">
			<span
				data-slot="model-selector-trigger-model"
				className="min-w-0 truncate text-foreground"
			>
				{displayName}
			</span>
			{variantLabel && (
				<span
					data-slot="model-selector-trigger-variant"
					className={cn("shrink-0 text-muted-foreground/60")}
				>
					{variantLabel}
				</span>
			)}
		</span>
	)
}
