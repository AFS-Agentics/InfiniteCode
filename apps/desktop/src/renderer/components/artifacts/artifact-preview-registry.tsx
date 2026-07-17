/**
 * Artifact preview registry — maps each ArtifactKind to its renderer + icon.
 *
 * The registry is intentionally small. Kinds are dispatchable to:
 *   - `CodeArtifactPreview` for syntax-highlighted code
 *   - `DiffArtifactPreview` for unified diff content
 *   - `JsonArtifactPreview` for pretty-printed JSON
 *   - `HtmlArtifactPreview` for raw HTML escape + monospace
 *   - `ImageArtifactPreview` for image data URLs / file:// URLs
 *   - `BashArtifactPreview` for terminal output
 *   - `LogArtifactPreview` for plain log lines
 *   - `TextArtifactPreview` fallback
 *
 * Each preview receives the artifact and a `safeContent` string (already
 * trimmed to a sane display length). Previews are responsible for any
 * additional truncation inside their own viewer.
 */

import {
	BracesIcon,
	CodeIcon,
	DatabaseIcon,
	FileIcon,
	FileTextIcon,
	ImageIcon,
	TerminalIcon,
} from "lucide-react"
import type { ArtifactKind } from "../../../preload/api"

export interface ArtifactKindMeta {
	icon: typeof FileTextIcon
	label: string
}

export const ARTIFACT_KIND_META: Record<ArtifactKind, ArtifactKindMeta> = {
	code: { icon: CodeIcon, label: "Code" },
	diff: { icon: FileIcon, label: "Diff" },
	text: { icon: FileTextIcon, label: "Text" },
	json: { icon: BracesIcon, label: "JSON" },
	image: { icon: ImageIcon, label: "Image" },
	html: { icon: CodeIcon, label: "HTML" },
	bash: { icon: TerminalIcon, label: "Shell" },
	file: { icon: FileIcon, label: "File" },
	log: { icon: DatabaseIcon, label: "Log" },
}

export const ALL_ARTIFACT_KINDS: ArtifactKind[] = [
	"code",
	"diff",
	"text",
	"json",
	"image",
	"html",
	"bash",
	"file",
	"log",
]
