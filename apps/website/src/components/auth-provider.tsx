/**
 * AuthProvider — React-side session controller around the Supabase
 * browser client.
 *
 * Mirrors the structure of the InfiniteCodeBackend admin panel's
 * auth-provider (`@supabase/supabase-js` `onAuthStateChange` + a
 * one-shot `getSession()` kick), but adapted for a Vite SPA — no
 * server-side cookie refresh needed because `@supabase/ssr`'s
 * `createBrowserClient` persists the session in `localStorage` and
 * refreshes the JWT automatically.
 *
 * Exposes `useAuth()` plus a single public helper `AuthReady` for the
 * one or two sites that just need to know if the SDK is configured
 * without subscribing to session changes.
 */
import * as React from "react"
import type { Session, User } from "@supabase/supabase-js"

import { getSupabase } from "@/lib/supabase"

export interface AuthUser {
	id: string
	email: string | null
	displayName: string | null
	avatarUrl: string | null
	/** Last-mutation timestamp from Supabase (≈ last sign-in / profile edit). */
	updatedAt: string | null
	/** Free-form metadata. Useful for `provider_id`, `email_verified`, etc. */
	provider: string | null
}

interface AuthContextValue {
	user: AuthUser | null
	session: Session | null
	/** True after the initial Supabase `onAuthStateChange` has reported (or the lack thereof). */
	ready: boolean
	/** True when `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are both set. */
	configured: boolean

	signInWithGoogle: (redirectPath?: string) => Promise<void>
	signInWithPassword: (email: string, password: string) => Promise<void>
	signUpWithPassword: (email: string, password: string, displayName: string) => Promise<void>
	resetPassword: (email: string) => Promise<void>
	updatePassword: (newPassword: string) => Promise<void>
	updateProfile: (patch: {
		displayName?: string
		avatarUrl?: string
	}) => Promise<void>
	signOut: (scope?: "local" | "global") => Promise<void>
}

const AuthContext = React.createContext<AuthContextValue | null>(null)

function sessionToAuthUser(session: Session | null): AuthUser | null {
	const u: User | null = session?.user ?? null
	if (!u) return null
	const meta = (u.user_metadata ?? {}) as Record<string, unknown>
	const identities = (u.identities ?? []) as Array<{ provider?: string }>
	const provider = identities[0]?.provider ?? null
	return {
		id: u.id,
		email: u.email ?? null,
		displayName:
			(meta.full_name as string | undefined) ??
			(meta.name as string | undefined) ??
			(meta.user_name as string | undefined) ??
			(u.email ? u.email.split("@")[0] : null),
		avatarUrl:
			(meta.avatar_url as string | undefined) ??
			(meta.picture as string | undefined) ??
			null,
		updatedAt: u.updated_at ?? null,
		provider,
	}
}

function buildRedirect(redirectPath: string | undefined): string {
	// Always absolute and same-origin so Supabase's OAuth/email handler
	// re-opens directly on this site.
	const base = typeof window !== "undefined" ? window.location.origin : ""
	const path = redirectPath ?? (typeof window !== "undefined" ? window.location.pathname : "/")
	// Preserve the device-pairing `?code=…` if present so the existing
	// Login.tsx auto-pair logic still works after the redirect.
	const search =
		typeof window !== "undefined" ? window.location.search : ""
	return `${base}${path}${search}`
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const sb = getSupabase()
	const configured = sb !== null
	const [user, setUser] = React.useState<AuthUser | null>(null)
	const [session, setSession] = React.useState<Session | null>(null)
	const [ready, setReady] = React.useState(false)

	React.useEffect(() => {
		if (!sb) {
			setReady(true)
			return
		}
		const { data: sub } = sb.auth.onAuthStateChange((_event, nextSession) => {
			setSession(nextSession)
			setUser(sessionToAuthUser(nextSession))
			setReady(true)
		})
		// `onAuthStateChange` fires asynchronously; pull the current
		// session once so the UI doesn't render logged-out briefly.
		sb.auth
			.getSession()
			.then(({ data }) => {
				setSession(data.session)
				setUser(sessionToAuthUser(data.session))
				setReady(true)
			})
			.catch((err) => {
				console.error("Supabase getSession failed:", err)
				setReady(true)
			})
		return () => {
			sub.subscription.unsubscribe()
		}
	}, [sb])

	const value: AuthContextValue = React.useMemo(
		() => ({
			user,
			session,
			ready,
			configured,
			async signInWithGoogle(redirectPath) {
				if (!sb) return
				const { error } = await sb.auth.signInWithOAuth({
					provider: "google",
					options: { redirectTo: buildRedirect(redirectPath) },
				})
				if (error) throw error
			},
			async signInWithPassword(email, password) {
				if (!sb) throw new Error("Supabase not configured")
				const { error } = await sb.auth.signInWithPassword({ email, password })
				if (error) throw error
			},
			async signUpWithPassword(email, password, displayName) {
				if (!sb) throw new Error("Supabase not configured")
				const { error } = await sb.auth.signUp({
					email,
					password,
					options: {
						data: { full_name: displayName },
						emailRedirectTo: buildRedirect("/profile"),
					},
				})
				if (error) throw error
			},
			async resetPassword(email) {
				if (!sb) throw new Error("Supabase not configured")
				const { error } = await sb.auth.resetPasswordForEmail(email, {
					redirectTo: buildRedirect("/reset-password"),
				})
				if (error) throw error
			},
			async updatePassword(newPassword) {
				if (!sb) throw new Error("Supabase not configured")
				const { error } = await sb.auth.updateUser({ password: newPassword })
				if (error) throw error
			},
			async updateProfile(patch) {
				if (!sb) throw new Error("Supabase not configured")
				const { error } = await sb.auth.updateUser({
					data: {
						...(patch.displayName ? { full_name: patch.displayName } : {}),
						...(patch.avatarUrl ? { avatar_url: patch.avatarUrl } : {}),
					},
				})
				if (error) throw error
			},
			async signOut(scope = "local") {
				if (!sb) return
				await sb.auth.signOut({ scope })
			},
		}),
		[configured, ready, sb, session, user],
	)

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
	const ctx = React.useContext(AuthContext)
	if (!ctx) {
		throw new Error("useAuth must be used inside <AuthProvider>")
	}
	return ctx
}

/**
 * Tiny render-prop helper for places that want to render different
 * markup depending on whether Supabase is configured, but don't need
 * the full session state.
 *
 * Usage: `<AuthReady>{(configured) => configured ? ... : ...}</AuthReady>`
 */
export function AuthReady({
	children,
	fallback = null,
}: {
	children: (configured: boolean) => React.ReactNode
	fallback?: React.ReactNode
}) {
	const { configured } = useAuth()
	return <>{children(configured)}</>
}

// Re-export the small render-time helper so consumers can compute initials.
export function userInitials(user: AuthUser | null | undefined): string {
	if (!user) return "?"
	const source = user.displayName ?? user.email ?? ""
	const trimmed = source.trim()
	if (!trimmed) return "?"
	// Take up to two letters for nicer blends like "SC" or "SR".
	const words = trimmed.split(/\s+/).filter(Boolean)
	if (words.length >= 2) {
		return (words[0][0] + words[1][0]).toUpperCase()
	}
	return trimmed[0].toUpperCase()
}
