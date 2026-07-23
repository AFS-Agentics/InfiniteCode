/**
 * Public website login — tryinfinitecode.vercel.app
 *
 * Now driven by the shared `useAuth()` hook (instead of calling
 * `getSupabase().auth.*` directly) so the device-pairing flow and the
 * real Sign-up / Sign-in flows share one consistent session reactor.
 *
 * Behaviour:
 *  - Google OAuth (redirects through Supabase and comes back here)
 *  - Email + password sign-in / sign-up for users with an account
 *  - Device-pairing auto-link when ?code=ABCD-EFGH is present
 *  - Successful login → /profile (preserves `?code=…` so the pairing
 *    useEffect can run after the nav transition)
 */
import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import {
	AlertTriangleIcon,
	ArrowRightIcon,
	CheckCircle2Icon,
	EyeIcon,
	EyeOffIcon,
	GithubIcon,
	KeyRoundIcon,
	Loader2Icon,
	LogInIcon,
	MonitorIcon,
	UserPlusIcon,
} from "lucide-react"

import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const DEVICE_CODE_PARAM = "code"

type Mode = "google" | "password"

export default function Login() {
	const { configured, user, ready, signInWithGoogle, signInWithPassword } = useAuth()
	const navigate = useNavigate()
	const [mode, setMode] = React.useState<Mode>("google")
	const [email, setEmail] = React.useState("")
	const [password, setPassword] = React.useState("")
	const [busy, setBusy] = React.useState(false)
	const [error, setError] = React.useState<string | null>(null)
	const [info, setInfo] = React.useState<string | null>(null)
	const [showPwd, setShowPwd] = React.useState(false)
	const [paired, setPaired] = React.useState(false)

	const deviceCode = React.useMemo(() => {
		if (typeof window === "undefined") return null
		const u = new URL(window.location.href)
		return u.searchParams.get(DEVICE_CODE_PARAM)
	}, [])

	async function pairDeviceWithSession() {
		if (!deviceCode) return
		const sb = (await import("@/lib/supabase")).getSupabase()
		const sessionResult = sb ? await sb.auth.getSession() : null
		const session = sessionResult?.data.session
		if (!session) {
			setInfo(
				"Sign in first, then we'll link this browser back to your desktop in one click.",
			)
			return
		}
		try {
			const url = `/api/connect`
			await fetch(url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					user_code: deviceCode,
					access_token: session.access_token,
					refresh_token: session.refresh_token,
				}),
			})
			setPaired(true)
			setInfo("✓ Signed back into your desktop — you can close this window.")
		} catch {
			// best-effort; the desktop retries
		}
	}

	// Auto-pair when (a) the session middleware marked us ready, (b) we
	// have an active Supabase session, and (c) we haven't paired yet.
	React.useEffect(() => {
		if (!ready || !user || paired || !deviceCode) return
		void pairDeviceWithSession()
		// pairDeviceWithSession depends on inputs that come from React
		// state; intentionally not in the dep array.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ready, user, paired, deviceCode])

	async function runGoogle() {
		setBusy(true)
		setError(null)
		setInfo(null)
		try {
			await signInWithGoogle("/login" + window.location.search)
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	async function runPassword(e: React.FormEvent) {
		e.preventDefault()
		if (!email || !password) return
		setBusy(true)
		setError(null)
		setInfo(null)
		try {
			await signInWithPassword(email.trim(), password)
			// Don't bounce if a device code is pending — let the pairing
			// effect finish so the desktop polls the auth tokens.
			if (!deviceCode) navigate("/profile", { replace: true })
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	if (!configured) {
		return (
			<main className="grid min-h-screen place-items-center bg-background p-6">
				<Card className="max-w-md border-amber-500/40">
					<CardContent className="space-y-3 py-8 text-sm">
						<div className="flex items-center gap-2 text-amber-300">
							<AlertTriangleIcon className="size-5" />
							<strong>Supabase not configured.</strong>
						</div>
						<p className="text-muted-foreground">
							Set <code>VITE_SUPABASE_URL</code> and{" "}
							<code>VITE_SUPABASE_ANON_KEY</code> in <code>.env</code>, then rebuild
							the website.
						</p>
					</CardContent>
				</Card>
			</main>
		)
	}

	return (
		<main className="grid min-h-screen place-items-center bg-background p-6">
			{paired ? (
				<div
					data-testid="paired-card"
					className="w-full max-w-md rounded-xl border border-emerald-500/40 bg-card/60 p-8 shadow-xl"
				>
					<header className="mb-6 space-y-1 text-center">
						<div className="mx-auto grid size-10 place-items-center rounded-full bg-emerald-500/15 text-emerald-400">
							<CheckCircle2Icon className="size-6" />
						</div>
						<h1 className="text-2xl font-semibold tracking-tight">Signed in</h1>
						<p className="text-sm text-muted-foreground">
							Your desktop is now connected. You can close this tab.
						</p>
					</header>
					<Link
						to="/profile"
						className="block w-full rounded-md border border-border/60 bg-background px-4 py-2.5 text-center text-sm font-medium hover:bg-accent/40"
					>
						Go to your profile
						<ArrowRightIcon className="ml-1 inline size-3.5" />
					</Link>
				</div>
			) : null}
			<div
				className={`w-full max-w-md rounded-xl border border-border/60 bg-card/60 p-8 shadow-xl ${
					paired ? "hidden" : ""
				}`}
			>
				<header className="mb-6 space-y-1 text-center">
					<div className="mx-auto grid size-10 place-items-center rounded-lg bg-gradient-to-br from-emerald-500 to-sky-600 shadow-lg shadow-emerald-500/20">
						{deviceCode ? (
							<MonitorIcon className="size-5 text-white" />
						) : (
							<KeyRoundIcon className="size-5 text-white" />
						)}
					</div>
					<h1 className="text-2xl font-semibold tracking-tight">
						{deviceCode ? "Connect your desktop" : "Sign in to InfiniteCode"}
					</h1>
					<p className="text-sm text-muted-foreground">
						{deviceCode
							? "Your desktop is waiting — one sign-in and you're back to coding."
							: "Use the same account across web, desktop, and CLI."}
					</p>
				</header>

				{error && (
					<p className="mb-4 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
						{error}
					</p>
				)}
				{info && (
					<p className="mb-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
						{info}
					</p>
				)}

			{/* Mode tabs */}
			<div className="mb-4 grid grid-cols-2 gap-2 text-xs">
				<ModeTab active={mode === "google"} onClick={() => setMode("google")} label="Google" />
				<ModeTab active={mode === "password"} onClick={() => setMode("password")} label="Email" />
			</div>

				{mode === "google" && (
					<Button
						type="button"
						className="w-full"
						onClick={() => void runGoogle()}
						disabled={busy}
					>
						{busy ? (
							<Loader2Icon className="mr-2 size-4 animate-spin" />
						) : (
							<LogInIcon className="mr-2 size-4" />
						)}
						Continue with Google
					</Button>
				)}

			{mode === "password" && (
				<form className="space-y-3" onSubmit={runPassword}>
					<div className="grid gap-1.5">
						<Label htmlFor="login-email-pw">Email</Label>
						<Input
							id="login-email-pw"
							type="email"
							autoComplete="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							required
						/>
					</div>
					<div className="grid gap-1.5">
						<div className="flex items-baseline justify-between">
							<Label htmlFor="login-password">Password</Label>
							<Link
								to="/forgot-password"
								className="text-[11px] text-muted-foreground hover:text-foreground"
							>
								Forgot?
							</Link>
						</div>
						<div className="relative">
							<Input
								id="login-password"
								type={showPwd ? "text" : "password"}
								autoComplete="current-password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								required
							/>
							<button
								type="button"
								onClick={() => setShowPwd((s) => !s)}
								className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
								aria-label={showPwd ? "Hide password" : "Show password"}
							>
								{showPwd ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
							</button>
						</div>
					</div>
					<Button type="submit" className="w-full" disabled={busy}>
						{busy ? (
							<Loader2Icon className="mr-2 size-4 animate-spin" />
						) : (
							<KeyRoundIcon className="mr-2 size-4" />
						)}
						Sign in
					</Button>
				</form>
			)}

				<div className="mt-6 border-t border-border/40 pt-4 text-center text-xs">
					New here?{" "}
					<Link
						to={`/signup${deviceCode ? `?code=${deviceCode}` : ""}`}
						className="inline-flex items-center font-medium text-primary hover:underline"
					>
						<UserPlusIcon className="mr-1 size-3.5" />
						Create an account
						<ArrowRightIcon className="ml-1 size-3" />
					</Link>
				</div>

				<p className="mt-4 text-center text-[10px] text-muted-foreground/60">
					<GithubIcon className="mr-1 inline size-3" />
					Single sign-on across{" "}
					<a href="https://tryinfinitecode.vercel.app/" className="underline">
						tryinfinitecode.vercel.app
					</a>
					.
				</p>
			</div>
		</main>
	)
}

function ModeTab({
	active,
	onClick,
	label,
}: {
	active: boolean
	onClick: () => void
	label: string
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`rounded-md border px-2 py-1.5 transition-colors ${
				active
					? "border-primary/50 bg-primary/10 text-primary"
					: "border-border/40 text-muted-foreground hover:bg-accent/40"
			}`}
		>
			{label}
		</button>
	)
}
