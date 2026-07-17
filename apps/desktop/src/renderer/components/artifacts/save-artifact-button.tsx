/**
 * Save-to-artifacts button rendered on completed tool cards.
 *
 * Detects the appropriate `ArtifactKind` from the tool name + content and
 * calls the artifact service. Toast feedback via sonner.
 */

import { Tooltip, TooltipContent, TooltipTrigger } from "@infinitecode/ui/components/tooltip"
import { BookmarkIcon, CheckIcon, Loader2Icon } from "lucide-react"
import { memo, useCallback, useState } from "react"
import { toast } from "sonner"
import type { ToolPart } from "../../lib/types"
import type { ArtifactInput, ArtifactKind } from "../../../preload/api"
import { storeArtifact } from "../../services/artifact-service"
import { detectLanguage } from "../../lib/language"

interface SaveArtifactButtonProps {
	part: ToolPart
	sessionId?: string | null
	turnId?: string | null
	/** Project root for path-shortening in the artifact subtitle. */
	projectRoot?: string | null
}

const SAVE_BUTTON_CONTENT_LIMIT = 480_000 // bytes

function detectKindAndContent(part: ToolPart): ArtifactInput | null {
	const state = part.state
	const tool = part.tool
	const input = state.input ?? {}

	const filePath =
		(input.filePath as string | undefined) ?? (input.path as string | undefined)
	const fileName = filePath ? filePath.split("/").pop() ?? filePath : undefined

	switch (tool) {
		case "read": {
			if (state.status !== "completed") return null
			const content = state.output ?? ""
			if (!content.trim()) return null
			return {
				kind: filePath ? "file" : "text",
				title: fileName ?? "Read output",
				subtitle: filePath ?? null,
				content,
				language: filePath ? detectLanguage(filePath) ?? null : null,
				mime: null,
				source: "tool",
				tags: ["read", tool],
				sessionId: null,
				turnId: null,
				toolCallId: part.callID,
			}
		}
		case "write": {
			const content = (input.content as string | undefined) ?? ""
			if (!content.trim()) return null
			return {
				kind: filePath ? "file" : "text",
				title: `Wrote ${fileName ?? "file"}`,
				subtitle: filePath ?? null,
				content,
				language: filePath ? detectLanguage(filePath) ?? null : null,
				mime: null,
				source: "tool",
				tags: ["write", tool],
				sessionId: null,
				turnId: null,
				toolCallId: part.callID,
			}
		}
		case "edit":
		case "apply_patch": {
			const oldString = input.oldString as string | undefined
			const newString = input.newString as string | undefined
			const patch = (input.patch as string | undefined) ?? (input.diff as string | undefined)
			let content = patch ?? ""
			if (!content && oldString != null && newString != null) {
				content = `--- a/${filePath ?? "file"}\n+++ b/${filePath ?? "file"}\n@@\n-${oldString}\n+${newString}\n`
			}
			if (!content.trim()) return null
			return {
				kind: "diff",
				title: `Edit: ${fileName ?? filePath ?? "file"}`,
				subtitle: filePath ?? null,
				content,
				language: "diff",
				mime: null,
				source: "tool",
				tags: ["edit", tool],
				sessionId: null,
				turnId: null,
				toolCallId: part.callID,
			}
		}
		case "bash": {
			if (state.status !== "completed") return null
			const command = (input.command as string | undefined) ?? ""
			const output = state.output ?? ""
			const error =
				state.status === "error" ? (state as { error: string }).error : undefined
			const content = [
				command ? `$ ${command}` : null,
				output || error ? "" : null,
				output,
				error ? `\n[error]\n${error}` : null,
			]
				.filter((s) => s !== null)
				.join("\n")
			if (!content.trim()) return null
			return {
				kind: "bash",
				title: command ? command.slice(0, 80) : "Shell output",
				subtitle: filePath ?? null,
				content,
				language: "bash",
				mime: null,
				source: "tool",
				tags: ["bash"],
				sessionId: null,
				turnId: null,
				toolCallId: part.callID,
			}
		}
		case "webfetch": {
			if (state.status !== "completed") return null
			const url = (input.url as string | undefined) ?? null
			const content = state.output ?? ""
			if (!content.trim()) return null
			const format = (input.format as string | undefined) ?? null
			return {
				kind: format === "html" ? "html" : format === "json" ? "json" : "text",
				title: url ?? "Fetched content",
				subtitle: url,
				content,
				language: format === "json" ? "json" : format === "html" ? "html" : null,
				mime: format ? `text/${format}` : null,
				source: "tool",
				tags: ["webfetch", url ?? ""].filter(Boolean),
				sessionId: null,
				turnId: null,
				toolCallId: part.callID,
			}
		}
		case "glob":
		case "grep":
		case "list": {
			if (state.status !== "completed") return null
			const content = state.output ?? ""
			if (!content.trim()) return null
			const pattern = (input.pattern as string | undefined) ?? null
			return {
				kind: "text",
				title: `${tool}: ${pattern ?? "results"}`,
				subtitle: pattern,
				content,
				language: null,
				mime: null,
				source: "tool",
				tags: ["search", tool],
				sessionId: null,
				turnId: null,
				toolCallId: part.callID,
			}
		}
		default: {
			if (state.status !== "completed") return null
			const content = state.output ?? ""
			if (!content.trim()) return null
			return {
				kind: "text" as ArtifactKind,
				title: `${tool} output`,
				subtitle: null,
				content,
				language: null,
				mime: null,
				source: "tool",
				tags: [tool],
				sessionId: null,
				turnId: null,
				toolCallId: part.callID,
			}
		}
	}
}

export const SaveArtifactButton = memo(function SaveArtifactButton({
	part,
	sessionId,
	turnId,
	projectRoot: _projectRoot,
}: SaveArtifactButtonProps) {
	const [state, setState] = useState<"idle" | "saving" | "saved">("idle")

	const handleSave = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			if (state !== "idle") return
			const payload = detectKindAndContent(part)
			if (!payload) {
				toast.error("Nothing to save", { description: "This tool has no output yet." })
				return
			}
			if (new TextEncoder().encode(payload.content).length > SAVE_BUTTON_CONTENT_LIMIT) {
				toast.error("Output too large to save", {
					description: `Limit is ${SAVE_BUTTON_CONTENT_LIMIT / 1024}KB.`,
				})
				return
			}
			setState("saving")
			storeArtifact({
				...payload,
				sessionId: sessionId ?? payload.sessionId,
				turnId: turnId ?? payload.turnId,
			})
				.then((saved) => {
					if (!saved) {
						setState("idle")
						toast.error("Save failed", {
							description: "The artifact service is unavailable.",
						})
						return
					}
					setState("saved")
					toast.success("Saved to artifacts", {
						description: saved.title,
					})
					setTimeout(() => setState("idle"), 1400)
				})
				.catch((err) => {
					setState("idle")
					toast.error("Save failed", {
						description: err instanceof Error ? err.message : String(err),
					})
				})
		},
		[part, sessionId, turnId, state],
	)

	// Only show for completed states — error states have no parseable output
	// for most tools, so the button would be a no-op. Hide it.
	if (part.state.status !== "completed") return null

	const icon =
		state === "saving" ? (
			<Loader2Icon className="size-3 animate-spin" aria-hidden="true" />
		) : state === "saved" ? (
			<CheckIcon className="size-3 text-green-500" aria-hidden="true" />
		) : (
			<BookmarkIcon className="size-3" aria-hidden="true" />
		)

	const label =
		state === "saved"
			? "Saved"
			: state === "saving"
				? "Saving…"
				: "Save to artifacts"

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<button
						type="button"
						onClick={handleSave}
						aria-label={label}
						className="rounded p-0.5 text-muted-foreground/40 transition-colors hover:bg-muted hover:text-foreground"
					/>
				}
			>
				{icon}
			</TooltipTrigger>
			<TooltipContent side="top" className="text-xs">
				{label}
			</TooltipContent>
		</Tooltip>
	)
})
