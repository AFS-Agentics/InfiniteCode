/**
 * Profile page — the canonical "how's InfiniteCode working for me" view.
 *
 * Because this is a SPA without a dedicated backend, the analytics
 * surface pulls only what's directly readable in this Supabase project:
 *  - User identity from `auth.users`
 *  - Authorized devices from the shared `public.device_pairing` table
 *    (granular count + last-link timestamp)
 *  - Authentication method + timestamps
 *
 * The deeper usage/star/CLI invocation telemetry lives in the desktop
 * app and the Rust core, so we surface that as a download CTA rather
 * than fabricating data we don't actually have.
 */
import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import {
	ActivityIcon,
	CalendarIcon,
	CheckCircle2Icon,
	ClockIcon,
	CpuIcon,
	DownloadIcon,
	HardDriveIcon,
	KeyRoundIcon,
	LinkIcon,
	Loader2Icon,
	LogOutIcon,
	MailIcon,
	MonitorIcon,
	PaletteIcon,
	PencilIcon,
	SaveIcon,
	ShieldCheckIcon,
	SparklesIcon,
	ShieldAlertIcon,
	TerminalIcon,
	Trash2Icon,
	UserIcon,
} from "lucide-react"
import type { Session } from "@supabase/supabase-js"

import { useAuth, userInitials } from "@/components/auth-provider"
import { ProtectedRoute } from "@/components/protected-route"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { getSupabase } from "@/lib/supabase"

interface PairingRow {
	id: string
	created_at: string
	authorized_at: string | null
	user_code: string
	device_label: string | null
}

function formatRelative(input: string | null | undefined): string {
	if (!input) return "Never"
	const then = new Date(input)
	const now = Date.now()
	const diff = now - then.getTime()
	const second = 1000
	const minute = 60 * second
	const hour = 60 * minute
	const day = 24 * hour
	if (diff < minute) return "Just now"
	if (diff < hour) return `${Math.floor(diff / minute)}m ago`
	if (diff < day) return `${Math.floor(diff / hour)}h ago`
	if (diff < day * 30) return `${Math.floor(diff / day)}d ago`
	return then.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	})
}

function readCreatedAt(session: Session | null): string | null {
	// Supabase's User object carries created_at via JWT claims only when
	// the session was minted with `created_at`. Fall back to null when
	// the field isn't available.
	const u = session?.user as unknown as
		| { created_at?: string; app_metadata?: Record<string, unknown> }
		| null
	return u?.created_at ?? null
}

function ProfileBody() {
	const { user, session, signOut, updateProfile, updatePassword } = useAuth()
	const navigate = useNavigate()
	const sb = getSupabase()

	const [editing, setEditing] = React.useState(false)
	const [nameDraft, setNameDraft] = React.useState("")
	const [avatarDraft, setAvatarDraft] = React.useState("")
	const [busy, setBusy] = React.useState(false)
	const [error, setError] = React.useState<string | null>(null)
	const [info, setInfo] = React.useState<string | null>(null)

	const [pwdOpen, setPwdOpen] = React.useState(false)
	const [pwdNew, setPwdNew] = React.useState("")
	const [pwdConfirm, setPwdConfirm] = React.useState("")

	const [pairings, setPairings] = React.useState<PairingRow[] | null>(null)

	React.useEffect(() => {
		if (user) {
			setNameDraft(user.displayName ?? "")
			setAvatarDraft(user.avatarUrl ?? "")
		}
	}, [user])

	// Fetch authorized device links for this user from the shared
	// `public.device_pairing` table. RLS on that table should already
	// restrict to the owner — if not, this will simply return [].
	React.useEffect(() => {
		if (!sb || !user) {
			setPairings([])
			return
		}
		let cancelled = false
		sb
			.from("device_pairing")
			.select("id, created_at, authorized_at, user_code, device_label")
			.eq("user_id", user.id)
			.not("authorized_at", "is", null)
			.order("authorized_at", { ascending: false })
			.limit(20)
			.then(({ data, error: err }) => {
				if (cancelled) return
				if (err) {
					console.warn("device_pairing read failed:", err.message)
					setPairings([])
				} else {
					setPairings((data ?? []) as PairingRow[])
				}
			})
		return () => {
			cancelled = true
		}
	}, [sb, user])

	if (!user) return null
	const initials = userInitials(user)
	const createdAt = readCreatedAt(session)
	const authorizedCount = pairings?.length ?? 0
	const lastPairing = pairings?.[0]?.authorized_at ?? null

	async function saveProfile() {
		setBusy(true)
		setError(null)
		setInfo(null)
		try {
			await updateProfile({
				displayName: nameDraft.trim() || undefined,
				avatarUrl: avatarDraft.trim() || undefined,
			})
			setInfo("Profile updated.")
			setEditing(false)
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	async function changePassword() {
		setError(null)
		setInfo(null)
		if (pwdNew.length < 8) {
			setError("Password must be at least 8 characters.")
			return
		}
		if (pwdNew !== pwdConfirm) {
			setError("Passwords don't match.")
			return
		}
		setBusy(true)
		try {
			await updatePassword(pwdNew)
			setInfo("Password updated.")
			setPwdOpen(false)
			setPwdNew("")
			setPwdConfirm("")
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	async function handleSignOut(scope: "local" | "global" = "local") {
		setBusy(true)
		try {
			await signOut(scope)
			// Always navigate home after sign-out. `onAuthStateChange`
			// also fires `user=null`, which would let ProtectedRoute redirect
			// to `/login?next=/profile` — that race is confusing. Send the
			// user straight home unconditionally for both scopes.
			navigate("/", { replace: true })
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="mx-auto grid min-h-screen w-full max-w-5xl gap-6 px-4 py-10">
			<header className="flex flex-col gap-2">
				<div className="text-xs uppercase tracking-widest text-muted-foreground">
					Account
				</div>
				<h1 className="text-3xl font-bold tracking-tight">Your InfiniteCode profile</h1>
				<p className="max-w-2xl text-sm text-muted-foreground">
					Manage your account, see how your desktops and CLI sessions connect back to
					the same identity, and download the agent on the surfaces you use most.
				</p>
			</header>

			{error && (
				<div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
					{error}
				</div>
			)}
			{info && (
				<div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
					{info}
				</div>
			)}

			<div className="grid gap-6 lg:grid-cols-3">
				{/* Identity card */}
				<Card className="lg:col-span-2">
					<CardHeader>
						<div className="flex items-start justify-between gap-4">
							<div className="flex items-center gap-4">
								<Avatar className="size-16">
									{user.avatarUrl ? (
										<AvatarImage src={user.avatarUrl} alt={user.displayName ?? "user"} />
									) : null}
									<AvatarFallback className="text-base">{initials}</AvatarFallback>
								</Avatar>
								<div className="flex flex-col gap-1">
									<CardTitle className="text-lg">
										{user.displayName ?? user.email ?? "Anonymous"}
									</CardTitle>
									<CardDescription className="flex flex-col gap-0.5">
										<span className="flex items-center gap-1">
											<MailIcon className="size-3" />
											{user.email}
										</span>
										{createdAt && (
											<span className="flex items-center gap-1">
												<CalendarIcon className="size-3" />
												Member since {new Date(createdAt).toLocaleDateString()}
											</span>
										)}
									</CardDescription>
								</div>
							</div>
							<Button
								size="sm"
								variant={editing ? "ghost" : "outline"}
								onClick={() => setEditing((s) => !s)}
								disabled={busy}
							>
								{editing ? (
									<>Cancel</>
								) : (
									<>
										<PencilIcon className="size-3.5" />
										Edit
									</>
								)}
							</Button>
						</div>
					</CardHeader>
					<CardContent className="space-y-4">
						{editing ? (
							<div className="grid gap-3">
								<div className="grid gap-1.5">
									<Label htmlFor="profile-display-name">Display name</Label>
									<Input
										id="profile-display-name"
										value={nameDraft}
										onChange={(e) => setNameDraft(e.target.value)}
										placeholder="How should we address you?"
									/>
								</div>
								<div className="grid gap-1.5">
									<Label htmlFor="profile-avatar">Avatar URL</Label>
									<Input
										id="profile-avatar"
										value={avatarDraft}
										onChange={(e) => setAvatarDraft(e.target.value)}
										placeholder="https://…/portrait.png"
									/>
									<p className="text-[10px] text-muted-foreground">
										Paste a direct link to your image. Leave empty for an initials
										avatar.
									</p>
								</div>
								<div className="flex justify-end gap-2">
									<Button variant="ghost" onClick={() => setEditing(false)}>
										Cancel
									</Button>
									<Button onClick={() => void saveProfile()} disabled={busy}>
										{busy ? (
											<Loader2Icon className="size-4 animate-spin" />
										) : (
											<SaveIcon className="size-4" />
										)}
										Save
									</Button>
								</div>
							</div>
						) : (
							<dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
								<Stat
									icon={<KeyRoundIcon className="size-4 text-primary" />}
									label="Sign-in method"
									value={
										user.provider
											? `${user.provider[0]?.toUpperCase()}${user.provider.slice(1)}`
											: "Email + password"
									}
								/>
								<Stat
									icon={<ClockIcon className="size-4 text-primary" />}
									label="Last update"
									value={formatRelative(user.updatedAt)}
								/>
								<Stat
									icon={<UserIcon className="size-4 text-primary" />}
									label="User ID"
									value={<code className="text-xs">{user.id}</code>}
								/>
								<Stat
									icon={<CheckCircle2Icon className="size-4 text-emerald-500" />}
									label="Plan"
									value={
										<span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
											Free
										</span>
									}
								/>
							</dl>
						)}
					</CardContent>
				</Card>

				{/* Security card */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-base">
							<ShieldCheckIcon className="size-4 text-primary" />
							Security
						</CardTitle>
						<CardDescription>Manage password and sessions.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						{!pwdOpen ? (
							<Button
								variant="outline"
								size="sm"
								className="w-full"
								onClick={() => setPwdOpen(true)}
							>
								<KeyRoundIcon className="size-4" />
								Change password
							</Button>
						) : (
							<div className="space-y-2">
								<Input
									type="password"
									placeholder="New password"
									value={pwdNew}
									onChange={(e) => setPwdNew(e.target.value)}
								/>
								<Input
									type="password"
									placeholder="Confirm password"
									value={pwdConfirm}
									onChange={(e) => setPwdConfirm(e.target.value)}
								/>
								<div className="flex gap-2">
									<Button
										variant="ghost"
										size="sm"
										onClick={() => {
											setPwdOpen(false)
											setPwdNew("")
											setPwdConfirm("")
										}}
									>
										Cancel
									</Button>
									<Button
										size="sm"
										disabled={busy}
										onClick={() => void changePassword()}
									>
										{busy ? (
											<Loader2Icon className="size-4 animate-spin" />
										) : (
											<SaveIcon className="size-4" />
										)}
										Save
									</Button>
								</div>
							</div>
						)}
						<Separator />
						<div className="grid gap-1.5">
							<Button
								variant="ghost"
								size="sm"
								className="w-full justify-start"
								onClick={() => void handleSignOut("local")}
								disabled={busy}
							>
								<LogOutIcon className="size-4" />
								Sign out of this browser
							</Button>
							<Button
								variant="ghost"
								size="sm"
								className="w-full justify-start text-rose-500 hover:bg-rose-500/10 hover:text-rose-500"
								onClick={() => void handleSignOut("global")}
								disabled={busy}
							>
								<ShieldAlertIcon className="size-4" />
								{busy ? "Signing out everywhere…" : "Sign out everywhere"}
							</Button>
							<p className="text-[10px] text-muted-foreground">
								&quot;Sign out everywhere&quot; kills your session across this browser,
								any connected desktop, and the CLI — useful if a device was lost or
								stolen.
							</p>
						</div>
						<p className="text-[10px] text-muted-foreground">
							Want to delete your account and all data? Email{" "}
							<a className="underline" href="mailto:[email protected]">
								[email protected]
							</a>
							.
						</p>
					</CardContent>
				</Card>

				{/* Usage card */}
				<Card className="lg:col-span-2">
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-base">
							<ActivityIcon className="size-4 text-primary" />
							Your InfiniteCode usage
						</CardTitle>
						<CardDescription>
							Number of devices you've linked back to this account and when you last
							did so.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
							<UsageStat
								icon={<LinkIcon className="size-4 text-primary" />}
								label="Authorized devices"
								value={authorizedCount.toString()}
							/>
							<UsageStat
								icon={<ClockIcon className="size-4 text-primary" />}
								label="Last device link"
								value={formatRelative(lastPairing)}
							/>
							<UsageStat
								icon={<CalendarIcon className="size-4 text-primary" />}
								label="Account age"
								value={createdAt ? `${daysAgo(createdAt)} days` : "—"}
							/>
							<UsageStat
								icon={<SparklesIcon className="size-4 text-primary" />}
								label="Active sessions"
								value="1"
							/>
						</div>

						{pairings && pairings.length > 0 && (
							<div className="space-y-2">
								<div className="text-xs uppercase tracking-widest text-muted-foreground">
									Recent device links
								</div>
								<ul className="space-y-1">
									{pairings.slice(0, 5).map((p) => (
										<li
											key={p.id}
											className="flex items-center justify-between rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs"
										>
											<span className="flex items-center gap-2">
												<HardDriveIcon className="size-3 text-muted-foreground" />
												<code className="text-foreground">
													{p.device_label ?? p.user_code}
												</code>
											</span>
											<span className="text-muted-foreground">
												{formatRelative(p.authorized_at)}
											</span>
										</li>
									))}
								</ul>
							</div>
						)}

						{/* Caveat: detailed run/session telemetry lives in the desktop/CLI agent core, not the website. */}
						<div className="rounded-md border border-dashed border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
							<PaletteIcon className="mr-1 inline size-3.5 text-primary" />
							Session-level metrics (commands run, files edited, model usage) live
							inside each surface you install — open the desktop app to see them in
							real time.
						</div>
					</CardContent>
				</Card>

				{/* Install card */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-base">
							<DownloadIcon className="size-4 text-primary" />
							Install on another surface
						</CardTitle>
						<CardDescription>Pick up where you left off anywhere.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-2">
						<Button asChild variant="outline" size="sm" className="w-full justify-start">
							<a href="#desktop">
								<MonitorIcon className="size-4" />
								Download for macOS
							</a>
						</Button>
						<Button asChild variant="outline" size="sm" className="w-full justify-start">
							<a href="#desktop">
								<MonitorIcon className="size-4" />
								Download for Linux
							</a>
						</Button>
						<Button asChild size="sm" className="w-full justify-start">
							<a href="#cli">
								<TerminalIcon className="size-4" />
								npx infinitecode
							</a>
						</Button>
						<Link to="/login" className="block text-center text-xs text-muted-foreground hover:text-foreground">
							Pair another device →
						</Link>
					</CardContent>
				</Card>
			</div>

			<Separator />
			<p className="text-center text-[11px] text-muted-foreground">
				<CpuIcon className="mr-1 inline size-3 text-primary" />
				Your identity is shared across{" "}
				<a href="/" className="underline">
					tryinfinitecode.vercel.app
				</a>
				, the desktop app, and the Rust CLI.
			</p>
		</div>
	)
}

function Stat({
	icon,
	label,
	value,
}: {
	icon: React.ReactNode
	label: string
	value: React.ReactNode
}) {
	return (
		<div className="flex items-start gap-3">
			<div className="mt-0.5 flex size-7 items-center justify-center rounded-md bg-primary/10">
				{icon}
			</div>
			<div className="min-w-0">
				<div className="text-[10px] uppercase tracking-widest text-muted-foreground">
					{label}
				</div>
				<div className="text-sm font-medium text-foreground">{value}</div>
			</div>
		</div>
	)
}

function UsageStat({
	icon,
	label,
	value,
}: {
	icon: React.ReactNode
	label: string
	value: string
}) {
	return (
		<div className="rounded-lg border border-border/60 bg-muted/30 p-3">
			<div className="mb-1 flex items-center gap-2">
				{icon}
				<span className="text-[10px] uppercase tracking-widest text-muted-foreground">
					{label}
				</span>
			</div>
			<div className="truncate text-lg font-semibold">{value}</div>
		</div>
	)
}

function daysAgo(iso: string): number {
	const then = new Date(iso).getTime()
	return Math.max(0, Math.floor((Date.now() - then) / 86_400_000))
}

export default function ProfilePage() {
	return (
		<ProtectedRoute>
			<ProfileBody />
		</ProtectedRoute>
	)
}
