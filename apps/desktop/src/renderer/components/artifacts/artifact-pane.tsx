/**
 * Artifact pane — right-side container that hosts the saved-artifact
 * list and a preview of the selected artifact.
 *
 * Toggleable via ⌘. / Ctrl+. (handled in root-layout.tsx). Width is
 * persisted. List / preview split: 35% / 65% of the pane width.
 */

import { ScrollArea } from "@infinitecode/ui/components/scroll-area"
import { useAtomValue, useSetAtom } from "jotai"
import { ChevronLeftIcon, LayersIcon, XIcon } from "lucide-react"
import { useEffect } from "react"
import {
	artifactPaneOpenAtom,
	artifactPaneWidthAtom,
	artifactsListAtom,
	selectedArtifactIdAtom,
} from "../../atoms/artifacts"
import { refreshArtifacts } from "../../services/artifact-service"
import { ArtifactList } from "./artifact-list"
import { ArtifactPreview } from "./artifact-preview"
import { ArtifactKindBadge } from "./artifact-preview"

const MIN_WIDTH = 320
const MAX_WIDTH = 800

export function ArtifactPane() {
	const open = useAtomValue(artifactPaneOpenAtom)
	const width = useAtomValue(artifactPaneWidthAtom)
	const setOpen = useSetAtom(artifactPaneOpenAtom)
	const setWidth = useSetAtom(artifactPaneWidthAtom)
	const artifacts = useAtomValue(artifactsListAtom)
	const selectedId = useAtomValue(selectedArtifactIdAtom)
	const setSelectedId = useSetAtom(selectedArtifactIdAtom)

	// Load artifacts when the pane first opens.
	useEffect(() => {
		if (open && artifacts.length === 0) {
			refreshArtifacts().catch(() => {
				/* logged */
			})
		}
	}, [open, artifacts.length])

	if (!open) return null

	const selected = artifacts.find((a) => a.id === selectedId) ?? null

	const handleResize = (e: React.MouseEvent<HTMLDivElement>) => {
		e.preventDefault()
		const startX = e.clientX
		const startWidth = width
		const onMove = (mv: MouseEvent) => {
			const delta = startX - mv.clientX
			const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta))
			setWidth(next)
		}
		const onUp = () => {
			document.removeEventListener("mousemove", onMove)
			document.removeEventListener("mouseup", onUp)
		}
		document.addEventListener("mousemove", onMove)
		document.addEventListener("mouseup", onUp)
	}

	return (
		<aside
			className="relative flex h-full shrink-0 border-l border-border/60 bg-background/95"
			style={{ width }}
			aria-label="Saved artifacts"
		>
			{/* Resize handle */}
			<div
				role="separator"
				aria-orientation="vertical"
				onMouseDown={handleResize}
				className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-blue-500/30"
			/>

			<div className="flex h-full w-full flex-col">
				{/* Header */}
				<header className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3 text-xs">
					<LayersIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
					<span className="font-medium">Artifacts</span>
					<span className="text-muted-foreground/60">{artifacts.length}</span>
					<div className="flex-1" />
					<button
						type="button"
						onClick={() => setOpen(false)}
						title="Close pane (⌘.)"
						className="rounded p-1 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
					>
						<XIcon className="size-3.5" aria-hidden="true" />
					</button>
				</header>

				<div className="flex min-h-0 flex-1">
					{/* List */}
					<div className="w-[38%] shrink-0 border-r border-border/40">
						<ArtifactList artifacts={artifacts} selectedId={selectedId} />
					</div>

					{/* Preview */}
					<div className="flex min-w-0 flex-1 flex-col">
						{selected ? (
							<>
								<div className="flex items-start gap-2 border-b border-border/40 px-3 py-2">
									<button
										type="button"
										title="Back to list"
										onClick={() => setSelectedId(null)}
										className="rounded p-1 text-muted-foreground/70 hover:bg-muted hover:text-foreground"
									>
										<ChevronLeftIcon className="size-3.5" aria-hidden="true" />
									</button>
									<div className="min-w-0 flex-1">
										<div className="truncate text-xs font-medium">{selected.title}</div>
										{selected.subtitle && (
											<div className="truncate text-[10px] text-muted-foreground/70">
												{selected.subtitle}
											</div>
										)}
									</div>
									<ArtifactKindBadge kind={selected.kind} />
								</div>
								<ScrollArea className="flex-1">
									<ArtifactPreview artifact={selected} />
								</ScrollArea>
							</>
						) : (
							<div className="flex flex-1 items-center justify-center p-6 text-center">
								<div className="space-y-1 text-xs text-muted-foreground">
									<div className="font-medium">Select an artifact</div>
									<div>
										Click any item on the left to preview it here. Saved outputs are
										stored locally and survive restarts.
									</div>
								</div>
							</div>
						)}
					</div>
				</div>
			</div>
		</aside>
	)
}
