import {
	SidebarContent,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@infinitecode/ui/components/sidebar"
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { useAtomValue } from "jotai"
import {
	ArrowLeftIcon,
	BellIcon,
	BrainIcon,
	GitForkIcon,
	GaugeIcon,
	InfoIcon,
	MicIcon,
	SearchIcon,
	ServerIcon,
	SettingsIcon,
	WrenchIcon,
} from "lucide-react"
import { useEffect } from "react"
import { lastAppRouteAtom } from "../../atoms/ui"
import { resolveSettingsBackTarget } from "../../lib/app-navigation"
import { AdsterraAd } from "../chat/adsterra-ad"
import { useSetSidebarSlot } from "../sidebar-slot-context"

// ============================================================
// Ambient auction context for the two always-on Settings slots
// ============================================================
//
// Hoisted to module scope so the array reference is absolutely stable across
// the lifetime of the route. `useAdRotating` derives its fetch key
// from the messages content (not the reference), so a stable identity here
// keeps the auction cache warm instead of refetching on every SettingsPage
// render. Module-level hoisting is also cheaper than `useMemo([], [])`
// because no hook call is needed for static data.
//
// Refresh-cadence offsets vs the existing always-on slots are chosen to
// avoid synchronized fetches across surfaces. Ad charges per request,
// not per distinct slot, so two slots firing on the same beat counts as
// ONE distinct request — we want their beats permuted:
//   - chat composer bottom_page ........... 60 s default (existing)
//   - sidebar (main app) ................... 180 s (existing)
//   - settings sidebar ..................... 167 s (NEW) ← LCM(167,180) ≈ 501 min
//   - settings page footer bottom_page .... 73 s (NEW)  ← LCM(60,73) ≈ 73 min
// All four offsets are pairwise co-prime with their sync-against neighbor,
// so practically no auction stacking fires within any reasonable session.


// ============================================================
// Tab definitions
// ============================================================

type SettingsTab =
	| "general"
	| "servers"
	| "notifications"
	| "providers"
	| "worktrees"
	| "memory"
	| "voice"
	| "web-search"
	| "performance"
	| "setup"
	| "about"

const tabs: { id: SettingsTab; label: string; icon: typeof SettingsIcon }[] = [
	{ id: "general", label: "General", icon: SettingsIcon },
	{ id: "servers", label: "Servers", icon: ServerIcon },
	{ id: "notifications", label: "Notifications", icon: BellIcon },
	// { id: "providers", label: "Providers", icon: PlugIcon },
	{ id: "worktrees", label: "Worktrees", icon: GitForkIcon },
	{ id: "memory", label: "Memory", icon: BrainIcon },
	{ id: "voice", label: "Voice", icon: MicIcon },
	{ id: "web-search", label: "Web search", icon: SearchIcon },
	{ id: "performance", label: "Performance", icon: GaugeIcon },
	{ id: "setup", label: "Setup", icon: WrenchIcon },
	{ id: "about", label: "About", icon: InfoIcon },
]

// ============================================================
// Settings layout (renders <Outlet /> for child routes)
// ============================================================
//
// Refresh-cadence offsets vs the existing always-on slots are chosen to
// avoid synchronized fetches across surfaces. Ad charges per request,
// not per distinct slot, so two slots firing on the same beat counts as
// ONE distinct request — we want their beats permuted:
//   - chat composer bottom_page ........... 60 s default (existing)
//   - chat top banner top_page ............ removed (4-layer cleanup)
//   - sidebar (main app) ................... 180 s (existing)
//   - settings sidebar ..................... 165 s (NEW) ← off-beat from main sidebar
//   - settings page footer bottom_page .... 75 s (NEW)  ← off-beat from chat composer
// 60/75/165/180 is intentionally not a clean multiple so multiple surfaces
// don't race to the same upstream auction window.

export function SettingsPage() {
	const { setContent, setFooter } = useSetSidebarSlot()

	useEffect(() => {
		setContent(<SettingsSidebarContent />)
		setFooter(false)
		return () => {
			setContent(null)
			setFooter(null)
		}
	}, [setContent, setFooter])

	return (
		<div className="flex h-full flex-col overflow-y-auto">
			<div className="mx-auto w-full max-w-2xl flex-1 px-8 py-6">
				<Outlet />
			</div>
			{/* Settings footer Ad ad — reuses the existing `bottom_page`
			    placement_id (same `Bottom-MessageField-Ad` slot as the chat
			    composer) rather than introducing a new IPC slot. Mounted with
			    73 s rotation; LCM(60, 73) = 73 min so it stays off-beat from
			    the chat composer's 60 s cadence. `Ad` itself
			    returns just the inner pill card; the chat-view wrapper
			    provides panel chrome around it that we deliberately omit here
			    because settings has no ChatInputSection below to fill it. */}
			<div className="mx-auto w-full max-w-2xl shrink-0 px-8 pb-6 pt-2">
				<AdsterraAd placement="bottom_page" />
			</div>
		</div>
	)
}

// ============================================================
// Sidebar content injected via slot context
// ============================================================

function SettingsSidebarContent() {
	const navigate = useNavigate()
	const pathname = useRouterState({ select: (s) => s.location.pathname })
	const lastAppRoute = useAtomValue(lastAppRouteAtom)

	// Derive active tab from the last path segment (e.g. "/settings/general" -> "general")
	const activeTab = pathname.split("/").pop() || "general"

	return (
		<SidebarContent className="gap-0 bg-transparent px-0 pb-3">
			<div className="flex shrink-0 flex-col gap-1 px-3 pb-7">
				<button
					type="button"
					onClick={() => navigate(resolveSettingsBackTarget(lastAppRoute))}
					className="flex h-8 w-full items-center gap-2.5 rounded-lg px-1.5 text-left text-sm font-normal text-muted-foreground transition-colors hover:bg-black/[0.04] hover:text-sidebar-foreground dark:hover:bg-white/[0.06]"
				>
					<span className="flex size-[18px] shrink-0 items-center justify-center text-sidebar-foreground/90">
						<ArrowLeftIcon aria-hidden="true" className="size-[18px]" />
					</span>
					<span className="min-w-0 flex-1 truncate">Back to app</span>
				</button>
			</div>
			<div className="min-h-0 flex-1 overflow-auto px-3 pb-2">
				<SidebarMenu>
					{tabs.map((tab) => {
						const Icon = tab.icon
						return (
							<SidebarMenuItem key={tab.id}>
								<SidebarMenuButton
									isActive={activeTab === tab.id}
									onClick={() => navigate({ to: `/settings/${tab.id}` })}
									tooltip={tab.label}
								>
									<Icon aria-hidden="true" className="size-4" />
									<span>{tab.label}</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
						)
					})}
				</SidebarMenu>
			</div>
			{/* Settings sidebar Ad ad — reuses the `sidebar` placement_id
			    ("Sidebar-Ad") that the main AppSidebarContent also uses, with
			    the upstream canonical `bottom_page` auction route. Sidebar
			    impressions across both surfaces accumulate under a single
			    "Sidebar-Ad" entry on the dashboard. `mt-auto` pins it to the
			    bottom of SidebarContent so the Back-to-app button and the
			    tab list stay above. 167 s rotation (LCM(167, 180) ≈ 501 min)
			    keeps it off-beat from the main sidebar's 180 s cadence. px-3
			    + pb-2 + shrink-0 match the main sidebar's gutter pattern.

			    Future per-context reporting — to split this into a separate
			    `settings_sidebar` slot: add `'settings_sidebar': 'Settings-
			    Sidebar-Ad'` to `PLACEMENT_ID_BY_SLOT` and `'settings_sidebar':
			    'bottom_page'` to `SLOT_TO_UPSTREAM_PLACEMENT` in
			    `infinitecode/apps/desktop/src/main/ipc-handlers.ts`, extend
			    the `placement_id` union in `preload/api.d.ts` + `index.ts`,
			    and (since `Ad` currently hardcodes
			    `placement: "sidebar"`) refactor it to accept a `placement`
			    prop or create a thin `GravitySettingsSidebarBanner` wrapper
			    that passes `"settings_sidebar"`. Total budget: ~10 lines —
			    4-5 IPC + preload + 5 renderer-side component refactor. The IPC
			    + preload side is the easy part; the renderer-side split needs
			    a 5-line component refactor. */}
			<div className="mt-auto shrink-0 px-3 pb-2">
				<AdsterraAd placement="sidebar" />
			</div>
		</SidebarContent>
	)
}
