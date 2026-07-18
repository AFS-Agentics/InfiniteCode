/**
 * Voice recognition hook — wraps the browser Web Speech API (`SpeechRecognition`
 * / `webkitSpeechRecognition`) into a typed, declarative React API for the
 * Electron renderer.
 *
 * Why Web Speech API and not a custom Whisper backend?
 * - Zero dependencies, no model download, no extra disk footprint.
 * - Works in Chromium out of the box (Electron renderer).
 * - Fine for short voice-to-text prompts; not for production transcription.
 * - For high-quality transcription, swap the hook body for a Whisper fetch —
 *   the public surface area (start/stop/transcript/error) is intentionally
 *   small so the swap is local.
 *
 * Browser support:
 * - Chromium / Electron: standard `SpeechRecognition` since Chrome 33.
 * - macOS Electron 25+: SpeechRecognition works without a network call for
 *   offline dictionaries when available; falls back to Google's online
 *   service otherwise. Either way, audio is processed in Chromium's speech
 *   service, not by InfiniteCode.
 *
 * Security note: the Web Speech API does NOT support custom auth, so we
 * never see or store the audio. This matches the "transcript only enters the
 * composer for user review" boundary in the Maka voice threat model.
 */

import { useCallback, useEffect, useRef, useState } from "react"

export type VoiceStatus =
	| "idle"
	| "starting"
	| "listening"
	| "stopping"
	| "error"
	| "unsupported"

export interface UseVoiceRecognitionOptions {
	/** BCP-47 language code, e.g. "en-US". Default: browser default. */
	language?: string
	/** Auto-stop after this many ms. Default 30s. */
	maxDurationMs?: number
	/** Continuous vs single-shot mode. Default: false (single shot). */
	continuous?: boolean
	/** Called on every interim + final transcript chunk. */
	onResult?: (text: string, isFinal: boolean) => void
}

export interface UseVoiceRecognitionResult {
	status: VoiceStatus
	transcript: string
	interimTranscript: string
	error: string | null
	start: () => void
	stop: () => void
	reset: () => void
	isAvailable: boolean
}

// Type-only declaration of the SpeechRecognition constructor — Chromium's
// built-in type lives in lib.dom.d.ts but Electron's preload typings don't
// always include it, so we fall back to `webkit`-prefixed.
type AnySpeechRecognition = unknown & {
	start: () => void
	stop: () => void
	abort: () => void
	continuous: boolean
	interimResults: boolean
	lang: string
	maxAlternatives: number
	onresult: ((event: unknown) => void) | null
	onerror: ((event: unknown) => void) | null
	onend: (() => void) | null
	onstart: (() => void) | null
}

declare global {
	interface Window {
		SpeechRecognition?: new () => AnySpeechRecognition
		webkitSpeechRecognition?: new () => AnySpeechRecognition
	}
}

function pickCtor(): (new () => AnySpeechRecognition) | null {
	if (typeof window === "undefined") return null
	if (typeof window.SpeechRecognition === "function") return window.SpeechRecognition
	if (typeof window.webkitSpeechRecognition === "function")
		return window.webkitSpeechRecognition
	return null
}

export function useVoiceRecognition(
	options: UseVoiceRecognitionOptions = {},
): UseVoiceRecognitionResult {
	const {
		language,
		maxDurationMs = 30_000,
		continuous = false,
		onResult,
	} = options

	const ctorRef = useRef<((new () => AnySpeechRecognition) | null) | undefined>(
		undefined,
	)
	if (ctorRef.current === undefined) ctorRef.current = pickCtor()

	const recogRef = useRef<AnySpeechRecognition | null>(null)
	const maxDurationTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const onResultRef = useRef<typeof onResult>(onResult)

	useEffect(() => {
		onResultRef.current = onResult
	}, [onResult])

	const [status, setStatus] = useState<VoiceStatus>(
		ctorRef.current ? "idle" : "unsupported",
	)
	const [transcript, setTranscript] = useState("")
	const [interimTranscript, setInterimTranscript] = useState("")
	const [error, setError] = useState<string | null>(null)

	const isAvailable = ctorRef.current !== null

	const cleanup = useCallback(() => {
		if (maxDurationTimer.current) {
			clearTimeout(maxDurationTimer.current)
			maxDurationTimer.current = null
		}
		recogRef.current = null
	}, [])

	const stop = useCallback(() => {
		const r = recogRef.current
		if (!r) return
		try {
			setStatus("stopping")
			r.stop()
		} catch {
			// ignore — already stopped
		}
		cleanup()
	}, [cleanup])

	const reset = useCallback(() => {
		setTranscript("")
		setInterimTranscript("")
		setError(null)
		setStatus(ctorRef.current ? "idle" : "unsupported")
	}, [])

	const start = useCallback(() => {
		if (!ctorRef.current) {
			setStatus("unsupported")
			setError("Web Speech API is not available in this environment.")
			return
		}
		if (recogRef.current) {
			// already listening — no-op
			return
		}
		setError(null)
		setTranscript("")
		setInterimTranscript("")
		setStatus("starting")

		const recog = new ctorRef.current()
		recog.continuous = continuous
		recog.interimResults = true
		if (language) recog.lang = language
		recog.maxAlternatives = 1

		recog.onstart = () => {
			setStatus("listening")
		}

		recog.onresult = (event: unknown) => {
			// Shape: { resultIndex, results: ArrayLike<{ 0: { transcript }, isFinal }> }
			const e = event as {
				resultIndex?: number
				results?: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>
			}
			if (!e || !e.results) return
			let interim = ""
			let finalText = ""
			for (let i = 0; i < e.results.length; i++) {
				const result = e.results[i]
				if (!result || result.length === 0) continue
				const text = result[0]?.transcript ?? ""
				if (result.isFinal) {
					finalText += text
				} else {
					interim += text
				}
			}
			if (interim) setInterimTranscript(interim)
			if (finalText) {
				setTranscript((prev) => {
					const next = (prev ? prev + " " : "") + finalText.trim()
					onResultRef.current?.(next, true)
					return next
				})
				setInterimTranscript("")
			} else if (interim) {
				onResultRef.current?.(interim, false)
			}
		}

		recog.onerror = (event: unknown) => {
			const e = event as { error?: string; message?: string }
			const code = e?.error ?? "unknown"
			let humanMessage: string
			switch (code) {
				case "not-allowed":
				case "service-not-allowed":
					humanMessage =
						"Microphone access denied. Check Settings → Privacy & Security → Microphone."
					break
				case "no-speech":
					humanMessage = "No speech detected. Try again."
					break
				case "audio-capture":
					humanMessage = "No microphone available."
					break
				case "network":
					humanMessage = "Speech recognition requires network access."
					break
				default:
					humanMessage = e?.message ?? code
			}
			setError(humanMessage)
			setStatus("error")
			cleanup()
		}

		recog.onend = () => {
			setStatus((current) => (current === "stopping" ? "idle" : current))
			cleanup()
		}

		recogRef.current = recog
		try {
			recog.start()
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
			setStatus("error")
			cleanup()
			return
		}

		if (maxDurationMs > 0) {
			maxDurationTimer.current = setTimeout(() => {
				const r = recogRef.current
				if (r) {
					try {
						r.stop()
					} catch {
						// ignore
					}
				}
			}, maxDurationMs)
		}
	}, [continuous, language, maxDurationMs, cleanup])

	// Cleanup on unmount.
	useEffect(() => {
		return () => {
			if (maxDurationTimer.current) clearTimeout(maxDurationTimer.current)
			const r = recogRef.current
			if (r) {
				try {
					r.abort()
				} catch {
					// ignore
				}
			}
			recogRef.current = null
		}
	}, [])

	return {
		status,
		transcript,
		interimTranscript,
		error,
		start,
		stop,
		reset,
		isAvailable,
	}
}
