/**
 * Reset password landing page — Supabase redirects here from the
 * reset email with `#access_token=...&type=recovery` in the URL
 * fragment. We surface the new-password form and call
 * `supabase.auth.updateUser({ password })` to commit the change.
 */
import * as React from "react"
import { useNavigate } from "react-router-dom"
import {
	AlertTriangleIcon,
	CheckCircle2Icon,
	KeyRoundIcon,
	Loader2Icon,
} from "lucide-react"

import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function ResetPasswordPage() {
	const { configured, updatePassword, user } = useAuth()
	const navigate = useNavigate()
	const [password, setPassword] = React.useState("")
	const [confirm, setConfirm] = React.useState("")
	const [busy, setBusy] = React.useState(false)
	const [error, setError] = React.useState<string | null>(null)
	const [done, setDone] = React.useState(false)

	// If a user is signed in normally and lands here, just bounce to /profile —
	// they didn't arrive from a recovery email.
	React.useEffect(() => {
		if (!configured) return
		if (user && !isRecoveryFlow()) {
			navigate("/profile", { replace: true })
		}
	}, [configured, user, navigate])

	function isRecoveryFlow(): boolean {
		if (typeof window === "undefined") return false
		const hash = window.location.hash.toLowerCase()
		return hash.includes("type=recovery")
	}

	async function run() {
		setError(null)
		if (password.length < 8) {
			setError("Password must be at least 8 characters.")
			return
		}
		if (password !== confirm) {
			setError("Passwords don't match.")
			return
		}
		setBusy(true)
		try {
			await updatePassword(password)
			setDone(true)
			// Give Supabase a moment to persist, then go to the profile.
			setTimeout(() => navigate("/profile", { replace: true }), 1500)
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
							Set the Supabase env vars and rebuild.
						</p>
					</CardContent>
				</Card>
			</main>
		)
	}

	if (!isRecoveryFlow()) {
		return (
			<main className="grid min-h-screen place-items-center bg-background p-6">
				<Card className="max-w-md">
					<CardContent className="space-y-3 py-8 text-sm">
						<h1 className="text-base font-semibold">Recovery link not detected</h1>
						<p className="text-muted-foreground">
							This page expects to be opened from a password-reset email. To reset
							your password,{" "}
							<a className="text-primary underline" href="/forgot-password">
								request a new link
							</a>
							.
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
							<KeyRoundIcon className="size-5 text-white" />
						</div>
						<h1 className="text-xl font-semibold">Set a new password</h1>
						<p className="text-xs text-muted-foreground">
							Choose something strong you don't reuse anywhere else.
						</p>
					</header>

					{done ? (
						<div className="space-y-3 text-center text-sm">
							<div className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-500/15 text-emerald-400">
								<CheckCircle2Icon className="size-6" />
							</div>
							<p className="text-foreground">Password updated</p>
							<p className="text-xs text-muted-foreground">
								Redirecting you to your profile…
							</p>
						</div>
					) : (
						<>
							{error && (
								<div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
									{error}
								</div>
							)}
							<form
								className="space-y-3"
								onSubmit={(e) => {
									e.preventDefault()
									if (!password || !confirm) return
									void run()
								}}
							>
								<div className="grid gap-1.5">
									<Label htmlFor="reset-password">New password</Label>
									<Input
										id="reset-password"
										type="password"
										autoComplete="new-password"
										value={password}
										onChange={(e) => setPassword(e.target.value)}
										required
										minLength={8}
									/>
								</div>
								<div className="grid gap-1.5">
									<Label htmlFor="reset-confirm">Confirm new password</Label>
									<Input
										id="reset-confirm"
										type="password"
										autoComplete="new-password"
										value={confirm}
										onChange={(e) => setConfirm(e.target.value)}
										required
										minLength={8}
									/>
								</div>
								<Button type="submit" className="w-full" disabled={busy}>
									{busy ? (
										<Loader2Icon className="mr-2 size-4 animate-spin" />
									) : (
										<KeyRoundIcon className="mr-2 size-4" />
									)}
									Update password
								</Button>
							</form>
						</>
					)}
				</CardContent>
			</Card>
		</main>
	)
}
