import { atom } from "jotai"

/**
 * Detail block forwarded from the main process when a `session:superseded`
 * IPC event arrives. See
 * `apps/desktop/src/main/session-lock.ts::SessionSupersededError.detail`.
 */
export interface SessionSupersededDetail {
	otherPid: number
	otherSurface: "cli" | "desktop"
	lockPath: string
}

export const sessionSupersededAtom = atom<SessionSupersededDetail | null>(null)

/**
 * Clears the atom after the user dismisses the banner. Note: the banner copy
 * is informational, not actionable — once an existing instance is active the
 * only true recovery is to quit this Electron process, so dismissing just
 * hides the overlay until the next ensureServer() request re-broadcasts it.
 */
export const sessionSupersededDismissAtom = atom(null, (_get, set) => {
	set(sessionSupersededAtom, null)
})
