/**
 * Unified backend service layer.
 *
 * Detects whether we're running inside Electron (preload bridge available)
 * or in a plain browser (Bun + Hono server on port 3100). All hooks import
 * from here instead of `infinitecode-server.ts` directly.
 *
 * In Electron mode, calls go through IPC to the main process.
 * In browser mode, calls go through HTTP to the InfiniteCode server.
 */

import type {
	Automation,
	AutomationRun,
	CreateAutomationInput,
	CreateDesktopFolderInput,
	CreateDesktopFolderResult,
	DesktopFolderStat,
	GitApplyResult,
	GitBranchInfo,
	GitCheckoutResult,
	GitCommitResult,
	GitDiffStat,
	GitPushResult,
	GitStashResult,
	GitStatusInfo,
	ModelState,
	OpenInTargetsResult,
	UpdateAutomationInput,
} from "../../preload/api"
import { createLogger } from "../lib/logger"

const log = createLogger("backend")

// ============================================================
// Runtime detection
// ============================================================

/**
 * Returns true when running inside Electron (preload bridge is available).
 * The `infinitecode` object is exposed via `contextBridge.exposeInMainWorld`.
 */
export const isElectron = typeof window !== "undefined" && "infinitecode" in window

// ============================================================
// Backend API — same signatures regardless of runtime
// ============================================================

/**
 * Ensures the single local InfiniteCode stdio runtime is running and returns its
 * compatibility URL.
 */
export async function fetchInfiniteCodeUrl(): Promise<{ url: string }> {
	log.debug("fetchInfiniteCodeUrl", { via: isElectron ? "ipc" : "http" })
	try {
		if (isElectron) {
			const info = await window.infinitecode.ensureInfiniteCode()
			log.info("InfiniteCode server URL resolved", { url: info.url })
			return { url: info.url }
		}
		const { fetchInfiniteCodeUrl: httpFetch } = await import("./infinitecode-server")
		const result = await httpFetch()
		log.info("InfiniteCode server URL resolved", { url: result.url })
		return result
	} catch (err) {
		log.error("fetchInfiniteCodeUrl failed", err)
		throw err
	}
}

/**
 * Resolve the connection URL for the local server config.
 */
export async function resolveServerUrl(
	server: import("../../preload/api").ServerConfig,
): Promise<string> {
	if (server.type !== "local") throw new Error("Remote InfiniteCode servers are disabled in this build")
	const { url } = await fetchInfiniteCodeUrl()
	return url
}

/**
 * The local stdio transport does not use HTTP auth.
 */
export async function resolveAuthHeader(
	_server: import("../../preload/api").ServerConfig,
): Promise<string | null> {
	return null
}

/**
 * Fetches the InfiniteCode model state (recent models, favorites, variants)
 * from ~/.local/state/infinitecode/model.json.
 */
export async function fetchModelState(): Promise<ModelState> {
	if (isElectron) {
		return window.infinitecode.getModelState()
	}
	const { fetchModelState: httpFetch } = await import("./infinitecode-server")
	return httpFetch() as unknown as Promise<ModelState>
}

/**
 * Adds a model to the front of the recent list in model.json.
 * Matches the TUI's `model.set(model, { recent: true })` behavior.
 * Returns the updated model state.
 */
export async function updateModelRecent(model: {
	providerID: string
	modelID: string
}): Promise<ModelState> {
	if (isElectron) {
		return window.infinitecode.updateModelRecent(model)
	}
	const { updateModelRecent: httpUpdate } = await import("./infinitecode-server")
	return httpUpdate(model) as unknown as Promise<ModelState>
}

/**
 * Checks if the backend is available.
 * In Electron, always returns true (main process is always there).
 * In browser, pings the InfiniteCode HTTP server.
 */
export async function checkBackendHealth(): Promise<boolean> {
	if (isElectron) {
		return true
	}
	const { checkServerHealth } = await import("./infinitecode-server")
	return checkServerHealth()
}

// ============================================================
// Directory picker — Electron-only (native dialog via IPC)
// ============================================================

/**
 * Opens a native folder picker dialog.
 * Returns the selected directory path, or null if cancelled.
 */
export async function pickDirectory(): Promise<string | null> {
	if (isElectron) {
		return window.infinitecode.pickDirectory()
	}
	throw new Error("Directory picker is only available in Electron mode")
}

export async function statDesktopFolders(directories: string[]): Promise<DesktopFolderStat[]> {
	if (isElectron && window.infinitecode.desktopFolders?.stat) {
		return window.infinitecode.desktopFolders.stat(directories)
	}
	return directories.map((directory) => ({ directory, status: "available" }))
}

export async function createDesktopFolder(
	input: CreateDesktopFolderInput,
): Promise<CreateDesktopFolderResult> {
	if (isElectron && window.infinitecode.desktopFolders?.create) {
		return window.infinitecode.desktopFolders.create(input)
	}
	throw new Error("Folder creation requires the updated desktop bridge. Restart InfiniteCode Desktop and try again.")
}

// ============================================================
// Git operations — Electron-only (main process via IPC)
// In browser mode, these are not available (InfiniteCode server
// doesn't expose git checkout/stash APIs).
// ============================================================

/**
 * Lists all local and remote branches for a project directory.
 */
export async function fetchGitBranches(directory: string): Promise<GitBranchInfo> {
	if (isElectron) {
		return window.infinitecode.git.listBranches(directory)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Gets the working tree status (clean/dirty, file counts).
 */
export async function fetchGitStatus(directory: string): Promise<GitStatusInfo> {
	if (isElectron) {
		return window.infinitecode.git.getStatus(directory)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Checks out a branch. Fails if there are uncommitted changes
 * that would conflict.
 */
export async function gitCheckout(directory: string, branch: string): Promise<GitCheckoutResult> {
	if (isElectron) {
		return window.infinitecode.git.checkout(directory, branch)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Stashes uncommitted changes, then checks out the target branch.
 */
export async function gitStashAndCheckout(
	directory: string,
	branch: string,
): Promise<GitStashResult> {
	if (isElectron) {
		return window.infinitecode.git.stashAndCheckout(directory, branch)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Pops the most recent stash entry.
 */
export async function gitStashPop(directory: string): Promise<GitStashResult> {
	if (isElectron) {
		return window.infinitecode.git.stashPop(directory)
	}
	throw new Error("Git operations are only available in Electron mode")
}

// ============================================================
// Worktree operations — InfiniteCode API only
// ============================================================

export type { WorktreeResult } from "./worktree-service"
export {
	createWorktree as createWorktreeViaApi,
	listWorktrees as listWorktreesViaApi,
	removeWorktree as removeWorktreeViaApi,
	resetWorktree,
} from "./worktree-service"

/**
 * Gets the git repository root for a directory.
 */
export async function getGitRoot(directory: string): Promise<string | null> {
	if (isElectron) {
		return window.infinitecode.git.getRoot(directory)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Gets a summary of uncommitted changes in a directory.
 */
export async function fetchDiffStat(directory: string): Promise<GitDiffStat> {
	if (isElectron) {
		return window.infinitecode.git.diffStat(directory)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Commits all changes (staged + unstaged) with the given message.
 */
export async function gitCommitAll(directory: string, message: string): Promise<GitCommitResult> {
	if (isElectron) {
		return window.infinitecode.git.commitAll(directory, message)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Pushes the current branch to the remote.
 */
export async function gitPush(directory: string, remote?: string): Promise<GitPushResult> {
	if (isElectron) {
		return window.infinitecode.git.push(directory, remote)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Creates a new branch on the given directory.
 */
export async function gitCreateBranch(
	directory: string,
	branchName: string,
): Promise<GitCheckoutResult> {
	if (isElectron) {
		return window.infinitecode.git.createBranch(directory, branchName)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Gets the remote URL for a repository (defaults to "origin").
 */
export async function getGitRemoteUrl(directory: string, remote?: string): Promise<string | null> {
	if (isElectron) {
		return window.infinitecode.git.getRemoteUrl(directory, remote)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Applies uncommitted changes from a worktree to the local checkout as a patch.
 */
export async function gitApplyToLocal(
	worktreeDir: string,
	localDir: string,
): Promise<GitApplyResult> {
	if (isElectron) {
		return window.infinitecode.git.applyToLocal(worktreeDir, localDir)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Applies a raw diff string to a local directory using `git apply`.
 * Used for remote worktree apply-to-local, where the diff is fetched
 * from the InfiniteCode session.diff API rather than from a local worktree.
 */
export async function gitApplyDiffText(
	localDir: string,
	diffText: string,
): Promise<GitApplyResult> {
	if (isElectron) {
		return window.infinitecode.git.applyDiffText(localDir, diffText)
	}
	throw new Error("Git operations are only available in Electron mode")
}

// ============================================================
// Open in external app — Electron-only (main process via IPC)
// ============================================================

/**
 * Gets the list of available "Open in" targets (editors, terminals, file managers)
 * with their availability status and the user's preferred target.
 */
export async function fetchOpenInTargets(): Promise<OpenInTargetsResult> {
	if (isElectron) {
		return window.infinitecode.openIn.getTargets()
	}
	throw new Error("Open-in targets are only available in Electron mode")
}

/**
 * Opens a directory in the specified target application.
 * Optionally persists the target as the user's preferred choice.
 */
export async function openInTarget(
	directory: string,
	targetId: string,
	persistPreferred?: boolean,
): Promise<void> {
	if (isElectron) {
		return window.infinitecode.openIn.open(directory, targetId, persistPreferred)
	}
	throw new Error("Open-in targets are only available in Electron mode")
}

/**
 * Sets the user's preferred "Open in" target without opening anything.
 */
export async function setOpenInPreferred(targetId: string): Promise<{ success: boolean }> {
	if (isElectron) {
		return window.infinitecode.openIn.setPreferred(targetId)
	}
	throw new Error("Open-in targets are only available in Electron mode")
}

// ============================================================
// Automations — Electron-only
// ============================================================

export async function fetchAutomations(): Promise<Automation[]> {
	if (isElectron) {
		return window.infinitecode.automation.list()
	}
	throw new Error("Automations are only available in Electron mode")
}

export async function fetchAutomation(id: string): Promise<Automation | null> {
	if (isElectron) {
		return window.infinitecode.automation.get(id)
	}
	throw new Error("Automations are only available in Electron mode")
}

export async function createAutomation(input: CreateAutomationInput): Promise<Automation> {
	if (isElectron) {
		return window.infinitecode.automation.create(input)
	}
	throw new Error("Automations are only available in Electron mode")
}

export async function updateAutomation(input: UpdateAutomationInput): Promise<Automation | null> {
	if (isElectron) {
		return window.infinitecode.automation.update(input)
	}
	throw new Error("Automations are only available in Electron mode")
}

export async function deleteAutomation(id: string): Promise<boolean> {
	if (isElectron) {
		return window.infinitecode.automation.delete(id)
	}
	throw new Error("Automations are only available in Electron mode")
}

export async function runAutomationNow(id: string): Promise<boolean> {
	if (isElectron) {
		return window.infinitecode.automation.runNow(id)
	}
	throw new Error("Automations are only available in Electron mode")
}

export async function fetchAutomationRuns(automationId?: string): Promise<AutomationRun[]> {
	if (isElectron) {
		return window.infinitecode.automation.listRuns(automationId)
	}
	throw new Error("Automations are only available in Electron mode")
}

export async function archiveAutomationRun(runId: string): Promise<boolean> {
	if (isElectron) {
		return window.infinitecode.automation.archiveRun(runId)
	}
	throw new Error("Automations are only available in Electron mode")
}

export async function acceptAutomationRun(runId: string): Promise<boolean> {
	if (isElectron) {
		return window.infinitecode.automation.acceptRun(runId)
	}
	throw new Error("Automations are only available in Electron mode")
}

export async function markAutomationRunRead(runId: string): Promise<boolean> {
	if (isElectron) {
		return window.infinitecode.automation.markRunRead(runId)
	}
	throw new Error("Automations are only available in Electron mode")
}

export async function previewAutomationSchedule(
	rrule: string,
	timezone: string,
): Promise<string[]> {
	if (isElectron) {
		return window.infinitecode.automation.previewSchedule(rrule, timezone)
	}
	throw new Error("Automations are only available in Electron mode")
}
