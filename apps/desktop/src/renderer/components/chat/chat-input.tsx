import {
	PromptInput,
	PromptInputButton,
	PromptInputFooter,
	PromptInputProvider,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
	usePromptInputAttachments,
	usePromptInputController,
} from "@infinitecode/ui/components/ai-elements/prompt-input"
import { PlusIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { setProjectModelAtom } from "../../atoms/preferences"
import { appStore } from "../../atoms/store"
import { useDraftActions, useDraftSnapshot } from "../../hooks/use-draft"
import type { ConfigData, ModelRef, ProvidersData, SdkAgent } from "../../hooks/use-infinitecode-data"
import {
	getModelInputCapabilities,
	resolveEffectiveModel,
	useModelState,
} from "../../hooks/use-infinitecode-data"
import type { Agent, FileAttachment } from "../../lib/types"
import { createLogger } from "../../lib/logger"
import { detectLanguage } from "../../lib/language"
import { storeArtifact } from "../../services/artifact-service"
import type { ArtifactInput, ArtifactKind } from "../../preload/api"

import { ContextItems } from "./context-items"
import { MicButton } from "./mic-button"
import { type MentionOption, MentionPopover, type MentionPopoverHandle } from "./mention-popover"
import { PromptAttachmentPreview } from "./prompt-attachments"
import {
	createMentionFromOption,
	getMentionKey,
	getMentionMarker,
	insertMentionIntoText,
	type PromptMention,
	reconcileMentions,
} from "./prompt-mentions"
import { PromptToolbar } from "./prompt-toolbar"
import { SlashCommandPopover, type SlashCommandPopoverHandle } from "./slash-command-popover"

/** Hard timeout for the Stop button UX state.  If the abort RPC hasn't
 *  round-tripped within this window we clear our local "stopping" indicator
 *  so the user can retry or compose a follow-up.  Matches the InfiniteCode
 *  TUI's stop-button heuristic; tune via Settings if needed. */
const STOP_HARD_TIMEOUT_MS = 5_000

const log = createLogger("chat-input")

/**
 * Resolve an uploaded file to an ArtifactInput ready for the artifact store.
 *
 * Reads the blob content eagerly so the artifact survives:
 *   - blob: URL expiry (objects are revoked on unmount)
 *   - tab/app restarts
 *
 * For images we embed the data URL inline so `kind: "image"` previews still
 * render in the artifact pane after a restart.  For text-like media we
 * preserve the literal content (so the user can re-open the file as a
 * normal text artifact).  For arbitrary binary we record metadata only — the
 * user can always re-attach from disk.
 */
async function uploadedFileToArtifactInput(
	file: FileAttachment,
	sessionId: string,
): Promise<ArtifactInput | null> {
	if (!file.url) return null
	const mime: string = file.mediaType || "application/octet-stream"
	const filename = file.filename ?? "Uploaded file"

	let content: string
	let kind: ArtifactKind
	let language: string | null = null

	try {
		const response = await fetch(file.url)
		if (!response.ok) throw new Error(`fetch failed: ${response.status}`)

		if (mime.startsWith("image/")) {
			// Inline as a data URL so previews survive the blob: expiry.
			const blob = await response.blob()
			content = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader()
				reader.onloadend = () => resolve((reader.result as string) ?? "")
				reader.onerror = () => reject(reader.error ?? new Error("FileReader error"))
				reader.readAsDataURL(blob)
			})
			kind = "image"
		} else if (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml") {
			content = await response.text()
			kind = mime === "application/json" ? "json" : "text"
			language = detectLanguage(filename) ?? null
		} else {
			// Binary: store a metadata marker rather than the bytes.  The
			// panes' "file" viewer still shows the filename + mime.
			content = `[uploaded file] ${filename}\n${mime}`
			kind = "file"
		}
	} catch (err) {
		log.warn("upload-to-artifact: failed to read attachment blob", { filename }, err)
		// Still record the upload so the user sees something in the list —
		// better than silently dropping the file they attached.
		content = `[uploaded file] ${filename}\n${mime}`
		kind = "file"
	}

	// Derive subtitle from the actual kind so image uploads get “image/png ·
	// uploaded” rather than a generic marker.
	const subtitle =
		kind === "image"
			? `${mime} · image upload`
			: kind === "json"
				? `${mime} · code upload`
				: `${mime} · upload`

	return {
		kind,
		title: filename.length > 200 ? `${filename.slice(0, 197)}...` : filename,
		subtitle,
		content,
		language,
		mime,
		source: "user",
		tags: ["upload", mime],
		sessionId,
	}
}

/**
 * Fire-and-forget: turn any files attached to the just-sent message into
 * artifacts so the user can find them in the Artifacts pane later (parity
 * with the way tool outputs appear after Save).  Runs after `onSendMessage`
 * so a slow filesystem read never delays the request from going out.
 */
function persistUploadedFilesAsArtifacts(
	files: FileAttachment[] | undefined,
	agent: Agent,
): void {
	if (!files || files.length === 0) return
	void Promise.all(
		files.map(async (file) => {
			const payload = await uploadedFileToArtifactInput(file, agent.sessionId)
			if (!payload) return
			try {
				await storeArtifact(payload)
			} catch (err) {
				log.error("Failed to persist uploaded file as artifact", { filename: file.filename }, err)
			}
		}),
	)
}

interface ChatInputProps {
	agent: Agent
	isConnected: boolean
	onSendMessage?: (
		agent: Agent,
		message: string,
		options?: { model?: ModelRef; agentName?: string; variant?: string; files?: FileAttachment[] },
	) => Promise<void>
	onStop?: (agent: Agent) => Promise<void>
	providers?: ProvidersData | null
	config?: ConfigData | null
	infinitecodeAgents?: SdkAgent[]
	onScrollToBottom: (behavior?: "instant" | "smooth") => void
	handleSlashCommand: (text: string) => Promise<boolean>
}

function AttachButton({ disabled }: { disabled?: boolean }) {
	const attachments = usePromptInputAttachments()
	return (
		<PromptInputButton
			tooltip="Attach files"
			onClick={() => attachments.openFileDialog()}
			disabled={disabled}
		>
			<PlusIcon className="size-4" />
		</PromptInputButton>
	)
}

function DraftSync({ setDraft }: { setDraft: (text: string) => void }) {
	const controller = usePromptInputController()
	const value = controller.textInput.value
	const isFirstRender = useRef(true)

	useEffect(() => {
		if (isFirstRender.current) {
			isFirstRender.current = false
			return
		}
		setDraft(value)
	}, [value, setDraft])

	return null
}

function SlashCommandBridge({
	controllerRef,
}: {
	controllerRef: React.RefObject<{ setText: (text: string) => void; getText: () => string } | null>
}) {
	const controller = usePromptInputController()
	useEffect(() => {
		if (controllerRef && "current" in controllerRef) {
			;(controllerRef as React.MutableRefObject<typeof controllerRef.current>).current = {
				setText: (text: string) => controller.textInput.setInput(text),
				getText: () => controller.textInput.value,
			}
		}
		return () => {
			if (controllerRef && "current" in controllerRef) {
				;(controllerRef as React.MutableRefObject<typeof controllerRef.current>).current = null
			}
		}
	}, [controller, controllerRef])
	return null
}

function TriggerDetector({
	onSlashChange,
	onMentionChange,
}: {
	onSlashChange: (open: boolean, query: string) => void
	onMentionChange: (open: boolean, query: string) => void
}) {
	const controller = usePromptInputController()
	const inputText = controller.textInput.value
	useEffect(() => {
		const textarea = document.querySelector<HTMLTextAreaElement>("textarea[data-prompt-input]")
		const cursorPos = textarea?.selectionStart ?? inputText.length
		const textBeforeCursor = inputText.slice(0, cursorPos)
		const slashMatch = inputText.match(/^\/(\S*)$/)
		if (slashMatch) {
			onSlashChange(true, slashMatch[1])
			onMentionChange(false, "")
			return
		}
		const atMatch = textBeforeCursor.match(/@(\S*)$/)
		if (atMatch) {
			onMentionChange(true, atMatch[1])
			onSlashChange(false, "")
			return
		}
		onSlashChange(false, "")
		onMentionChange(false, "")
	}, [inputText, onSlashChange, onMentionChange])
	return null
}

function MentionReconciler({
	mentions,
	onReconcile,
}: {
	mentions: PromptMention[]
	onReconcile: (updated: PromptMention[]) => void
}) {
	const controller = usePromptInputController()
	const inputText = controller.textInput.value
	useEffect(() => {
		if (mentions.length === 0) return
		const reconciled = reconcileMentions(mentions, inputText)
		if (reconciled.length !== mentions.length) {
			onReconcile(reconciled)
		}
	}, [inputText, mentions, onReconcile])
	return null
}

export function ChatInput({
	agent,
	isConnected,
	onSendMessage,
	onStop,
	providers,
	config,
	infinitecodeAgents,
	onScrollToBottom,
	handleSlashCommand,
}: ChatInputProps) {
	const isWorking = agent.status === "running"
	const [sending, setSending] = useState(false)
	/**
	 * Tracks the user's intent to stop the current response.  Flips true the
	 * moment the Stop button is clicked so the UI swaps the static stop icon
	 * for an animated Spinner (PromptInputSubmit's "submitted" state) — even if
	 * the server's abort RPC hasn't round-tripped yet.  A hard 5s timeout
	 * guarantees `stopping` clears even when the abort hangs so the user is
	 * never stuck on a "stopping…" indicator with no recourse.
	 */
	const [stopping, setStopping] = useState(false)
	const [mentions, setMentions] = useState<PromptMention[]>([])
	const [, startTransition] = useTransition()

	const { setDraft, clearDraft } = useDraftActions(agent.sessionId)
	const draft = useDraftSnapshot(agent.sessionId)

	const [selectedModel, setSelectedModel] = useState<ModelRef | null>(null)
	const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
	const [selectedVariant, setSelectedVariant] = useState<string | undefined>(undefined)

	const { addRecent: addRecentModel } = useModelState()

	// Resolve effective model

	const effectiveModel = resolveEffectiveModel(
		selectedModel,
		infinitecodeAgents?.find((a) => a.name === (selectedAgent ?? config?.defaultAgent)) ?? null,
		config?.model,
		providers?.defaults ?? {},
		providers?.providers ?? [],
	)

	const modelCapabilities = getModelInputCapabilities(effectiveModel, providers?.providers ?? [])

	// Popover state
	const [slashOpen, setSlashOpen] = useState(false)
	const [slashQuery, setSlashQuery] = useState("")
	const [mentionOpen, setMentionOpen] = useState(false)
	const [mentionQuery, setMentionQuery] = useState("")

	const slashPopoverRef = useRef<SlashCommandPopoverHandle>(null)
	const mentionPopoverRef = useRef<MentionPopoverHandle>(null)
	const slashCommandRef = useRef<{ setText: (t: string) => void; getText: () => string } | null>(
		null,
	)

	const handleSend = useCallback(
		async (text: string, files?: FileAttachment[]) => {
			if (!text.trim() || !onSendMessage || sending) return

			if (text.trim().startsWith("/")) {
				const handled = await handleSlashCommand(text)
				if (handled) {
					slashCommandRef.current?.setText("")
					clearDraft()
					setMentions([])
					return
				}
			}

			setSending(true)
			try {
				if (effectiveModel && agent.directory) {
					appStore.set(setProjectModelAtom, {
						directory: agent.directory,
						model: {
							...effectiveModel,
							variant: selectedVariant,
							agent: selectedAgent || undefined,
						},
					})
				}
			await onSendMessage(agent, text.trim(), {
				model: effectiveModel ?? undefined,
				agentName: selectedAgent || undefined,
				variant: selectedVariant,
				files,
			})
			// Persist every uploaded file as a user-source artifact so the
			// Artifacts pane surfaces them alongside tool-saved outputs.
			// Fire-and-forget; the IPC channel will broadcast `artifact:changed`
			// and the list will refresh on its own.
			persistUploadedFilesAsArtifacts(files, agent)
			clearDraft()
			setMentions([])
			onScrollToBottom("smooth")
		} finally {
			setSending(false)
		}
		},
		[
			onSendMessage,
			sending,
			agent,
			effectiveModel,
			selectedAgent,
			selectedVariant,
			clearDraft,
			onScrollToBottom,
			handleSlashCommand,
		],
	)

	// Hard-timeout safety net for the Stop button: if the abort RPC round-trip
	// stalls (slow server, dropped websocket, etc.) we still want the indicator
	// to clear so the user can retry.  STOP_HARD_TIMEOUT_MS is generous for a
	// local abort and short enough to feel responsive.
	useEffect(() => {
		if (!stopping) return
		const id = setTimeout(() => {
			log.warn("Stop button: hard-timeout reached, clearing local stopping state", {
				sessionId: agent.sessionId,
				directory: agent.directory,
				timeoutMs: STOP_HARD_TIMEOUT_MS,
			})
			setStopping(false)
		}, STOP_HARD_TIMEOUT_MS)
		return () => clearTimeout(id)
	}, [stopping, agent.sessionId, agent.directory])

	const handleStopClick = useCallback(async () => {
		if (!onStop) {
			// Loud warning: clicking Stop with no wired handler is a wiring bug.
			log.warn("Stop button clicked but no onStop handler is wired", {
				sessionId: agent.sessionId,
			})
			return
		}
		log.debug("Stop button: dispatching abort", {
			sessionId: agent.sessionId,
			directory: agent.directory,
		})
		// Flip `stopping` synchronously so the UI swaps the Stop icon for the
		// Spinner on the same paint, regardless of how slow the abort RPC is.
		setStopping(true)
		try {
			await onStop(agent)
		} catch (err) {
			log.error("Stop handler threw", { sessionId: agent.sessionId }, err)
		} finally {
			setStopping(false)
		}
	}, [agent, onStop])

	const handleMentionSelect = useCallback((option: MentionOption) => {
		setMentionOpen(false)
		const ctrl = slashCommandRef.current
		if (!ctrl) return
		const currentText = ctrl.getText()
		const textarea = document.querySelector<HTMLTextAreaElement>("textarea[data-prompt-input]")
		const cursorPos = textarea?.selectionStart ?? currentText.length
		const mention = createMentionFromOption(option)
		const { text: newText, cursorPosition: newCursor } = insertMentionIntoText(
			currentText,
			cursorPos,
			mention,
		)
		ctrl.setText(newText)
		setMentions((prev) => {
			const key = getMentionKey(mention)
			if (prev.some((candidate) => getMentionKey(candidate) === key))
				return prev
			return [...prev, mention]
		})
		requestAnimationFrame(() => {
			const ta = document.querySelector<HTMLTextAreaElement>("textarea[data-prompt-input]")
			if (ta) {
				ta.focus()
				ta.setSelectionRange(newCursor, newCursor)
			}
		})
	}, [])

	const handleTextareaKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			// Always delegate to popovers first — they guard on their own `open` prop
			// internally, avoiding stale-closure issues with slashOpen/mentionOpen.
			if (slashPopoverRef.current?.handleKeyDown(e)) return
			if (mentionPopoverRef.current?.handleKeyDown(e)) return
		},
		[],
	)

	return (
		<PromptInputProvider key={agent.sessionId} initialInput={draft}>
			<DraftSync setDraft={setDraft} />
			<SlashCommandBridge controllerRef={slashCommandRef} />
			<TriggerDetector
				onSlashChange={(open, query) => {
					setSlashOpen(open)
					setSlashQuery(query)
				}}
				onMentionChange={(open, query) => {
					setMentionOpen(open)
					setMentionQuery(query)
				}}
			/>
			<MentionReconciler mentions={mentions} onReconcile={setMentions} />
			<div className="relative">
				<SlashCommandPopover
					ref={slashPopoverRef}
					query={slashQuery}
					open={slashOpen}
					enabled={isConnected}
					onSelect={(cmd) => {
						setSlashOpen(false)
						// Use the command string directly instead of setText + setTimeout
						// round-trip, which races with React's async state batching.
						if (cmd.startsWith("/")) {
							handleSlashCommand(cmd).then((handled) => {
								if (handled) {
									slashCommandRef.current?.setText("")
									clearDraft()
									setMentions([])
								} else {
									// Not recognized — leave it in input for normal send
									slashCommandRef.current?.setText(cmd)
								}
							})
						} else {
							slashCommandRef.current?.setText(cmd)
						}
					}}
					onClose={() => setSlashOpen(false)}
				/>
				<MentionPopover
					ref={mentionPopoverRef}
					query={mentionQuery}
					open={mentionOpen}
					directory={agent.directory}
					agents={infinitecodeAgents ?? []}
					onSelect={handleMentionSelect}
					onClose={() => setMentionOpen(false)}
				/>
				<PromptInput
					className="infinitecode-composer"
					onSubmit={(message) => {
						if (message.text.trim() && isConnected && !sending)
							handleSend(message.text, message.files.length > 0 ? message.files : undefined)
					}}
				>
					<ContextItems
						mentions={mentions}
						onRemove={(m) => {
							const marker = getMentionMarker(m)
							const ctrl = slashCommandRef.current
							if (ctrl) {
								const currentText = ctrl.getText()
								ctrl.setText(currentText.replace(`${marker} `, "").replace(marker, ""))
							}
							setMentions((prev) => prev.filter((x) => x !== m))
						}}
					/>
					<PromptAttachmentPreview
						supportsImages={modelCapabilities?.image}
						supportsPdf={modelCapabilities?.pdf}
					/>
					<PromptInputTextarea
						data-prompt-input
						onKeyDown={handleTextareaKeyDown}
						placeholder={isWorking ? "Send a follow-up message..." : "What would you like to do?"}
						disabled={!isConnected}
					/>
					<PromptInputFooter>
						<PromptInputTools>
							<AttachButton disabled={!isConnected} />
							<MicButton disabled={!isConnected} />
							<PromptToolbar
								agents={infinitecodeAgents ?? []}
								selectedAgent={selectedAgent}
								defaultAgent={config?.defaultAgent}
								onSelectAgent={(a) => startTransition(() => setSelectedAgent(a))}
								providers={providers ?? null}
								effectiveModel={effectiveModel}
								hasModelOverride={!!selectedModel}
								onSelectModel={(m) =>
									startTransition(() => {
										setSelectedModel(m)
										setSelectedVariant(undefined)
										if (m) addRecentModel(m)
									})
								}
								selectedVariant={selectedVariant}
								onSelectVariant={(v) => startTransition(() => setSelectedVariant(v))}
								disabled={!isConnected}
							/>
						</PromptInputTools>
						<PromptInputSubmit
							disabled={!isConnected || sending}
							// While `stopping` is true we surface the Spinner from
							// "submitted" status so the click is acknowledged
							// instantly, even before the abort RPC returns.
							status={
								stopping
									? "submitted"
									: isWorking
										? "streaming"
										: undefined
							}
							onStop={handleStopClick}
						/>
					</PromptInputFooter>
				</PromptInput>
			</div>
		</PromptInputProvider>
	)
}
