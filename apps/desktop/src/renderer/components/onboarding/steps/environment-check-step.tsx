/**
 * Onboarding Step 2: Environment Check.
 *
 * Verifies the bundled InfiniteCode runtime used by the private stdio ACP child process.
 */

import { Button } from "@infinitecode/ui/components/button"
import { Spinner } from "@infinitecode/ui/components/spinner"
import {
	AlertCircleIcon,
	ArrowRightIcon,
	CheckCircle2Icon,
	RefreshCwIcon,
	XCircleIcon,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { InfiniteCodeCheckResult } from "../../../../preload/api"

type CheckStatus = "pending" | "running" | "success" | "warning" | "error"

interface CheckItem {
	id: string
	label: string
	status: CheckStatus
	detail?: string
}

interface EnvironmentCheckStepProps {
	onComplete: (version: string | null) => void
}

export function EnvironmentCheckStep({ onComplete }: EnvironmentCheckStepProps) {
	const [checks, setChecks] = useState<CheckItem[]>([
		{ id: "locate", label: "Locating bundled InfiniteCode runtime", status: "pending" },
		{ id: "version", label: "Checking version compatibility", status: "pending" },
	])
	const [infinitecodeResult, setInfiniteCodeResult] = useState<InfiniteCodeCheckResult | null>(null)
	const [allDone, setAllDone] = useState(false)
	const hasRun = useRef(false)
	const isElectron = typeof window !== "undefined" && "infinitecode" in window

	const updateCheck = useCallback((id: string, update: Partial<CheckItem>) => {
		setChecks((prev) => prev.map((check) => (check.id === id ? { ...check, ...update } : check)))
	}, [])

	const runChecks = useCallback(async () => {
		if (!isElectron) return
		setAllDone(false)
		setInfiniteCodeResult(null)
		setChecks([
			{ id: "locate", label: "Locating bundled InfiniteCode runtime", status: "running" },
			{ id: "version", label: "Checking version compatibility", status: "pending" },
		])

		try {
			const result = await window.infinitecode.onboarding.checkInfiniteCode()
			setInfiniteCodeResult(result)

			if (!result.installed) {
				updateCheck("locate", {
					status: "error",
					label: "Bundled InfiniteCode runtime not found",
					detail: result.message ?? "Reinstall InfiniteCode Desktop to continue.",
				})
				return
			}

			updateCheck("locate", {
				status: "success",
				label: `InfiniteCode ${result.version} found`,
				detail: result.path ?? undefined,
			})
			updateCheck("version", { status: "running" })
			await new Promise((resolve) => setTimeout(resolve, 300))

			if (result.compatibility === "too-old" || result.compatibility === "blocked") {
				updateCheck("version", {
					status: "error",
					label: result.compatibility === "blocked" ? "Version blocked" : "Version not compatible",
					detail: result.message ?? undefined,
				})
				return
			}

			if (result.compatibility === "too-new") {
				updateCheck("version", {
					status: "warning",
					label: "Newer than tested",
					detail: result.message ?? undefined,
				})
			} else {
				updateCheck("version", { status: "success", label: "Version compatible" })
			}
			setAllDone(true)
		} catch (error) {
			updateCheck("locate", {
				status: "error",
				detail: error instanceof Error ? error.message : "Check failed",
			})
		}
	}, [isElectron, updateCheck])

	useEffect(() => {
		if (hasRun.current) return
		hasRun.current = true
		runChecks()
	}, [runChecks])

	return (
		<div className="flex h-full flex-col items-center justify-center px-6">
			<div className="w-full max-w-lg space-y-6">
				<div className="text-center">
					<h2 className="text-xl font-semibold text-foreground">Environment Check</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						Verifying your local setup is ready for InfiniteCode.
					</p>
				</div>

				<div className="space-y-3">
					{checks.map((check) => (
						<div
							key={check.id}
							data-slot="onboarding-card"
							className="flex items-start gap-3 rounded-lg border border-border bg-background p-3"
						>
							<div className="mt-0.5 shrink-0">
								<CheckStatusIcon status={check.status} />
							</div>
							<div className="min-w-0 flex-1">
								<p className="text-sm font-medium text-foreground">{check.label}</p>
								{check.detail && (
									<p className="mt-0.5 text-xs text-muted-foreground">{check.detail}</p>
								)}
							</div>
						</div>
					))}
				</div>

				<div className="flex justify-center gap-3">
					{!allDone && (
						<Button
							size="sm"
							variant="outline"
							onClick={() => {
								hasRun.current = false
								runChecks()
							}}
							className="gap-2"
						>
							<RefreshCwIcon aria-hidden="true" className="size-3.5" />
							Re-check
						</Button>
					)}

					{allDone && (
						<Button
							size="default"
							onClick={() => onComplete(infinitecodeResult?.version ?? null)}
							className="gap-2"
						>
							Continue
							<ArrowRightIcon aria-hidden="true" className="size-4" />
						</Button>
					)}
				</div>
			</div>
		</div>
	)
}

function CheckStatusIcon({ status }: { status: CheckStatus }) {
	switch (status) {
		case "pending":
			return <div className="size-4 rounded-full border border-muted-foreground/20" />
		case "running":
			return <Spinner className="size-4" />
		case "success":
			return <CheckCircle2Icon className="size-4 text-emerald-500" />
		case "warning":
			return <AlertCircleIcon className="size-4 text-amber-500" />
		case "error":
			return <XCircleIcon className="size-4 text-red-500" />
	}
}
