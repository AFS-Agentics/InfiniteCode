/**
 * Artifact list — vertical list shown in the artifact pane.
 *
 * Each row is a click target that selects the artifact. Rows display:
 *   - kind icon
 *   - title (truncated)
 *   - subtitle (truncated)
 *   - relative time (e.g. "2 min ago")
 */

import { useSetAtom } from "jotai"
import { TrashIcon } from "lucide-react"
import { memo, useCallback } from "react"
import type { Artifact } from "../../../preload/api"
import { selectedArtifactIdAtom } from "../../atoms/artifacts"
import { ARTIFACT_KIND_META } from "./artifact-preview-registry"
import { deleteArtifact } from "../../services/artifact-service"

interface ArtifactListProps {
	artifacts: Artifact[]
	selectedId: string | null
}

function formatRelative(ts: number): string {
	const now = Date.now()
	const sec = Math.max(1, Math.round((now - ts) / 1000))
	if (sec < 60) return `${sec}s ago`
	const min = Math.round(sec / 60)
	if (min < 60) return `${min}m ago`
	const hr = Math.round(min / 60)
	if (hr < 24) return `${hr}h ago`
	const day = Math.round(hr / 24)
	if (day < 7) return `${day}d ago`
	return new Date(ts).toLocaleDateString()
}

interface RowProps {
	artifact: Artifact
	isSelected: boolean
	onSelect: (id: string) => void
	onDelete: (id: string) => void
}

const Row = memo(function Row({ artifact, isSelected, onSelect, onDelete }: RowProps) {
	const meta = ARTIFACT_KIND_META[artifact.kind]
	const Icon = meta.icon

	const handleClick = useCallback(() => {
		onSelect(artifact.id)
	}, [artifact.id, onSelect])

	const handleDelete = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			onDelete(artifact.id)
		},
		[artifact.id, onDelete],
	)

	return (
		<button
			type="button"
			onClick={handleClick}
			className={`group relative flex w-full flex-col gap-0.5 border-b border-border/40 px-3 py-2.5 text-left transition-colors ${
				isSelected
					? "bg-accent/40 text-foreground"
					: "text-foreground/80 hover:bg-muted/60"
			}`}
		>
			<div className="flex items-center gap-2">
				<Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
				<span className="min-w-0 flex-1 truncate text-xs font-medium">{artifact.title}</span>
				<span className="shrink-0 text-[10px] text-muted-foreground/70">
					{formatRelative(artifact.createdAt)}
				</span>
			</div>
			{artifact.subtitle && (
				<div className="truncate pl-5 text-[10px] text-muted-foreground/70">
					{artifact.subtitle}
				</div>
			)}
			<div className="flex items-center gap-1.5 pl-5 pt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/50">
				<span>{meta.label}</span>
				{artifact.sizeBytes > 0 && (
					<>
						<span>·</span>
						<span>{formatBytes(artifact.sizeBytes)}</span>
					</>
				)}
			</div>
			<button
				type="button"
				onClick={handleDelete}
				title="Delete artifact"
				className="absolute right-2 top-2 hidden rounded p-0.5 text-muted-foreground/40 transition-colors hover:bg-red-500/15 hover:text-red-400 group-hover:block"
			>
				<TrashIcon className="size-3" aria-hidden="true" />
			</button>
		</button>
	)
})

function formatBytes(n: number): string {
	if (n < 1024) return `${n}B`
	if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10}KB`
	return `${Math.round(n / 104857.6) / 10}MB`
}

export function ArtifactList({ artifacts, selectedId }: ArtifactListProps) {
	const setSelected = useSetAtom(selectedArtifactIdAtom)

	const handleSelect = useCallback(
		(id: string) => {
			setSelected(id)
		},
		[setSelected],
	)

	const handleDelete = useCallback((id: string) => {
		deleteArtifact(id).catch(() => {
			/* logged */
		})
	}, [])

	if (artifacts.length === 0) {
		return (
			<div className="flex h-full items-center justify-center p-6 text-center">
				<div className="space-y-1.5 text-xs text-muted-foreground">
					<div className="font-medium">No artifacts yet</div>
					<div>
						Save tool outputs from any chat using the bookmark icon to find them
						here.
					</div>
				</div>
			</div>
		)
	}

	return (
		<div className="flex h-full flex-col overflow-y-auto">
			{artifacts.map((a) => (
				<Row
					key={a.id}
					artifact={a}
					isSelected={selectedId === a.id}
					onSelect={handleSelect}
					onDelete={handleDelete}
				/>
			))}
		</div>
	)
}
