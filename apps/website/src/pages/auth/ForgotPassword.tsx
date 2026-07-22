/**
 * Forgot password request — sends a reset link via Supabase.
 *
 * Mirrors Login.tsx styling. After the user submits, surfaces the
 * generic "check your inbox" copy (don't reveal whether the email
 * exists — privacy + standard practice).
 */
import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import {
	AlertTriangleIcon,
	ArrowLeftIcon,
	ArrowRightIcon,
	CheckCircle2Icon,
	Loader2Icon,
	MailIcon,
} from "lucide-react"

import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function ForgotPasswordPage() {
	const { configured, resetPassword } = useAuth()
	const navigate = useNavigate()
	const [email, setEmail] = React.useState("")
	const [busy, setBusy] = React.useState(false)
	const [error, setError] = React.useState<string | null>(null)
	const [sent, setSent] = React.useState(false)

	async function run() {
		setBusy(true)
		setError(null)
		try {
			await resetPassword(email.trim())
			setSent(true)
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
						<div className="mx-auto grid size-10 place-items-center rounded-lg bg-gradient-to-br from-amber-400 to-rose-500 shadow-lg shadow-amber-500/20">
							<MailIcon className="size-5 text-white" />
						</div>
						<h1 className="text-xl font-semibold">Reset your password</h1>
						<p className="text-xs text-muted-foreground">
							We'll send you a one-time link to set a new password.
						</p>
					</header>

					{sent ? (
						<div className="space-y-3 text-center text-sm">
							<div className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-500/15 text-emerald-400">
								<CheckCircle2Icon className="size-6" />
							</div>
							<p className="text-foreground">Check your inbox</p>
							<p className="text-xs text-muted-foreground">
								If an account exists for <strong>{email}</strong>, we just sent a
								reset link. The link expires in 1 hour.
							</p>
							<Button
								variant="outline"
								size="sm"
								onClick={() => navigate("/login")}
								className="mt-2"
							>
								<ArrowLeftIcon className="mr-1 size-4" />
								Back to sign in
							</Button>
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
									if (!email) return
									void run()
								}}
							>
								<div className="grid gap-1.5">
									<Label htmlFor="forgot-email">Email</Label>
									<Input
										id="forgot-email"
										type="email"
										autoComplete="email"
										placeholder="[email protected]"
										value={email}
										onChange={(e) => setEmail(e.target.value)}
										required
									/>
								</div>
								<Button type="submit" className="w-full" disabled={busy}>
									{busy ? (
										<Loader2Icon className="mr-2 size-4 animate-spin" />
									) : (
										<MailIcon className="mr-2 size-4" />
									)}
									Send reset link
								</Button>
							</form>
						</>
					)}

					<div className="border-t border-border/40 pt-4 text-center text-xs">
						<Link
							to="/login"
							className="inline-flex items-center font-medium text-muted-foreground hover:text-foreground"
						>
							<ArrowLeftIcon className="mr-1 size-3" />
							Back to sign in
							<ArrowRightIcon className="ml-1 size-3" />
						</Link>
					</div>
				</CardContent>
			</Card>
		</main>
	)
}
