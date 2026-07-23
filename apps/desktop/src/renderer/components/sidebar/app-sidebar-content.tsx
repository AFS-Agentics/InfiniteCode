import { SidebarContent, SidebarFooter } from "@infinitecode/ui/components/sidebar"
import { cn } from "@infinitecode/ui/lib/utils"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
	BookmarkIcon,
	Clock3Icon,
	FolderPlusIcon,
	KeyRoundIcon,
	Loader2Icon,
	LogInIcon,
	LogOutIcon,
	PenLineIcon,
	SearchIcon,
	SettingsIcon,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { authAtom, loadAuthFromMain, startSignIn, signOutFromRenderer } from "../../atoms/auth"
import { activeServerConfigAtom } from "../../atoms/connection"
import { sandboxMappingsAtom } from "../../atoms/derived/agents"
import { automationsEnabledAtom } from "../../atoms/feature-flags"
import {
	artifactCountAtom,
	artifactPaneOpenAtom,
} from "../../atoms/artifacts"
import { projectPaginationFamily } from "../../atoms/sessions"
import { appStore } from "../../atoms/store"
import { sessionScrollTopFamily } from "../../atoms/ui"
import type { Agent, SidebarProject } from "../../lib/types"
import { freezeSessionScroll } from "../../lib/settings-scroll-freeze"
import { openInTarget } from "../../services/backend"
import { loadMoreProjectSessions, loadProjectSessions } from "../../services/connection-manager"
import {
	buildSidebarItems,
	type SidebarDisplayItem,
} from "./sidebar-data"
import {
	FolderRemoveDialog,
	MissingFolderDialog,
} from "./sidebar-folder-dialogs"
import { AddProjectMenu, SidebarMainMenu } from "./sidebar-menus"
import { sidebarPreferencesAtom } from "./sidebar-preferences"
import { ProjectRow, SessionRow } from "./sidebar-rows"
import { AdsterraAd } from "../chat/adsterra-ad"


interface AppSidebarContentProps {
	agents: Agent[]
	projects: SidebarProject[]
	onOpenCommandPalette: () => void
	onCreateFolder?: () => void
	onAddProject?: () => void
	onRemoveProject?: (project: SidebarProject) => Promise<void>
	onRenameSession?: (agent: Agent, title: string) => Promise<void>
	onDeleteSession?: (agent: Agent) => Promise<void>
	onForkSession?: (agent: Agent) => Promise<void>
}

function groupAgentsByProject(agents: Agent[]): Map<string, Agent[]> {
	const grouped = new Map<string, Agent[]>()
	for (const agent of agents) {
		if (agent.parentId) continue
		const directory = agent.projectDirectory || agent.directory
		const existing = grouped.get(directory)
		if (existing) {
			existing.push(agent)
		} else {
			grouped.set(directory, [agent])
		}
	}
	return grouped
}

const sidebarPrimaryIconClass = "size-4 stroke-[1.6]"

function TopActionRow({
	children,
	icon,
	onClick,
	"aria-label": ariaLabel,
}: {
	children: ReactNode
	icon: ReactNode
	onClick: () => void
	"aria-label"?: string
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={ariaLabel}
			className="flex h-8 w-full items-center gap-2.5 rounded-lg px-1.5 text-left text-sm font-normal text-sidebar-foreground transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
		>
			<span className="flex size-4 shrink-0 items-center justify-center text-sidebar-foreground/90">
				{icon}
			</span>
			<span className="min-w-0 flex-1 truncate">{children}</span>
		</button>
	)
}

function ProjectSection({
	item,
	selectedProjectSlug,
	selectedSessionId,
	isCollapsed,
	onToggleCollapsed,
	onRevealInFinder,
	onRemoveProject,
	onMissingFolder,
	sandboxDirs,
	onRenameSession,
	onDeleteSession,
	onForkSession,
}: {
	item: Extract<SidebarDisplayItem, { type: "project" }>
	selectedProjectSlug: string | undefined
	selectedSessionId: string | null
	isCollapsed: boolean
	onToggleCollapsed: (directory: string) => void
	onRevealInFinder?: (directory: string) => void
	onRemoveProject: (project: SidebarProject) => void
	onMissingFolder: (project: SidebarProject) => void
	sandboxDirs: Set<string> | undefined
	onRenameSession?: (agent: Agent, title: string) => Promise<void>
	onDeleteSession?: (agent: Agent) => Promise<void>
	onForkSession?: (agent: Agent) => Promise<void>
}) {
	const navigate = useNavigate()
	const pagination = useAtomValue(projectPaginationFamily(item.project.directory))
	const canShowSessions = true
	const isUnavailable = item.project.folderStatus ? item.project.folderStatus !== "available" : false

	const handleProjectSelect = useCallback(() => {
		if (isUnavailable) {
			onMissingFolder(item.project)
			return
		}
		if (canShowSessions && !isCollapsed && !pagination.loaded && !pagination.loading) {
			loadProjectSessions(item.project.directory, sandboxDirs, { limit: 5, roots: true })
		}
		navigate({
			to: "/project/$projectSlug",
			params: { projectSlug: item.project.slug },
		})
	}, [
		item.project.directory,
		item.project.slug,
		navigate,
		onMissingFolder,
		pagination.loaded,
		pagination.loading,
		sandboxDirs,
		canShowSessions,
		isCollapsed,
		isUnavailable,
	])

	const handleNewChat = useCallback(() => {
		if (isUnavailable) {
			onMissingFolder(item.project)
			return
		}
		navigate({
			to: "/project/$projectSlug",
			params: { projectSlug: item.project.slug },
		})
	}, [isUnavailable, item.project, navigate, onMissingFolder])

	const handleToggleCollapsed = useCallback(() => {
		if (isUnavailable) {
			onMissingFolder(item.project)
			return
		}
		if (canShowSessions && isCollapsed && !pagination.loaded && !pagination.loading) {
			loadProjectSessions(item.project.directory, sandboxDirs, { limit: 5, roots: true })
		}
		onToggleCollapsed(item.project.directory)
	}, [
		canShowSessions,
		isCollapsed,
		isUnavailable,
		item.project,
		item.project.directory,
		onMissingFolder,
		onToggleCollapsed,
		pagination.loaded,
		pagination.loading,
		sandboxDirs,
	])

	const handleLoadMore = useCallback(() => {
		loadMoreProjectSessions(item.project.directory, pagination.currentLimit)
	}, [item.project.directory, pagination.currentLimit])

	const handleRevealInFinder = useCallback(() => {
		onRevealInFinder?.(item.project.directory)
	}, [item.project.directory, onRevealInFinder])

	return (
		<section className="flex flex-col">
			<ProjectRow
				project={item.project}
				isSelected={selectedProjectSlug === item.project.slug && !selectedSessionId}
				showCount={false}
				isCollapsed={isCollapsed}
				canToggleSessions={canShowSessions}
				onSelect={handleProjectSelect}
				onToggleCollapsed={handleToggleCollapsed}
				onNewChat={handleNewChat}
				onRevealInFinder={isUnavailable ? undefined : handleRevealInFinder}
				onRemoveProject={() => onRemoveProject(item.project)}
				isUnavailable={isUnavailable}
			/>
			{canShowSessions && (
				<div
					aria-hidden={isCollapsed}
					className={cn(
						"grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
						isCollapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
					)}
					inert={isCollapsed}
				>
					<div className={cn("min-h-0 overflow-hidden", isCollapsed && "pointer-events-none")}>
						<div className="flex flex-col gap-y-1">
							{pagination.loading && item.sessions.length === 0 && (
								<div className="flex h-8 items-center gap-2 py-1 pr-1.5 pl-[34px] text-xs text-muted-foreground">
									<Loader2Icon className="size-3.5 animate-spin" />
									Loading
								</div>
							)}
							{item.sessions.map((agent) => (
								<SessionRow
									key={agent.id}
									agent={agent}
									isSelected={agent.id === selectedSessionId}
									onRename={onRenameSession}
									onDelete={onDeleteSession}
									onFork={onForkSession}
									projectUnavailable={isUnavailable}
									onUnavailableProject={() => onMissingFolder(item.project)}
								/>
							))}
							{pagination.loaded && pagination.hasMore && item.sessions.length > 0 && (
								<button
									type="button"
									onClick={handleLoadMore}
									disabled={pagination.loading}
									className="h-8 rounded-lg py-1 pr-1.5 pl-7 text-left text-[13px] font-normal text-muted-foreground transition-colors hover:bg-black/[0.03] hover:text-muted-foreground/90 disabled:opacity-60 dark:hover:bg-white/[0.05]"
								>
									{pagination.loading ? "Loading..." : "Show more"}
								</button>
							)}
						</div>
					</div>
				</div>
			)}
		</section>
	)
}

export function AppSidebarContent({
	agents,
	projects,
	onOpenCommandPalette,
	onCreateFolder,
	onAddProject,
	onRemoveProject,
	onRenameSession,
	onDeleteSession,
	onForkSession,
}: AppSidebarContentProps) {
	const navigate = useNavigate()
	const routeParams = useParams({ strict: false }) as { projectSlug?: string; sessionId?: string }
	const selectedSessionId = routeParams.sessionId ?? null
	const [preferences, setPreferences] = useAtom(sidebarPreferencesAtom)
	const [collapsedProjectDirs, setCollapsedProjectDirs] = useState<Set<string>>(() => new Set())
	const [removeTarget, setRemoveTarget] = useState<SidebarProject | null>(null)
	const [missingTarget, setMissingTarget] = useState<SidebarProject | null>(null)
	const [folderActionPending, setFolderActionPending] = useState(false)
	const [folderActionError, setFolderActionError] = useState<string | null>(null)
	const { parentToSandboxes } = useAtomValue(sandboxMappingsAtom)
	const automationsEnabled = useAtomValue(automationsEnabledAtom)
	const activeServer = useAtomValue(activeServerConfigAtom)
	const isLocalServer = activeServer.type === "local"
	/**
	 * Artifacts button toggles the same `artifactPaneOpenAtom` that the
	 * ⌘./Ctrl+. shortcut uses, so opening from the sidebar and from the
	 * keyboard always lands on the same pane state — and the pane can stay
	 * overlaid on top of any route (chat, settings, automations) just like
	 * before.
	 */
	const setArtifactPaneOpen = useSetAtom(artifactPaneOpenAtom)
	const artifactCount = useAtomValue(artifactCountAtom)
	const canRevealInFinder = typeof window !== "undefined" && "infinitecode" in window
	const stableProjectOrderRef = useRef<Map<string, number>>(new Map())

	const visibleAgents = useMemo(() => agents.filter((agent) => !agent.parentId), [agents])
	const stableProjectOrder = useMemo(() => {
		const order = stableProjectOrderRef.current
		for (const project of projects) {
			if (!order.has(project.directory)) {
				order.set(project.directory, order.size)
			}
		}
		return order
	}, [projects])
	const projectSessionsByDirectory = useMemo(
		() => groupAgentsByProject(visibleAgents),
		[visibleAgents],
	)
	const sidebarItems = useMemo(
		() =>
			buildSidebarItems({
				projects,
				agents: visibleAgents,
				projectSessionsByDirectory,
				preferences,
				projectOrder: stableProjectOrder,
			}),
		[
			projects,
			visibleAgents,
			projectSessionsByDirectory,
			preferences,
			stableProjectOrder,
		],
	)

	const hasContent = sidebarItems.length > 0

	const handleNewChat = useCallback(() => {
		if (routeParams.projectSlug) {
			navigate({
				to: "/project/$projectSlug",
				params: { projectSlug: routeParams.projectSlug },
			})
			return
		}
		navigate({ to: "/" })
	}, [navigate, routeParams.projectSlug])

	const handleToggleProjectCollapsed = useCallback((directory: string) => {
		setCollapsedProjectDirs((previous) => {
			const next = new Set(previous)
			if (next.has(directory)) {
				next.delete(directory)
			} else {
				next.add(directory)
			}
			return next
		})
	}, [])

	const handleRevealInFinder = useCallback((directory: string) => {
		openInTarget(directory, "finder", false).catch((error) => {
			console.error("Failed to reveal project in Finder", error)
		})
	}, [])

	const requestRemoveProject = useCallback((project: SidebarProject) => {
		setFolderActionError(null)
		setRemoveTarget(project)
	}, [])

	const requestMissingFolderRemove = useCallback((project: SidebarProject) => {
		setFolderActionError(null)
		setMissingTarget(project)
	}, [])

	const handleFolderDialogOpenChange = useCallback((open: boolean) => {
		if (open) return
		setRemoveTarget(null)
		setMissingTarget(null)
		setFolderActionError(null)
	}, [])

	const confirmRemoveProject = useCallback(
		async (project: SidebarProject | null) => {
			if (!project || folderActionPending || !onRemoveProject) return
			setFolderActionPending(true)
			setFolderActionError(null)
			try {
				await onRemoveProject(project)
				setCollapsedProjectDirs((previous) => {
					if (!previous.has(project.directory)) return previous
					const next = new Set(previous)
					next.delete(project.directory)
					return next
				})
				setRemoveTarget(null)
				setMissingTarget(null)
			} catch (err) {
				const message = err instanceof Error ? err.message : "Failed to remove folder"
				setFolderActionError(message)
			} finally {
				setFolderActionPending(false)
			}
		},
		[folderActionPending, onRemoveProject],
	)

	return (
		<>
			<SidebarContent className="gap-0 bg-transparent px-0 pb-3">
				<div className="flex shrink-0 flex-col gap-1 px-3 pb-7">
					<img
						src="/logo.png"
						alt="InfiniteCode"
						className="mb-2 mt-2 h-12 w-auto object-contain"
					/>
					<TopActionRow
						icon={<PenLineIcon className={sidebarPrimaryIconClass} />}
						onClick={handleNewChat}
					>
						New chat
					</TopActionRow>
					<TopActionRow
						icon={<SearchIcon className={sidebarPrimaryIconClass} />}
						onClick={onOpenCommandPalette}
					>
						Search
					</TopActionRow>
					<TopActionRow
						icon={<BookmarkIcon className={sidebarPrimaryIconClass} />}
						aria-label={
							artifactCount > 0
								? `Open artifacts — ${artifactCount} saved`
								: "Open artifacts"
						}
						onClick={() => setArtifactPaneOpen((open) => !open)}
					>
						<span className="flex min-w-0 flex-1 items-center gap-1.5">
							<span>Artifacts</span>
							{artifactCount > 0 && (
								<span className="ml-auto rounded-full bg-muted-foreground/15 px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground/80">
									{artifactCount}
								</span>
							)}
						</span>
					</TopActionRow>
					{automationsEnabled && isLocalServer && (
						<TopActionRow
							icon={<Clock3Icon className={sidebarPrimaryIconClass} />}
							onClick={() => navigate({ to: "/automations" })}
						>
							Automations
						</TopActionRow>
					)}
				</div>

				<div className="group/projects-header flex h-9 shrink-0 items-center gap-1 px-4">
					<div className="flex min-w-0 flex-1 items-center gap-1 text-sm font-normal text-muted-foreground/60 transition-colors group-hover/projects-header:text-muted-foreground/75 group-focus-within/projects-header:text-muted-foreground/75">
						<span className="truncate">Projects</span>
					</div>
					<div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/projects-header:opacity-100 group-focus-within/projects-header:opacity-100">
						<SidebarMainMenu
							preferences={preferences}
							onPreferencesChange={setPreferences}
							onOpenCommandPalette={onOpenCommandPalette}
						/>
						<AddProjectMenu onCreateFolder={onCreateFolder} onAddExistingFolder={onAddProject} />
					</div>
				</div>

				{!hasContent && (
					<div className="flex flex-1 items-center justify-center p-6">
						<div className="flex max-w-[240px] flex-col items-center gap-3 text-center">
							<div className="flex flex-col gap-1">
								<p className="text-sm text-muted-foreground">No projects yet</p>
								<p className="text-xs text-muted-foreground/70">
									Add an existing project or create a new one to start.
								</p>
							</div>
							{onAddProject && (
								<button
									type="button"
									onClick={onAddProject}
									className="flex h-8 items-center gap-2 rounded-lg px-2 text-sm font-normal text-muted-foreground transition-colors hover:bg-black/[0.04] hover:text-sidebar-foreground focus-visible:bg-black/[0.04] focus-visible:text-sidebar-foreground focus-visible:outline-none dark:hover:bg-white/[0.06] dark:focus-visible:bg-white/[0.06]"
								>
									<FolderPlusIcon className={sidebarPrimaryIconClass} />
									<span>Use existing folder</span>
								</button>
							)}
						</div>
					</div>
				)}

				{hasContent && (
					<div className="scrollbar-comfort flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-3 pb-2">
						<div className="flex flex-col gap-1">
							{sidebarItems.map((item) => (
								<ProjectSection
									key={item.project.id}
									item={item}
									selectedProjectSlug={routeParams.projectSlug}
									selectedSessionId={selectedSessionId}
									isCollapsed={collapsedProjectDirs.has(item.project.directory)}
									onToggleCollapsed={handleToggleProjectCollapsed}
									onRemoveProject={requestRemoveProject}
									onMissingFolder={requestMissingFolderRemove}
									onRevealInFinder={canRevealInFinder ? handleRevealInFinder : undefined}
									sandboxDirs={parentToSandboxes.get(item.project.directory)}
									onRenameSession={onRenameSession}
									onDeleteSession={onDeleteSession}
									onForkSession={onForkSession}
								/>
							))}
						</div>
					</div>
				)}
			</SidebarContent>

			{/* Sidebar Ad banner — always-on rotating slot that earns
			    impressions on every page the sidebar is visible (chat, settings,
			    review, etc). Project names act as ambient context so the auction
			    sees something semantically meaningful even when no session is
			    open. 180-s rotation offset vs the chat surface's 60/90/120/150-s
			    offsets keeps auction bursts de-synced. Memoize the messages
			    array on [projects] so the hook's content-derived key stays
			    stable across re-renders. Sits just above <SidebarFooter> so
			    the Settings/copyright chrome stays anchored to the bottom.

			    px-3 + pb-2 wrapper matches the <SidebarFooter>'s gutter so
			    the compact horizontal pill lines up with the Settings +
			    copyright chrome width. Sidebar uses the default "pill"
			    variant inside Ad (matches the chat pills
			    so the shape is consistent across surfaces and takes
			    less vertical space inside the narrow sidebar gutter).
			    pb-2 instead of pb-3 tightens the bottom gap to the
			    <SidebarFooter> directly below — the pill's rounded
			    footprint flows into the footer chrome with a cleaner
			    8 px baseline instead of the prior 12 px gap. */}
			<div className="px-3 pb-2">
				<AdsterraAd placement="sidebar" />
			</div>

			<SidebarFooter className="gap-1 px-3 pt-0 pb-3">
				<AuthMenu />
				<button
					type="button"
					onClick={() => {
						if (selectedSessionId) {
							const scrollTop = appStore.get(sessionScrollTopFamily(selectedSessionId))
							if (scrollTop != null) {
								freezeSessionScroll(selectedSessionId, scrollTop)
							}
						}
						navigate({ to: "/settings" })
					}}
					className={cn(
						"flex h-8 w-full items-center gap-2.5 rounded-lg px-1.5 text-left text-sm font-normal text-muted-foreground transition-colors hover:bg-black/[0.04] hover:text-sidebar-foreground dark:hover:bg-white/[0.06]",
					)}
				>
					<SettingsIcon className={sidebarPrimaryIconClass} />
					<span className="truncate">Settings</span>
				</button>
				<p className="px-1 pt-1 text-[10px] text-muted-foreground/40">© 2026 AFS Agentics</p>
			</SidebarFooter>
			<FolderRemoveDialog
				project={removeTarget}
				open={!!removeTarget}
				pending={folderActionPending}
				error={folderActionError}
				onOpenChange={handleFolderDialogOpenChange}
				onConfirm={() => confirmRemoveProject(removeTarget)}
			/>
			<MissingFolderDialog
				project={missingTarget}
				open={!!missingTarget}
				pending={folderActionPending}
				error={folderActionError}
				onOpenChange={handleFolderDialogOpenChange}
				onConfirmRemove={() => confirmRemoveProject(missingTarget)}
			/>
		</>
	)
}


/**
 * AuthMenu — bottom-of-sidebar account surface.
 *
 * Mirrors the website's user-menu. Reads state from the `authAtom`
 * jotai store, which mirrors IPC-driven events from the desktop's
 * device-pairing flow (`auth:startConnect`, `auth:signOut`,
 * `connect:success`, `connect:signed_out`).
 */
function AuthMenu() {
	const [state, setState] = useAtom(authAtom)

	useEffect(() => {
		void loadAuthFromMain(setState)
		const offSuccess = window.infinitecode?.auth?.onConnectSuccess?.(() => {
			void loadAuthFromMain(setState)
		})
		const offSignedOut = window.infinitecode?.auth?.onSignedOut?.(() => {
			setState((prev) => ({ ...prev, status: "signed-out", user: null }))
		})
		const offFailed = window.infinitecode?.auth?.onConnectFailed?.((detail) => {
			setState((prev) => ({
				...prev,
				status: "error",
				errorMessage: detail?.reason ?? "Sign-in failed",
			}))
		})
		return () => {
			offSuccess?.()
			offSignedOut?.()
			offFailed?.()
		}
	}, [setState])

	const busy = state.status === "loading"

	if (state.status === "signed-in" && state.user) {
		const initials = (state.user.email ?? state.user.id ?? "?").slice(0, 2).toUpperCase()
		return (
			<div className="flex flex-col gap-1.5 px-1 pb-2">
				<div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-2 py-1.5">
					<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
						{initials}
					</span>
					<div className="min-w-0 flex-1 truncate text-xs">
						<div className="truncate font-medium text-sidebar-foreground">
							{state.user.email ?? "Signed in"}
						</div>
						<div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
							Free plan
						</div>
					</div>
				</div>
				<button
					type="button"
					disabled={busy}
					onClick={() => void signOutFromRenderer(setState)}
					className="flex h-7 w-full items-center justify-center gap-1.5 rounded-lg text-[11px] text-rose-400 transition-colors hover:bg-rose-500/10 disabled:opacity-50"
				>
					<LogOutIcon className={sidebarPrimaryIconClass} />
					{busy ? "Signing out…" : "Sign out of this desktop"}
				</button>
			</div>
		)
	}

	// Signed out / not configured / error / loading state.
	return (
		<div className="flex flex-col gap-1.5 px-1 pb-2">
			<button
				type="button"
				disabled={busy || state.configured === false}
				onClick={() => void startSignIn(setState)}
				className="flex h-8 w-full items-center gap-2 rounded-lg border border-border/60 bg-background px-2 text-left text-sm font-normal text-sidebar-foreground transition-colors hover:bg-black/[0.04] disabled:opacity-50 dark:hover:bg-white/[0.06]"
				title={
				state.configured === false
					? "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the desktop app's env."
					: "Sign in via tryinfinitecode.vercel.app"
				}
			>
				{busy ? (
					<>
						<Loader2Icon className={`${sidebarPrimaryIconClass} animate-spin`} />
						Opening browser…
					</>
				) : state.configured === false ? (
					<>
						<KeyRoundIcon className={sidebarPrimaryIconClass} />
						Auth unconfigured
					</>
				) : (
					<>
						<LogInIcon className={sidebarPrimaryIconClass} />
						Sign in to InfiniteCode
					</>
				)}
			</button>
			{state.status === "error" && state.errorMessage && (
				<p className="px-1 text-[10px] text-rose-400">{state.errorMessage}</p>
			)}
		</div>
	)
}