/**
 * Renderer-side auth state for the InfiniteCode desktop.
 *
 * Mirrors the website's `auth-provider.tsx`, but talks to the Electron
 * main process via `window.infinitecode.auth.*` (which is exposed by
 * the preload bridge and backed by `apps/desktop/src/main/connect-flow.ts`).
 *
 * The access token NEVER crosses the IPC boundary — only safe fields
 * (user id, email). This keeps the renderer free of token authority.
 *
 * Sidebar (`apps/desktop/src/renderer/components/sidebar/app-sidebar-content.tsx`)
 * renders the `AuthMenu` off this atom.
 */
import { atom } from "jotai"

export type AuthStatus =
	| "loading"
	| "signed-in"
	| "signed-out"
	| "error"

export interface AuthUser {
	id: string
	email: string | null
}

export interface AuthState {
	status: AuthStatus
	user: AuthUser | null
	configured: boolean
	errorMessage?: string
}

const INITIAL_STATE: AuthState = {
	status: "loading",
	user: null,
	configured: true,
}

export const authAtom = atom<AuthState>(INITIAL_STATE)

// -----------------------------------------------------------
// Bridge helpers — called by `AuthMenu`'s `useEffect`.
// -----------------------------------------------------------

/**
 * Read the persisted session from the desktop main process.
 *
 * Resolves to a state object with `user: null` if no session exists
 * OR if a session exists without a user payload. Returning
 * `{ id: "", email: null }` (from a previous draft) was a bug — the
 * sidebar would render "Signed in" with an empty id, so we now
 * normalize to `null`.
 */
export async function loadAuthFromMain(
	set: (next: AuthState | ((prev: AuthState) => AuthState)) => void,
): Promise<void> {
	console.log("[auth] loadAuthFromMain:start")
	const declared = window.infinitecode?.auth
	if (!declared) {
		console.log("[auth] loadAuthFromMain:no-bridge status=signed-out")
		set({
			...INITIAL_STATE,
			status: "signed-out",
			configured: false,
		})
		return
	}
	try {
		const result = await declared.getSession()
		console.log(
			"[auth] loadAuthFromMain:result",
			JSON.stringify({ user: result.user, configured: result.configured }),
		)
		set((prev) => ({
			...prev,
			configured: result.configured,
			status: result.user ? "signed-in" : "signed-out",
			user: result.user?.id ? result.user : null,
			errorMessage: undefined,
		}))
	} catch (err) {
		console.error("[auth] loadAuthFromMain:threw", err)
		set({
			...INITIAL_STATE,
			status: "error",
			errorMessage:
				err instanceof Error ? err.message : "Failed to read auth state",
		})
	}
}

/**
 * Open the system browser to the website's device-pairing page.
 * Resolves once the user has signed in (or rejects on timeout / error).
 *
 * Side effects (events from the main process) update the atom:
 *   - `connect:success`  → re-runs `loadAuthFromMain`.
 *   - `connect:signed_out` → clears `user`.
 *   - `connect:failed`    → flips to `error`.
 */
export async function startSignIn(
	set: (next: AuthState | ((prev: AuthState) => AuthState)) => void,
): Promise<void> {
	console.log("[auth] startSignIn:start")
	const declared = window.infinitecode?.auth
	if (!declared) {
		console.log("[auth] startSignIn:no-bridge status=error")
		set({
			...INITIAL_STATE,
			status: "error",
			errorMessage: "Auth IPC bridge is unavailable",
		})
		return
	}
	console.log("[auth] startSignIn:setting status=loading")
	set((prev) => ({ ...prev, status: "loading", errorMessage: undefined }))
	try {
		console.log("[auth] startSignIn:await declared.startConnect()")
		await declared.startConnect()
		console.log("[auth] startSignIn:startConnect resolved")
		// The main process fires `connect:success` AND we re-read here
		// so the UI updates even if the renderer missed the event.
		await loadAuthFromMain(set)
		console.log("[auth] startSignIn:complete")
	} catch (err) {
		console.error("[auth] startSignIn:threw", err)
		set((prev) => ({
			...prev,
			status: "error",
			errorMessage:
				err instanceof Error ? err.message : "Sign-in failed",
		}))
	}
}

/**
 * Sign out of this desktop only (does NOT revoke other sessions).
 *
 * The CLI's `infinitecode auth logout` and the website's
 * `signOut({ scope: "global" })` give wider scopes — those are
 * deliberately NOT exposed via this surface (per your earlier
 * direction: client-side only).
 */
export async function signOutFromRenderer(
	set: (next: AuthState | ((prev: AuthState) => AuthState)) => void,
): Promise<void> {
	const declared = window.infinitecode?.auth
	if (!declared) {
		set({ ...INITIAL_STATE, status: "signed-out", configured: false })
		return
	}
	set((prev) => ({ ...prev, status: "loading", errorMessage: undefined }))
	try {
		await declared.signOut()
		set((prev) => ({ ...INITIAL_STATE, status: "signed-out", configured: prev.configured ?? true }))
	} catch (err) {
		set((prev) => ({
			...prev,
			status: "error",
			errorMessage:
				err instanceof Error ? err.message : "Sign-out failed",
		}))
	}
}
