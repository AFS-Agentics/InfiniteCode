/**
 * Signup page — email/password registration + Google OAuth.
 *
 * Preserves the `?code=...` device-pairing semantics so a user coming
 * from the desktop/CLI doesn't need to re-trigger the device linking
 * after their account is created. Mirrors the design language of
 * Login.tsx for visual consistency.
 */
import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import {
	AlertTriangleIcon,
	ArrowRightIcon,
	CheckIcon,
	GithubIcon,
	KeyRoundIcon,
	Loader2Icon,
	LogInIcon,
	UserPlusIcon,
} from "lucide-react"

import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const DEVICE_CODE_PARAM = "code"

export default function SignupPage() {
	const { configured, signInWithGoogle, signUpWithPassword, user } = useAuth()
	const navigate = useNavigate()
	const [busy, setBusy] = React.useState(false)
	const [error, setError] = React.useState<string | null>(null)
	const [info, setInfo] = React.useState<string | null>(null)
	const [email, setEmail] = React.useState("")
	const [password, setPassword] = React.useState("")
	const [name, setName] = React.useState("")

	const deviceCode = React.useMemo(() => {
		if (typeof window === "undefined") return null
		const u = new URL(window.location.href)
		return u.searchParams.get(DEVICE_CODE_PARAM)
	}, [])

	// If the visitor is already signed in, skip the form entirely.
	React.useEffect(() => {
		if (user) {
			navigate(deviceCode ? `/login?code=${deviceCode}` : "/profile", { replace: true })
		}
	}, [user, deviceCode, navigate])

	async function runSignUp() {
		setBusy(true)
		setError(null)
		setInfo(null)
		try {
			await signUpWithPassword(email.trim(), password, name.trim())
			setInfo(
				"Account created — check your inbox to confirm your email, then return here.",
			)
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	async function runGoogle() {
		setBusy(true)
		setError(null)
		try {
			await signInWithGoogle("/signup")
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
							<code>VITE_SUPABASE_ANON_KEY</code> in <code>.env</code> and rebuild.
						</p>
					</CardContent>
				</Card>
			</main>
		)
	}

	return (
		<main className="grid min-h-screen place-items-center bg-background p-6">
			<Card className="w-full max-w-md">
				<CardContent className="space-y-6 py-8">
					<header className="space-y-1 text-center">
						<div className="mx-auto grid size-10 place-items-center rounded-lg bg-gradient-to-br from-emerald-500 to-sky-600 shadow-lg shadow-emerald-500/20">
							<UserPlusIcon className="size-5 text-white" />
						</div>
						<h1 className="text-xl font-semibold">Create your InfiniteCode account</h1>
						<p className="text-xs text-muted-foreground">
							The same identity works across the website, the desktop app, and the
							browser-based agent.
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

					<Button
						type="button"
						className="w-full"
						variant="outline"
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

					<div className="flex items-center gap-3 text-xs text-muted-foreground">
						<span className="h-px flex-1 bg-border/60" />
						<span>or with email</span>
						<span className="h-px flex-1 bg-border/60" />
					</div>

					<form
						className="space-y-3"
						onSubmit={(e) => {
							e.preventDefault()
							if (!email || !password || !name) return
							void runSignUp()
						}}
					>
						<div className="grid gap-1.5">
							<Label htmlFor="signup-name">Display name</Label>
							<Input
								id="signup-name"
								type="text"
								autoComplete="name"
								placeholder="Ada Lovelace"
								value={name}
								onChange={(e) => setName(e.target.value)}
								required
								minLength={2}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="signup-email">Email</Label>
							<Input
								id="signup-email"
								type="email"
								autoComplete="email"
								placeholder="[email protected]"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								required
							/>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="signup-password">Password</Label>
							<Input
								id="signup-password"
								type="password"
								autoComplete="new-password"
								placeholder="At least 8 characters"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								required
								minLength={8}
							/>
							<p className="text-[10px] text-muted-foreground">
								<CheckIcon className="mr-1 inline size-3 text-emerald-500" />
								Use 8+ characters with letters, numbers, or symbols.
							</p>
						</div>

						<Button type="submit" className="w-full" disabled={busy}>
							{busy ? (
								<Loader2Icon className="mr-2 size-4 animate-spin" />
							) : (
								<KeyRoundIcon className="mr-2 size-4" />
							)}
							Create account
						</Button>
					</form>

					<div className="border-t border-border/40 pt-4 text-center text-xs">
						Already have an account?{" "}
						<Link
							to={`/login${deviceCode ? `?code=${deviceCode}` : ""}`}
							className="font-medium text-primary hover:underline"
						>
							Sign in
							<ArrowRightIcon className="ml-1 inline size-3" />
						</Link>
					</div>

					<p className="text-center text-[10px] text-muted-foreground/60">
						<GithubIcon className="mr-1 inline size-3" />
						Single sign-on across{" "}
						<a href="https://tryinfinitecode.vercel.app/" className="underline">
							tryinfinitecode.vercel.app
						</a>{" "}
						+ desktop + CLI.
					</p>
				</CardContent>
			</Card>
		</main>
	)
}
