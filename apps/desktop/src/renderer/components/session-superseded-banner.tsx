import { AlertTriangleIcon, XIcon } from "lucide-react"
import { useAtom, useSetAtom } from "jotai"
import { useEffect } from "react"
import { Button } from "@infinitecode/ui/components/button"
import {
	sessionSupersededAtom,
	sessionSupersededDismissAtom,
} from "@/atoms/session-superseded"

/**
 * Invisible IPC bridge: subscribes to `window.infinitecode.onSessionSuperseded`
 * (forwarded from the main-process session-lock acquire failure) and writes
 * the detail block into `sessionSupersededAtom`. Mount this once near the
 * app root — sibling to the banner — so the atom is hot before any
 * `infinitecode:ensure` IPC call can fire.
 *
 * The `window.infinitecode` global is typed via the
 * `apps/desktop/src/preload/api.d.ts` `declare global { interface Window }`
 * block, so no defensive `as unknown as {...}` cast is necessary.
 */
export function SessionSupersededBridge() {
	const setDetail = useSetAtom(sessionSupersededAtom)
	useEffect(() => {
		const subscribe = window.infinitecode.onSessionSuperseded
		const off = subscribe((detail) => {
			setDetail(detail)
		})
		return () => {
			off()
		}
	}, [setDetail])
	return null
}

/**
 * Full-screen banner shown when the desktop window catches a
 * `session:superseded` IPC event — meaning a second instance of infinitecode
 * is already active.
 *
 * UX mirrors Freebuff's "Another freebuff CLI took over this account. Close
 * the other instance, then restart." — see
 * `freebuff/cli-engine/src/hooks/helpers/send-message.ts:600-612`.
 *
 * Acknowledge only hides this overlay; the underlying supersede state does
 * NOT clear until the user actually closes other infinitecode instances, so a
 * subsequent `infinitecode:ensure` IPC call re-broadcasts the event and the
 * banner reappears. We deliberately do not call the dismiss a "dismiss" —
 * that wording implied the problem was solved. The only true recovery is to
 * quit this Electron process.
 */
export function SessionSupersededBanner() {
	const [detail] = useAtom(sessionSupersededAtom)
	const [, dismiss] = useAtom(sessionSupersededDismissAtom)
	if (!detail) return null

	return (
		<div className="pointer-events-auto fixed inset-0 z-[2147483647] flex items-center justify-center bg-background/85 backdrop-blur-sm">
			<div className="flex max-w-lg flex-col gap-4 rounded-lg border border-warning/40 bg-card p-6 shadow-lg">
				<div className="flex items-start gap-3">
					<AlertTriangleIcon
						className="mt-0.5 size-5 shrink-0 text-warning"
						strokeWidth={1.5}
					/>
					<div className="flex flex-col gap-2">
						<h2 className="text-base font-semibold">
							Another InfiniteCode instance took over this session.
						</h2>
						<p className="text-sm text-muted-foreground">
							A separate{" "}
							<code className="rounded bg-muted px-1.5 py-0.5 text-xs">
								infinitecode
							</code>{" "}
							process — pid {detail.otherPid} running as the{" "}
							<code className="rounded bg-muted px-1.5 py-0.5 text-xs">
								{detail.otherSurface}
							</code>{" "}
							— holds the session lock. InfiniteCode enforces one session per
							user.
						</p>
						<p className="text-sm text-muted-foreground">
							Close the other instance, quit this window, and reopen
							InfiniteCode to take the seat. If the lock is stale, delete{" "}
							<code className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">
								{detail.lockPath}
							</code>
							.
						</p>
					</div>
				</div>
				<div className="flex justify-end gap-2">
					<Button variant="outline" onClick={() => window.close()}>
						<XIcon className="mr-1.5 size-3.5" strokeWidth={1.5} />
						Close window
					</Button>
					<Button variant="default" onClick={() => dismiss(null)}>
						Acknowledged
					</Button>
				</div>
			</div>
		</div>
	)
}
