/**
 * Route gate for the InfiniteCode website.
 *
 * Wraps a route's content; if there's no signed-in user, redirects
 * the visitor to `/login` while preserving the originally-requested
 * path so they can be sent back after signing in.
 *
 * Behaviour:
 *  - While the AuthProvider is still bootstrapping (`!ready`), renders
 *    a centered spinner so we don't bounce to `/login` for users whose
 *    session is still loading from localStorage.
 *  - Once `ready`, an unauthenticated user gets an immediate replace
 *    redirect with `?next=<current-path>` appended.
 *  - Authenticated users see the wrapped children.
 */
import * as React from "react"
import { useLocation, useNavigate } from "react-router-dom"

import { useAuth } from "@/components/auth-provider"

interface ProtectedRouteProps {
	children: React.ReactNode
	/** Fallback shown while auth bootstraps. Defaults to a small spinner. */
	loadingFallback?: React.ReactNode
}

export function ProtectedRoute({ children, loadingFallback }: ProtectedRouteProps) {
	const { user, ready } = useAuth()
	const location = useLocation()
	const navigate = useNavigate()

	React.useEffect(() => {
		if (!ready) return
		if (!user) {
			const next = encodeURIComponent(`${location.pathname}${location.search}`)
			navigate(`/login?next=${next}`, { replace: true })
		}
	}, [ready, user, location.pathname, location.search, navigate])

	if (!ready || !user) {
		return (
			<>
				{loadingFallback ?? (
					<div
						role="status"
						aria-live="polite"
						className="grid min-h-[60vh] place-items-center bg-background text-sm text-muted-foreground"
					>
						<span className="inline-flex items-center gap-2">
							<span className="size-2 animate-pulse rounded-full bg-primary" />
							Checking session…
						</span>
					</div>
				)}
			</>
		)
	}

	return <>{children}</>
}
