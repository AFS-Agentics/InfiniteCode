/**
 * Mic button — toggle button shown in the chat composer when voice input is
 * enabled. Click to start recording, click again to stop and insert the
 * transcript into the prompt input.
 *
 * Uses the Web Speech API via the `useVoiceRecognition` hook. Renders a
 * disabled tooltip when the API is unavailable (e.g. older Electron builds).
 *
 * The button inserts transcript into the prompt input by talking to the
 * same `PromptInputController` that the slash-command bridge uses, so it
 * composes cleanly with the existing composer state.
 */

import { usePromptInputController } from "@infinitecode/ui/components/ai-elements/prompt-input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@infinitecode/ui/components/tooltip"
import { Loader2Icon, MicIcon, MicOffIcon } from "lucide-react"
import { useCallback, useEffect, useRef } from "react"
import { useSettings } from "../../hooks/use-settings"
import { useVoiceRecognition } from "../../hooks/use-voice-recognition"

interface MicButtonProps {
	/** Disabled when the agent is busy or the composer is offline. */
	disabled?: boolean
}

function resolveLanguage(): string | undefined {
	try {
		if (typeof localStorage === "undefined") return undefined
		const raw = localStorage.getItem("infinitecode:voice:language")
		if (!raw) return undefined
		const parsed = JSON.parse(raw)
		return typeof parsed === "string" && parsed.length > 0 ? parsed : undefined
	} catch {
		return undefined
	}
}

export function MicButton({ disabled }: MicButtonProps) {
	const { settings } = useSettings()
	const voiceEnabled = settings.voice?.enabled ?? false
	const language = resolveLanguage()
	const controller = usePromptInputController()

	const { status, transcript, error, start, stop, reset, isAvailable } =
		useVoiceRecognition({
			language,
			maxDurationMs: settings.voice?.maxDurationMs ?? 30_000,
			continuous: settings.voice?.inputMode === "toggle_to_record",
		})

	// Track the last transcript we inserted so we don't double-insert on
	// re-renders triggered by hook state changes.
	const lastInsertedRef = useRef<string>("")

	const insertIntoComposer = useCallback(
		(text: string) => {
			if (!text) return
			const current = controller.textInput.value
			const separator = current.length > 0 && !current.endsWith(" ") && !current.endsWith("\n")
				? " "
				: ""
			controller.textInput.setInput(current ? `${current}${separator}${text}` : text)
		},
		[controller],
	)

	// Insert transcript when user stops listening (single-shot mode).
	useEffect(() => {
		if (status === "idle" && transcript && transcript !== lastInsertedRef.current) {
			insertIntoComposer(transcript)
			lastInsertedRef.current = transcript
			reset()
		}
	}, [status, transcript, insertIntoComposer, reset])

	// Stop if disabled prop flips to true (composer goes offline / agent busy).
	useEffect(() => {
		if (disabled && (status === "listening" || status === "starting")) {
			stop()
		}
	}, [disabled, status, stop])

	const handleClick = useCallback(() => {
		if (status === "listening" || status === "starting") {
			stop()
		} else {
			reset()
			lastInsertedRef.current = ""
			start()
		}
	}, [status, start, stop, reset])

	if (!voiceEnabled) return null

	const listening = status === "listening" || status === "starting"
	const busy = status === "starting" || status === "stopping"

	const icon = !isAvailable ? (
		<MicOffIcon className="size-4 text-muted-foreground/40" aria-hidden="true" />
	) : busy ? (
		<Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
	) : listening ? (
		<MicIcon className="size-4 animate-pulse text-red-400" aria-hidden="true" />
	) : (
		<MicIcon className="size-4" aria-hidden="true" />
	)

	const label = !isAvailable
		? "Voice not supported in this build"
		: listening
			? "Stop recording"
			: "Start voice input"

	const tooltipBody = !isAvailable ? (
		<span>Voice input requires a Chromium-based build with Web Speech API.</span>
	) : error ? (
		<span className="text-red-400">{error}</span>
	) : listening ? (
		<span>Recording… Click to stop and insert.</span>
	) : (
		<span>Click to dictate a prompt.</span>
	)

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<button
						type="button"
						onClick={handleClick}
						disabled={disabled || !isAvailable}
						aria-label={label}
						className={`inline-flex size-8 items-center justify-center rounded-md border border-border/60 bg-background transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${
							listening ? "border-red-400/50 bg-red-500/10" : ""
						}`}
					/>
				}
			>
				{icon}
			</TooltipTrigger>
			<TooltipContent side="top" className="max-w-xs text-xs">
				{tooltipBody}
			</TooltipContent>
		</Tooltip>
	)
}
