/**
 * Top-right user menu for the InfiniteCode website.
 *
 * Behaviour:
 *  - Logged out: renders "Sign in" + "Sign up" buttons.
 *  - Logged in:  renders an avatar (image or initials) that opens a
 *    dropdown menu with the user's display name, plan badge, links to
 *    /profile and the desktop pairing flow, and a Sign out item.
 *  - When Supabase is unconfigured: shows a pulse-red chip explaining
 *    the situation so it doesn't render fake auth UI.
 */
import * as React from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import {
	ChevronDownIcon,
	CircleAlertIcon,
	CpuIcon,
	DownloadIcon,
	KeyRoundIcon,
	LogOutIcon,
	MonitorIcon,
	UserIcon,
} from "lucide-react"

import { useAuth, userInitials } from "@/components/auth-provider"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface UserMenuProps {
	/** Compact mode hides the "Sign in" buttons for very narrow nav rows. */
	dense?: boolean
}

export function UserMenu(_props: UserMenuProps = {}) {
	const { user, ready, configured, signOut } = useAuth()
	const navigate = useNavigate()
	const location = useLocation()
	const [busy, setBusy] = React.useState(false)

	async function handleSignOut() {
		setBusy(true)
		try {
			await signOut()
			// Back to home after a sign-out if the visitor was on a gated
			// page; otherwise stay where they are.
			if (location.pathname.startsWith("/profile")) {
				navigate("/", { replace: true })
			}
		} finally {
			setBusy(false)
		}
	}

	// ── Unconfigured Supabase ─────────────────────────────────────────
	if (!configured) {
		return (
			<div
				title="VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing"
				className="hidden items-center gap-2 rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-rose-300 md:flex"
			>
				<CircleAlertIcon className="size-3.5" />
				Auth unconfigured
			</div>
		)
	}

	// ── Loading (very brief) ───────────────────────────────────────────
	if (!ready) {
		return (
			<div className="flex items-center gap-2">
				<span className="size-2 animate-pulse rounded-full bg-muted-foreground/40" />
				<span className="hidden text-xs text-muted-foreground sm:inline">Checking…</span>
			</div>
		)
	}

	// ── Logged out ─────────────────────────────────────────────────────
	if (!user) {
		const signupHref = `/signup${location.search}`
		return (
			<div className="flex items-center gap-2">
				<Button variant="ghost" size="sm" asChild>
					<Link to={`/login${location.search}`}>
						<KeyRoundIcon className="size-4" />
						Sign in
					</Link>
				</Button>
				<Button size="sm" asChild>
					<Link to={signupHref}>
						<UserIcon className="size-4" />
						Sign up
					</Link>
				</Button>
			</div>
		)
	}

	// ── Logged in ──────────────────────────────────────────────────────
	const initials = userInitials(user)
	const plan = "Free"
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="flex items-center gap-2 rounded-full px-2"
					aria-label={`Open menu for ${user.displayName ?? user.email ?? "user"}`}
				>
					<Avatar className="size-8">
						{user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="avatar" /> : null}
						<AvatarFallback>{initials}</AvatarFallback>
					</Avatar>
					<ChevronDownIcon className="size-3.5 text-muted-foreground" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-64">
				<DropdownMenuLabel className="flex flex-col gap-1">
					<div className="flex items-center gap-2 text-sm font-semibold text-foreground">
						<CpuIcon className="size-3.5 text-primary" />
						{user.displayName ?? user.email ?? "Anonymous"}
					</div>
					<div className="truncate text-xs font-normal text-muted-foreground">
						{user.email}
					</div>
					<div className="mt-1 flex items-center gap-2">
						<span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
							<span className="size-1.5 rounded-full bg-emerald-400" />
							{plan} plan
						</span>
						<span className="text-[10px] text-muted-foreground">
							{user.provider
								? `via ${user.provider[0]?.toUpperCase()}${user.provider.slice(1)}`
								: "via email"}
						</span>
					</div>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link to="/profile">
						<UserIcon className="size-4" />
						Profile & analytics
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem asChild>
					<Link to="/login">
						<MonitorIcon className="size-4" />
						Pair a device
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem asChild>
					<Link to={{ pathname: "/", hash: "#desktop" }}>
						<DownloadIcon className="size-4" />
						Get the desktop app
					</Link>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onSelect={(event) => {
						event.preventDefault()
						void handleSignOut()
					}}
					disabled={busy}
					className="text-rose-500 focus:text-rose-500"
				>
					<LogOutIcon className="size-4" />
					{busy ? "Signing out…" : "Sign out"}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
