import { useEffect, useRef } from "react"
import { useAtom, useSetAtom } from "jotai"
import { toast } from "sonner"

import {
	sessionSupersededAtom,
	sessionSupersededDismissAtom,
} from "@/atoms/session-superseded"

/**
 * Invisible IPC bridge: subscribes to `window.infinitecode.onSessionSuperseded`
 * (forwarded from the main-process session-lock acquire failure) and writes
 * the detail block into `sessionSupersededAtom`. Mount this once near the
 * app root — sibling to the toast banner — so the atom is hot before any
 * `infinitecode:ensure` IPC call can fire.
 *
 * The `window.infinitecode` global is typed via the
 * `apps/desktop/src/preload/api.d.ts` `declare global { interface Window }`
 * block, so no defensive `as unknown as {...}` cast is necessary.
 */
export function SessionSupersededBridge() {
	const setDetail = useSetAtom(sessionSupersededAtom)
	useEffect(() => {
		const subscribe = window.infinitecode.onSessionSuperseded
		const off = subscribe((detail) => {
			setDetail(detail)
		})
		return () => {
			off()
		}
	}, [setDetail])
	return null
}

/**
 * Toast-only notification shown when the desktop window catches a
 * `session:superseded` IPC event.
 *
 * Under the per-(user, device) active-session rule, this only fires when a
 * DIFFERENT user signed in on this device while the current session was
 * alive. Same user opening a second device does NOT trigger supersede;
 * both remain Active in the coordination layer.
 *
 * Replacing the prior full-screen overlay with a sonner toast matches the
 * universal SaaS behavior (GitHub, Linear, Discord all use a fleeting
 * notification rather than a modal — the user is still able to keep
 * working while the PRIOR session ends). The toast auto-dismisses after
 * 6 seconds and the atom is cleared on either auto-dismiss or explicit
 * user click so we don't re-fire on subsequent re-renders.
 */
export function SessionSupersededBanner() {
	const [detail] = useAtom(sessionSupersededAtom)
	const [, dismiss] = useAtom(sessionSupersededDismissAtom)
	const lastFiredFor = useRef<string | null>(null)

	useEffect(() => {
		if (!detail) return
		// Suppress duplicate firings for the exact same event payload.
		const fingerprint = `${detail.otherPid}:${detail.otherSurface}:${detail.lockPath}`
		if (lastFiredFor.current === fingerprint) return
		lastFiredFor.current = fingerprint

		toast.error("Different account signed in here", {
			description:
				`A different account is now active on this device. Your previous session has ended. ` +
				`Active process: ${detail.otherSurface} pid ${detail.otherPid}.`,
			duration: 6_000,
			action: {
				label: "Dismiss",
				onClick: () => dismiss(),
			},
			onDismiss: () => {
				dismiss()
				lastFiredFor.current = null
			},
			onAutoClose: () => {
				dismiss()
				lastFiredFor.current = null
			},
		})
	}, [detail, dismiss])

	return null
}
