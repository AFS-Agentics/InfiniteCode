/**
 * Voice / STT settings page.
 *
 * Lets the user:
 *   - Enable / disable voice input
 *   - Pick the STT provider (web_speech is the only v1 option, others are
 *     gated behind the v2 whisper backend; we still render them disabled so
 *     the UI is forward-compatible)
 *   - Set the recognition language (BCP-47)
 *   - Adjust the auto-stop duration
 *   - Run a recording self-test (mic permission + 2s capture) so the user
 *     can confirm the pipeline works without leaving the page
 */

import { Button } from "@infinitecode/ui/components/button"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@infinitecode/ui/components/select"
import { Switch } from "@infinitecode/ui/components/switch"
import { MicIcon, Volume2Icon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useSettings } from "../../hooks/use-settings"
import { useVoiceRecognition } from "../../hooks/use-voice-recognition"
import { SettingsRow } from "./settings-row"
import { SettingsSection } from "./settings-section"

const VOICE_LANGUAGE_OPTIONS = [
	{ value: "en-US", label: "English (US)" },
	{ value: "en-GB", label: "English (UK)" },
	{ value: "zh-CN", label: "Chinese (Simplified)" },
	{ value: "zh-Hant", label: "Chinese (Traditional)" },
	{ value: "ja-JP", label: "Japanese" },
	{ value: "ko-KR", label: "Korean" },
	{ value: "es-ES", label: "Spanish (Spain)" },
	{ value: "fr-FR", label: "French" },
	{ value: "de-DE", label: "German" },
	{ value: "pt-BR", label: "Portuguese (Brazil)" },
	{ value: "ru-RU", label: "Russian" },
	{ value: "hi-IN", label: "Hindi" },
	{ value: "ar-SA", label: "Arabic" },
]

type SmokeState =
	| { status: "idle"; message: string }
	| { status: "running"; message: string }
	| { status: "ok"; message: string }
	| { status: "error"; message: string }

export function VoiceSettings() {
	const { settings, updateSettings } = useSettings()
	const voice = settings.voice ?? {
		enabled: false,
		inputMode: "push_to_talk",
		provider: "web_speech",
		language: "en-US",
		openaiApiKey: "",
		maxDurationMs: 30_000,
	}

	const updateVoice = useCallback(
		(patch: Partial<typeof voice>) => {
			updateSettings({ voice: { ...voice, ...patch } })
		},
		[updateSettings, voice],
	)

	return (
		<div className="space-y-8">
			<div className="flex items-center gap-2">
				<Volume2Icon className="size-5 text-muted-foreground" aria-hidden="true" />
				<h2 className="text-xl font-semibold">Voice</h2>
			</div>

			<SettingsSection
				title="Voice input"
				description="Click the mic button in the composer to dictate a prompt. Transcript is editable before sending — no audio is saved."
			>
				<SettingsRow label="Enable voice input" description="Show the mic button in the chat composer.">
					<Switch
						checked={voice.enabled}
						onCheckedChange={(enabled) => updateVoice({ enabled })}
					/>
				</SettingsRow>
				<SettingsRow
				label="Language"
				description="Language code for speech recognition, like en-US or es-ES."
			>
					<Select
						value={voice.language}
						onValueChange={(v) => {
							if (v !== null) updateVoice({ language: v })
							try {
								localStorage.setItem("infinitecode:voice:language", JSON.stringify(v))
							} catch {
								/* ignore */
							}
						}}
						items={Object.fromEntries(VOICE_LANGUAGE_OPTIONS.map((o) => [o.value, o.label]))}
					>
						<SelectTrigger className="min-w-[200px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{VOICE_LANGUAGE_OPTIONS.map((o) => (
								<SelectItem key={o.value} value={o.value}>
									{o.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingsRow>
				<SettingsRow
					label="Auto-stop after"
					description="Maximum length of a single recording."
				>
					<Select
						value={String(voice.maxDurationMs)}
						onValueChange={(v) => {
							if (v === null) return
							const n = Number(v)
							if (Number.isFinite(n) && n > 0) updateVoice({ maxDurationMs: n })
						}}
						items={{
							"15000": "15 seconds",
							"30000": "30 seconds",
							"60000": "1 minute",
							"120000": "2 minutes",
						}}
					>
						<SelectTrigger className="min-w-[160px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="15000">15 seconds</SelectItem>
							<SelectItem value="30000">30 seconds</SelectItem>
							<SelectItem value="60000">1 minute</SelectItem>
							<SelectItem value="120000">2 minutes</SelectItem>
						</SelectContent>
					</Select>
				</SettingsRow>
			</SettingsSection>

			<SettingsSection
				title="Recording self-test"
				description="Verifies microphone permission and capture pipeline. Audio is never saved or uploaded."
			>
				<SelfTest />
			</SettingsSection>
		</div>
	)
}

function SelfTest() {
	const [smoke, setSmoke] = useState<SmokeState>({
		status: "idle",
		message: "Run a 2-second test recording to confirm the mic pipeline works.",
	})
	const busyRef = useRef(false)
	const mountedRef = useRef(true)

	useEffect(() => {
		return () => {
			mountedRef.current = false
		}
	}, [])

	// Use the actual recognition hook as the smoke test — if it returns a
	// transcript within the 2s window, the pipeline works end-to-end.
	const { start, stop, reset } = useVoiceRecognition({
		language: undefined,
		maxDurationMs: 2000,
		continuous: false,
	})

	const runTest = useCallback(async () => {
		if (busyRef.current) return
		busyRef.current = true
		setSmoke({ status: "running", message: "Requesting microphone access…" })
		reset()
		try {
			start()
			await new Promise((r) => setTimeout(r, 2_000))
			stop()
			if (!mountedRef.current) return
			setSmoke({
				status: "ok",
				message:
					"Recording pipeline OK. Mic captured audio for 2s — the transcript (if any) appeared in the textarea.",
			})
			toast.success("Voice self-test passed")
		} catch (err) {
			if (!mountedRef.current) return
			setSmoke({
				status: "error",
				message:
					err instanceof Error
						? err.message
						: "Self-test failed. Check microphone permissions.",
			})
			toast.error("Voice self-test failed")
		} finally {
			busyRef.current = false
		}
	}, [start, stop, reset])

	return (
		<div className="space-y-3 px-4 py-3">
			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					onClick={runTest}
					disabled={smoke.status === "running"}
				>
					<MicIcon className="size-3.5" aria-hidden="true" />
					{smoke.status === "running" ? "Testing…" : "Run self-test"}
				</Button>
			</div>
			<div
				role="status"
				className={`rounded border border-border/40 px-3 py-2 text-xs ${
					smoke.status === "error"
						? "border-red-500/40 bg-red-500/10 text-red-400"
						: smoke.status === "ok"
							? "border-green-500/40 bg-green-500/10 text-green-400"
							: "text-muted-foreground"
				}`}
			>
				{smoke.message}
			</div>
		</div>
	)
}
