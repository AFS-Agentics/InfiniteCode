/**
 * Artifact preview — dispatches to a kind-specific viewer.
 *
 * Keeps the dispatcher small. Each viewer is a self-contained block below.
 * All viewers receive the artifact's `content` already stringified by the
 * main process (images use `data:` URLs, text uses plain UTF-8).
 */

import { useMemo } from "react"
import {
	CodeBlock,
	CodeBlockContent,
	CodeBlockCopyButton,
	CodeBlockHeader,
	CodeBlockTitle,
} from "@infinitecode/ui/components/ai-elements/code-block"
import type { BundledLanguage } from "shiki"
import { detectContentLanguage, prettyPrintJson } from "../../lib/language"
import type { Artifact } from "../../../preload/api"
import { ARTIFACT_KIND_META } from "./artifact-preview-registry"

interface ArtifactPreviewProps {
	artifact: Artifact
}

const MAX_PREVIEW_CHARS = 64_000

function safeContent(content: string): string {
	if (content.length <= MAX_PREVIEW_CHARS) return content
	return `${content.slice(0, MAX_PREVIEW_CHARS)}\n\n... (truncated, ${content.length - MAX_PREVIEW_CHARS} more chars in stored artifact)`
}

// ============================================================
// Kind-specific viewers
// ============================================================

function CodeViewer({ content, language }: { content: string; language: string | null }) {
	const lang = (language ?? "text") as BundledLanguage
	return (
		<div className="text-[11px]">
			<CodeBlock code={content} language={lang}>
				<CodeBlockHeader className="px-3 py-1.5">
					<CodeBlockTitle className="text-[11px] uppercase text-muted-foreground">
						{lang}
					</CodeBlockTitle>
					<CodeBlockCopyButton className="size-6" />
				</CodeBlockHeader>
				<CodeBlockContent code={content} language={lang} />
			</CodeBlock>
		</div>
	)
}

function JsonViewer({ content }: { content: string }) {
	const formatted = useMemo(() => {
		try {
			return prettyPrintJson(content)
		} catch {
			return content
		}
	}, [content])
	return <CodeViewer content={formatted} language="json" />
}

function TextViewer({ content }: { content: string }) {
	return (
		<pre className="max-h-full overflow-auto px-3.5 py-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground/90">
			<code>{content}</code>
		</pre>
	)
}

function HtmlViewer({ content }: { content: string }) {
	return (
		<div className="space-y-2">
			<div className="flex items-center gap-1.5 border-b border-border/40 px-3.5 py-2 text-[11px] text-muted-foreground">
				HTML is rendered as raw text. Open in editor for live preview.
			</div>
			<pre className="max-h-full overflow-auto px-3.5 py-3 font-mono text-[11px] leading-relaxed text-foreground/90">
				<code>{content}</code>
			</pre>
		</div>
	)
}

function ImageViewer({ content, mime }: { content: string; mime: string | null }) {
	const src = useMemo(() => {
		// content may be a data URL already, or a file:// / http(s) URL, or
		// raw base64 (we'll wrap with mime).
		if (content.startsWith("data:") || content.startsWith("file:") || /^https?:/i.test(content)) {
			return content
		}
		const m = mime ?? "image/png"
		return `data:${m};base64,${content}`
	}, [content, mime])
	return (
		<div className="flex items-center justify-center overflow-auto bg-muted/30 p-4">
			<img
				src={src}
				alt="Artifact"
				className="max-w-full rounded shadow-sm"
				onError={(e) => {
					const t = e.currentTarget
					t.style.display = "none"
					const parent = t.parentElement
					if (parent) {
						parent.innerHTML =
							'<div class="text-xs text-muted-foreground">Could not render image.</div>'
					}
				}}
			/>
		</div>
	)
}

function BashViewer({ content }: { content: string }) {
	return (
		<pre className="max-h-full overflow-auto bg-black/90 px-3.5 py-3 font-mono text-[11px] leading-relaxed text-green-300">
			<code>{content}</code>
		</pre>
	)
}

function LogViewer({ content }: { content: string }) {
	return (
		<pre className="max-h-full overflow-auto bg-muted/40 px-3.5 py-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
			<code>{content}</code>
		</pre>
	)
}

// ============================================================
// Dispatcher
// ============================================================

export function ArtifactPreview({ artifact }: ArtifactPreviewProps) {
	const content = safeContent(artifact.content)

	switch (artifact.kind) {
		case "code":
			return <CodeViewer content={content} language={artifact.language} />
		case "json":
			return <JsonViewer content={content} />
		case "html":
			return <HtmlViewer content={content} />
		case "image":
			return <ImageViewer content={content} mime={artifact.mime} />
		case "bash":
			return <BashViewer content={content} />
		case "log":
			return <LogViewer content={content} />
		case "diff":
		case "file":
		case "text":
		default: {
			// Auto-detect content type when kind is `text` or `file`.
			if (artifact.kind === "file" && artifact.language) {
				return <CodeViewer content={content} language={artifact.language} />
			}
			const detected = detectContentLanguage(content)
			if (detected === "json") return <JsonViewer content={content} />
			return <TextViewer content={content} />
		}
	}
}

export function ArtifactKindBadge({ kind }: { kind: Artifact["kind"] }) {
	const meta = ARTIFACT_KIND_META[kind]
	const Icon = meta.icon
	return (
		<span className="inline-flex items-center gap-1 rounded border border-border/50 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
			<Icon className="size-2.5" aria-hidden="true" />
			{meta.label}
		</span>
	)
}
