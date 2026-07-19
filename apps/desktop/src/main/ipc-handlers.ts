import { createHash } from "node:crypto";
import { Gravity } from "@gravity-ai/api";
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	nativeTheme,
	net,
	systemPreferences,
} from "electron";
import {
	acceptRun,
	archiveRun,
	createAutomation,
	deleteAutomation,
	getAutomation,
	listAutomations,
	listRuns,
	markRunRead,
	previewSchedule,
	runNow,
	updateAutomation,
} from "./automation";
import type {
	CreateAutomationInput,
	UpdateAutomationInput,
} from "./automation/types";
import {
	deleteCredential,
	getCredential,
	storeCredential,
} from "./credential-store";
import { createDesktopFolder, statDesktopFolders } from "./desktop-folders";
import { checkDesktopRuntime } from "./desktop-runtime-check";
import {
	applyChangesToLocal,
	applyDiffTextToLocal,
	checkout,
	commitAll,
	createBranch,
	getDiffStat,
	getGitRoot,
	getRemoteUrl,
	getStatus,
	listBranches,
	push,
	stashAndCheckout,
	stashPop,
} from "./git-service";
import {
	ensureServer,
	getAcpTrafficLogState,
	getServerUrl,
	isAcpConnected,
	requestAcp,
	respondAcp,
	restartServer,
	stopServer,
	subscribeAcp,
} from "./infinitecode-manager";
import { getResolvedChromeTier, resolveTitleBarOverlay } from "./liquid-glass";
import { createLogger } from "./logger";
import { readModelState, updateModelRecent } from "./model-state";
import { dismissNotification, updateBadgeCount } from "./notifications";
import type { MigrationProvider } from "./onboarding";
import {
	detectProviders,
	executeMigration,
	previewMigration,
	restoreMigrationBackup,
	scanProvider,
} from "./onboarding";
import {
	getOpenInTargets,
	openInTarget,
	setPreferredTarget,
} from "./open-in-targets";
import {
	getOpaqueWindows,
	getSettings,
	onSettingsChanged,
	updateSettings,
} from "./settings-store";
import { desktopTerminalManager } from "./terminal-manager";
import {
	checkForUpdates,
	downloadUpdate,
	getUpdateState,
	installUpdate,
	openReleasePage,
} from "./updater";
import {
	clearArtifacts,
	deleteArtifact,
	getArtifact,
	listArtifacts,
	storeArtifact,
	type ArtifactInput,
} from "./artifacts-store";
import {
	clearMemories,
	deleteMemory,
	getMemory,
	listMemories,
	memoryStats,
	searchMemories,
	storeMemory,
	updateMemory,
	type Memory,
	type MemoryInput,
} from "./memory-store";
import {
	isProviderId,
	runWebSearch,
	normalizeWebSearchLimit,
	normalizeWebSearchQuery,
	type WebSearchProviderId,
} from "./web-search-service";

const log = createLogger("ipc");

/** Read the opaque windows preference for use at window creation time. */
export { getOpaqueWindows as getOpaqueWindowsPref } from "./settings-store";

// Gravity singleton — reads `process.env.GRAVITY_API_KEY` via dotenv (loaded at the
// top of main/index.ts). `production: false` requests test ads by default until
// the dashboard is verified end-to-end. Module-scope so it's stable across any
// future re-registration of IPC handlers.
const gravityClient = new Gravity({
	apiKey: process.env.GRAVITY_API_KEY,
	production: true,
	timeoutMs: 5000,
});

// Gravity placement-id lookup. Each slot is a separate ad unit on the publisher
// dashboard (separate auction, separate impression counter). The renderer sends
// the slot string; this map resolves it to the dashboard's `placement_id`.
const PLACEMENT_ID_BY_SLOT: Record<string, string> = {
	above_response: "Chat-Response-Ad-Above",
	below_response: "Chat-Response-Ad-Below",
	inline_response: "Chat-Response-Ad-Inline",
	search_result: "Search-Result-Ad",
	bottom_page: "Bottom-MessageField-Ad",
	sidebar: "Sidebar-Ad",
	mid_response: "Chat-Response-Mid",
	mid_timeline: "Chat-Response-Mid-Timeline",
	startup_overlay: "Startup-Overlay-Ad",
};

// Map InfiniteCode renderer-facing slot names onto the upstream
// `@gravity-ai/api` Placement enum. The renderer sends the
// InfiniteCode-specific strings ("sidebar", etc.); the SDK accepts
// 11 canonical placements (above_response, below_response,
// inline_response, left_response, right_response, search_result,
// center_page, top_page, bottom_page, left_page, right_page),
// so we route our slots through the matching upstream placement
// while keeping the InfiniteCode-specific
// `placement_id` so the dashboard reports per-slot metrics correctly.
const SLOT_TO_UPSTREAM_PLACEMENT: Record<
	string,
	import("@gravity-ai/api").Placement
> = {
	above_response: "above_response",
	below_response: "below_response",
	inline_response: "inline_response",
	search_result: "search_result",
	bottom_page: "bottom_page",
	sidebar: "left_page",
	// mid_response routes upstream via inline_response since the canonical
	// enum doesn't have a mid-response slot; the InfiniteCode-specific
	// placement_id keeps dashboard reporting separate from inline_response.
	mid_response: "inline_response",
	// mid_timeline (ads between individual Timeline items) also routes
	// upstream via inline_response — same canonical-enum gap. The
	// InfiniteCode-specific `placement_id` keeps dashboard per-slot metrics
	// separate from inline_response + mid_response.
	//
	// Known limitation: four InfiniteCode-distinct slots (inline_response,
	// mid_response, mid_timeline, startup_overlay) all funnel upstream into
	// a single Gravity fill pool. Per-slot creative targeting isn't possible
	// today — they all share the same auction and creative rotation. The
	// `placement_id` keeps the dashboard reporting distinct (separate
	// impression counters, separate CTRs), but the actual creative served
	// is shared. Worth negotiating a dedicated enum entry with Gravity
	// support if/when per-slot creative separation becomes a publisher
	// priority.
	mid_timeline: "inline_response",
	// startup_overlay (full-screen loading splash shown above the "By AFS
	// Agentics" attribution line during cold boot) routes upstream through
	// center_page. Kept distinct on the dashboard so startup-overlay
	// impressions are reported separately from chat-context impressions.
	startup_overlay: "center_page",
};

// Gravity API requires `sessionId` in the request body and recommends a stable
// `user.userId` for matching/attribution. The renderer doesn't yet forward
// these from the chat session, so we synthesize them on the main side:
//   - sessionId: a sha256 prefix of the conversation's captured turns. Stable
//     across re-fetches of the same content, rotates when the conversation
//     evolves. Good enough as a per-thread correlator.
//   - userId: a single shared identifier for the desktop install until we wire
//     a real user/account layer.
const DESKTOP_USER_ID = "infinitecode-desktop-user";

function deriveSessionId(
	messages: { role: string; content: string }[],
): string {
	const preview = messages
		.slice(-4)
		.map((m) => `${m.role}:${m.content.slice(0, 80)}`)
		.join("|");
	return createHash("sha256").update(preview).digest("hex").slice(0, 32);
}

function updateTitleBarOverlay(): void {
	if (process.platform !== "win32" && process.platform !== "linux") return;
	const titleBarOverlay = resolveTitleBarOverlay(
		nativeTheme.shouldUseDarkColors,
	);
	for (const win of BrowserWindow.getAllWindows()) {
		win.setTitleBarOverlay(titleBarOverlay);
	}
}

// ============================================================
// Serialized fetch types — used to pass Request/Response over IPC
// ============================================================

interface SerializedRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string | null;
}

interface SerializedResponse {
	status: number;
	statusText: string;
	headers: Record<string, string>;
	body: string | null;
}

/**
 * Generic fetch proxy handler for the renderer process.
 *
 * The renderer serializes a Request into a plain object, sends it over IPC,
 * and the main process performs the actual HTTP request using `net.fetch()`
 * (Electron's network stack, which has no connection-per-origin limits).
 * The response is serialized back to the renderer.
 *
 * This bypasses Chromium's 6-connections-per-origin HTTP/1.1 limit, which
 * causes severe queueing when many parallel requests hit the InfiniteCode server.
 */
async function handleFetchProxy(
	_event: Electron.IpcMainInvokeEvent,
	req: SerializedRequest,
): Promise<SerializedResponse> {
	log.info("IPC fetch proxy →", { method: req.method, url: req.url });
	const start = Date.now();
	const response = await net.fetch(req.url, {
		method: req.method,
		headers: req.headers,
		body: req.body ?? undefined,
	});

	const body = await response.text();
	const headers: Record<string, string> = {};
	response.headers.forEach((value, key) => {
		headers[key] = value;
	});
	const durationMs = Date.now() - start;

	log.info("IPC fetch proxy ←", {
		method: req.method,
		url: req.url,
		status: response.status,
		bodyLength: body.length,
		durationMs,
	});

	return {
		status: response.status,
		statusText: response.statusText,
		headers,
		body,
	};
}

/**
 * Wraps an IPC handler to log errors before they propagate to the renderer.
 * Without this, errors thrown in handlers are silently serialized across IPC
 * and the main process log shows nothing.
 */
function withLogging<TArgs extends unknown[], TResult>(
	channel: string,
	handler: (...args: TArgs) => TResult | Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
	return async (...args: TArgs) => {
		const start = Date.now();
		try {
			const result = await handler(...args);
			const durationMs = Date.now() - start;
			if (durationMs > 500) {
				log.warn(`Handler "${channel}" slow`, { durationMs });
			}
			return result;
		} catch (err) {
			log.error(
				`Handler "${channel}" failed`,
				{ durationMs: Date.now() - start },
				err,
			);
			throw err;
		}
	};
}

/**
 * Registers all IPC handlers that the renderer can invoke via contextBridge.
 *
 * Each handler corresponds to an endpoint that was previously served by
 * the Bun + Hono server on port 3100. Now they run in-process in Electron's
 * main process, communicating via IPC instead of HTTP.
 */
export function registerIpcHandlers(): void {
	// --- App info ---

	ipcMain.handle("app:info", () => ({
		version: app.getVersion(),
		isDev: !app.isPackaged,
	}));

	// --- InfiniteCode server lifecycle ---

	ipcMain.handle(
		"infinitecode:ensure",
		withLogging("infinitecode:ensure", async () => {
			try {
				return await ensureServer();
			} catch (error) {
				// Cross-surface supersede: a separate infinitecode (CLI or
				// desktop window) already holds the lock. Translate to a
				// renderer-visible IPC event whose detail matches the copy we
				// show in `SessionSupersededBanner` — modelled on Freebuff's
				// "Another freebuff CLI took over this account" message in
				// `freebuff/cli-engine/src/hooks/helpers/send-message.ts:600-612`.
				const code = (error as { code?: unknown } | null)?.code;
				if (code === "SESSION_SUPERSEDED") {
					const detail = (error as {
						detail?: { otherPid: number; otherSurface: "cli" | "desktop"; lockPath: string };
					}).detail;
					if (detail) {
						for (const win of BrowserWindow.getAllWindows()) {
							win.webContents.send("session:superseded", detail);
						}
					}
				}
				throw error;
			}
		}),
	);

	ipcMain.handle("infinitecode:url", () => getServerUrl());

	ipcMain.handle(
		"infinitecode:stop",
		withLogging("infinitecode:stop", () => stopServer()),
	);

	ipcMain.handle(
		"infinitecode:restart",
		withLogging("infinitecode:restart", async () => await restartServer()),
	);

	ipcMain.handle(
		"acp:request",
		withLogging(
			"acp:request",
			async (
				_,
				request: { method: string; params?: unknown; directory?: string },
			) => await requestAcp(request.method, request.params, request.directory),
		),
	);

	ipcMain.handle(
		"acp:respond",
		withLogging(
			"acp:respond",
			async (_, response: { id: number | string; result: unknown }) =>
				await respondAcp(response.id, response.result),
		),
	);

	ipcMain.handle("acp:connected", () => isAcpConnected());

	ipcMain.handle("acp-traffic-log:state", () => getAcpTrafficLogState());

	subscribeAcp((event) => {
		for (const win of BrowserWindow.getAllWindows()) {
			win.webContents.send("acp:event", event);
		}
	});

	// --- Embedded terminal ---

	desktopTerminalManager.onData((id, data) => {
		for (const win of BrowserWindow.getAllWindows()) {
			win.webContents.send("terminal:data", { id, data });
		}
	});

	desktopTerminalManager.onExit((id, event) => {
		for (const win of BrowserWindow.getAllWindows()) {
			win.webContents.send("terminal:exit", { id, ...event });
		}
	});

	ipcMain.handle(
		"terminal:create",
		withLogging(
			"terminal:create",
			async (_, options: { cwd?: string; cols?: number; rows?: number }) =>
				await desktopTerminalManager.create(options),
		),
	);

	ipcMain.handle("terminal:close", (_, id: string) => {
		desktopTerminalManager.close(id);
	});

	ipcMain.on("terminal:write", (_, id: string, data: string) => {
		desktopTerminalManager.write(id, data);
	});

	ipcMain.on("terminal:resize", (_, id: string, cols: number, rows: number) => {
		desktopTerminalManager.resize(id, cols, rows);
	});

	// --- Model state ---

	ipcMain.handle(
		"model-state",
		withLogging("model-state", async () => await readModelState()),
	);

	ipcMain.handle(
		"model-state:update-recent",
		withLogging(
			"model-state:update-recent",
			async (_, model: { providerID: string; modelID: string }) =>
				await updateModelRecent(model),
		),
	);

	// --- Auto-updater ---

	ipcMain.handle("updater:state", () => getUpdateState());

	ipcMain.handle("updater:check", async () => await checkForUpdates());

	ipcMain.handle("updater:download", async () => await downloadUpdate());

	ipcMain.handle("updater:install", async () => await installUpdate());

	ipcMain.handle(
		"updater:open-release-page",
		async () => await openReleasePage(),
	);

	// --- Git operations ---

	ipcMain.handle(
		"git:branches",
		withLogging(
			"git:branches",
			async (_, directory: string) => await listBranches(directory),
		),
	);

	ipcMain.handle(
		"git:status",
		withLogging(
			"git:status",
			async (_, directory: string) => await getStatus(directory),
		),
	);

	ipcMain.handle(
		"git:checkout",
		withLogging(
			"git:checkout",
			async (_, directory: string, branch: string) =>
				await checkout(directory, branch),
		),
	);

	ipcMain.handle(
		"git:stash-and-checkout",
		withLogging(
			"git:stash-and-checkout",
			async (_, directory: string, branch: string) =>
				await stashAndCheckout(directory, branch),
		),
	);

	ipcMain.handle(
		"git:stash-pop",
		withLogging(
			"git:stash-pop",
			async (_, directory: string) => await stashPop(directory),
		),
	);

	ipcMain.handle(
		"git:diff-stat",
		withLogging(
			"git:diff-stat",
			async (_, directory: string) => await getDiffStat(directory),
		),
	);

	ipcMain.handle(
		"git:commit-all",
		withLogging(
			"git:commit-all",
			async (_, directory: string, message: string) =>
				await commitAll(directory, message),
		),
	);

	ipcMain.handle(
		"git:push",
		withLogging(
			"git:push",
			async (_, directory: string, remote?: string) =>
				await push(directory, remote),
		),
	);

	ipcMain.handle(
		"git:create-branch",
		withLogging(
			"git:create-branch",
			async (_, directory: string, branchName: string) =>
				await createBranch(directory, branchName),
		),
	);

	ipcMain.handle(
		"git:apply-to-local",
		withLogging(
			"git:apply-to-local",
			async (_, worktreeDir: string, localDir: string) =>
				await applyChangesToLocal(worktreeDir, localDir),
		),
	);

	ipcMain.handle(
		"git:apply-diff-text",
		withLogging(
			"git:apply-diff-text",
			async (_, localDir: string, diffText: string) =>
				await applyDiffTextToLocal(localDir, diffText),
		),
	);

	ipcMain.handle(
		"git:root",
		withLogging(
			"git:root",
			async (_, directory: string) => await getGitRoot(directory),
		),
	);

	ipcMain.handle(
		"git:remote-url",
		withLogging(
			"git:remote-url",
			async (_, directory: string, remote?: string) =>
				await getRemoteUrl(directory, remote),
		),
	);

	// --- Directory picker ---

	ipcMain.handle(
		"dialog:open-directory",
		withLogging("dialog:open-directory", async () => {
			const result = await dialog.showOpenDialog({
				properties: ["openDirectory"],
				title: "Select a project folder",
			});
			if (result.canceled || result.filePaths.length === 0) return null;
			return result.filePaths[0];
		}),
	);

	ipcMain.handle(
		"desktop-folders:stat",
		withLogging(
			"desktop-folders:stat",
			async (_, directories: string[]) => await statDesktopFolders(directories),
		),
	);

	ipcMain.handle(
		"desktop-folders:create",
		withLogging(
			"desktop-folders:create",
			async (_, input: { parentDirectory: string; name: string }) =>
				await createDesktopFolder(input),
		),
	);

	// --- Fetch proxy (bypasses Chromium connection limits) ---

	ipcMain.handle(
		"fetch:request",
		withLogging("fetch:request", handleFetchProxy),
	);

	// --- Open in external app ---

	ipcMain.handle("open-in:targets", () => getOpenInTargets());

	ipcMain.handle(
		"open-in:open",
		withLogging(
			"open-in:open",
			async (
				_,
				directory: string,
				targetId: string,
				persistPreferred?: boolean,
			) => await openInTarget(directory, targetId, { persistPreferred }),
		),
	);

	ipcMain.handle("open-in:set-preferred", (_, targetId: string) => {
		setPreferredTarget(targetId);
		return { success: true };
	});

	// --- Chrome tier (pull-based, avoids race with push-based "chrome-tier" event) ---

	ipcMain.handle("chrome-tier:get", () => getResolvedChromeTier());

	// --- Window preferences (opaque windows) ---

	ipcMain.handle("prefs:get-opaque-windows", () => {
		return getOpaqueWindows();
	});

	ipcMain.handle("prefs:set-opaque-windows", (_, value: boolean) => {
		updateSettings({ opaqueWindows: value });
		return { success: true };
	});

	ipcMain.handle("app:relaunch", () => {
		app.relaunch();
		app.exit(0);
	});

	// --- Notifications ---

	ipcMain.handle("notification:dismiss", (_, sessionId: string) => {
		dismissNotification(sessionId);
	});

	ipcMain.handle("notification:badge", (_, count: number) => {
		updateBadgeCount(count);
	});

	// --- Settings ---

	ipcMain.handle("settings:get", () => getSettings());

	ipcMain.handle(
		"settings:update",
		withLogging("settings:update", async (_, partial) => {
			const result = updateSettings(partial);
			// Performance / agent-behavior knobs only take effect on the next
			// server restart (env vars are read at server-process boot). If
			// the user changed them, ask the server to restart so the running
			// process picks up the new values. Network-only updates still get
			// the same restart treatment because `networkProxy` also reads
			// from env on spawn — consistent behavior across both knobs.
			if (
				partial &&
				typeof partial === "object" &&
				("performance" in partial || "servers" in partial)
			) {
				try {
					await restartServer();
				} catch (error) {
					log.warn("Failed to restart server after settings update", error);
				}
			}
			return result;
		}),
	);

	// --- Credential storage (safeStorage-backed) ---

	ipcMain.handle(
		"credential:store",
		withLogging("credential:store", (_, serverId: string, password: string) => {
			storeCredential(serverId, password);
		}),
	);

	ipcMain.handle("credential:get", (_, serverId: string) =>
		getCredential(serverId),
	);

	ipcMain.handle(
		"credential:delete",
		withLogging("credential:delete", (_, serverId: string) => {
			deleteCredential(serverId);
		}),
	);

	// --- Native theme (controls macOS glass tint color) ---

	ipcMain.handle("theme:set-native", (_, source: string) => {
		if (source === "light" || source === "dark") {
			nativeTheme.themeSource = source;
		} else {
			nativeTheme.themeSource = "system";
		}
		updateTitleBarOverlay();
	});

	nativeTheme.on("updated", updateTitleBarOverlay);

	// --- System accent color (macOS / Windows) ---

	ipcMain.handle("theme:accent-color", () => {
		try {
			return systemPreferences.getAccentColor();
		} catch {
			return null;
		}
	});

	// Broadcast accent color changes to all renderer windows
	systemPreferences.on("accent-color-changed", (_event, newColor) => {
		for (const win of BrowserWindow.getAllWindows()) {
			win.webContents.send("theme:accent-color-changed", newColor);
		}
	});

	// --- Onboarding ---

	ipcMain.handle(
		"onboarding:check-infinitecode",
		withLogging(
			"onboarding:check-infinitecode",
			async () => await checkDesktopRuntime(),
		),
	);

	ipcMain.handle(
		"onboarding:detect-providers",
		withLogging(
			"onboarding:detect-providers",
			async () => await detectProviders(),
		),
	);

	ipcMain.handle(
		"onboarding:scan-provider",
		withLogging(
			"onboarding:scan-provider",
			async (_, provider: MigrationProvider) => await scanProvider(provider),
		),
	);

	ipcMain.handle(
		"onboarding:preview-migration",
		withLogging(
			"onboarding:preview-migration",
			async (
				_,
				provider: MigrationProvider,
				scanResult: unknown,
				categories: string[],
			) => await previewMigration(provider, scanResult, categories),
		),
	);

	ipcMain.handle(
		"onboarding:execute-migration",
		withLogging(
			"onboarding:execute-migration",
			async (
				_,
				provider: MigrationProvider,
				scanResult: unknown,
				categories: string[],
			) => await executeMigration(provider, scanResult, categories),
		),
	);

	ipcMain.handle(
		"onboarding:restore-backup",
		withLogging(
			"onboarding:restore-backup",
			async () => await restoreMigrationBackup(),
		),
	);

	// --- Automations ---

	ipcMain.handle(
		"automation:list",
		withLogging("automation:list", () => listAutomations()),
	);

	ipcMain.handle(
		"automation:get",
		withLogging("automation:get", (_, id: string) => getAutomation(id)),
	);

	ipcMain.handle(
		"automation:create",
		withLogging(
			"automation:create",
			async (_, input: CreateAutomationInput) => {
				const result = await createAutomation(input);
				for (const win of BrowserWindow.getAllWindows()) {
					win.webContents.send("automation:runs-updated");
				}
				return result;
			},
		),
	);

	ipcMain.handle(
		"automation:update",
		withLogging(
			"automation:update",
			async (_, input: UpdateAutomationInput) => {
				const result = await updateAutomation(input);
				for (const win of BrowserWindow.getAllWindows()) {
					win.webContents.send("automation:runs-updated");
				}
				return result;
			},
		),
	);

	ipcMain.handle(
		"automation:delete",
		withLogging("automation:delete", async (_, id: string) => {
			const result = await deleteAutomation(id);
			for (const win of BrowserWindow.getAllWindows()) {
				win.webContents.send("automation:runs-updated");
			}
			return result;
		}),
	);

	ipcMain.handle(
		"automation:run-now",
		withLogging("automation:run-now", async (_, id: string) => {
			// runNow is fire-and-forget: it returns immediately after validating
			// the automation exists. Execution happens in the background, and
			// broadcastRunsUpdated() is called from within executeAutomation.
			return runNow(id);
		}),
	);

	ipcMain.handle(
		"automation:list-runs",
		withLogging("automation:list-runs", (_, automationId?: string) =>
			listRuns(automationId),
		),
	);

	ipcMain.handle(
		"automation:archive-run",
		withLogging("automation:archive-run", async (_, runId: string) => {
			const result = await archiveRun(runId);
			for (const win of BrowserWindow.getAllWindows()) {
				win.webContents.send("automation:runs-updated");
			}
			return result;
		}),
	);

	ipcMain.handle(
		"automation:accept-run",
		withLogging("automation:accept-run", async (_, runId: string) => {
			const result = await acceptRun(runId);
			for (const win of BrowserWindow.getAllWindows()) {
				win.webContents.send("automation:runs-updated");
			}
			return result;
		}),
	);

	ipcMain.handle(
		"automation:mark-run-read",
		withLogging("automation:mark-run-read", async (_, runId: string) => {
			const result = await markRunRead(runId);
			for (const win of BrowserWindow.getAllWindows()) {
				win.webContents.send("automation:runs-updated");
			}
			return result;
		}),
	);

	ipcMain.handle(
		"automation:preview-schedule",
		withLogging(
			"automation:preview-schedule",
			(_, rrule: string, timezone: string) => previewSchedule(rrule, timezone),
		),
	);

	// --- Gravity Ads --
	// Each ad slot is a separate auction on the Gravity dashboard. The slots
	// we use:
	//   - "above_response" (id: "Chat-Response-Ad-Above") — pill above each AI
	//     response, earns an impression per scroll-in per turn.
	//   - "below_response" (id: "main") — pill below each AI response, earns
	//     an impression per scroll-in per turn.
	//   - "inline_response" (id: "Chat-Response-Ad-Inline") — woven between
	//     work section and final response.
	//   - "search_result" (id: "Search-Result-Ad") — appears inline among
	//     `@`-reference search results in the mention popover, styled like
	//     a result entry.
	//   - "bottom_page" (id: "Bottom-MessageField-Ad") — sticky pill rendered
	//     above the message input, always visible, auto-rotates on a timer
	//     so consecutive fresh ads keep firing impressions.
	// Per Gravity's docs, reusing the same placement string across every
	// <GravityAd /> render is correct: each new render = new ad + fresh IO
	// observer = fresh impression. Height/layout do not affect counting.

	ipcMain.handle(
		"gravity:get-ads",
		withLogging(
			"gravity:get-ads",
			async (
				_,
				messages: { role: string; content: string }[],
				placement:
					| "above_response"
					| "below_response"
					| "inline_response"
					| "search_result"
					| "bottom_page"
					| "sidebar"
					| "mid_response"
				| "mid_timeline" = "below_response",
			) => {
				if (!Array.isArray(messages) || messages.length === 0) {
					return [];
				}
				const placement_id =
					PLACEMENT_ID_BY_SLOT[placement] ??
					PLACEMENT_ID_BY_SLOT.below_response;
				// Synthesize the IncomingAdRequest shape the SDK expects. sessionId
				// and user.userId are required by the upstream Gravity API; we
				// derive them here until the renderer forwards real ones.
				const req = {
					body: {
						messages,
						gravity_context: {
							sessionId: deriveSessionId(messages),
							user: { id: DESKTOP_USER_ID, userId: DESKTOP_USER_ID },
							device: {},
						},
					},
					headers: {},
				};
			const upstreamPlacement =
				SLOT_TO_UPSTREAM_PLACEMENT[placement] ??
				SLOT_TO_UPSTREAM_PLACEMENT.below_response;
			const placements: import("@gravity-ai/api").PlacementObject[] = [
				{ placement: upstreamPlacement, placement_id },
			];
				const result = await gravityClient.getAds(
					req,
					messages as import("@gravity-ai/api").MessageObject[],
					placements,
				);
				// Log every dimension of the response so silent failures are visible.
				log.info("[gravity] response", {
					placement,
					placement_id,
					adsCount: result.ads.length,
					status: result.status,
					elapsed: result.elapsed,
					error: result.error ?? null,
					firstBrand: result.ads[0]?.brandName ?? null,
				});
				if (result.error) {
					log.warn("[gravity] upstream error field", {
						placement,
						placement_id,
						error: result.error,
						status: result.status,
					});
				}
				return result.ads;
			},
		),
	);

	// --- Settings push channel (main -> renderer) ---
	// Notify all renderer windows when settings change so they can update reactively.

	onSettingsChanged((settings) => {
		for (const win of BrowserWindow.getAllWindows()) {
			win.webContents.send("settings:changed", settings);
		}
	});

	// --- Artifact store ---
	// Persistent right-pane of saved tool outputs / file snapshots / fetched
	// content. JSON file at `app.getPath('userData')/artifacts.json` with FIFO
	// eviction. Broadcasts `artifact:changed` on every mutation so all windows
	// refresh their lists without polling.

	ipcMain.handle(
		"artifact:list",
		withLogging("artifact:list", () => listArtifacts()),
	);

	ipcMain.handle(
		"artifact:get",
		withLogging("artifact:get", (_, id: string) => getArtifact(id)),
	);

	ipcMain.handle(
		"artifact:store",
		withLogging(
			"artifact:store",
			async (_, input: ArtifactInput) => {
				const result = storeArtifact(input);
				for (const win of BrowserWindow.getAllWindows()) {
					win.webContents.send("artifact:changed");
				}
				return result;
			},
		),
	);

	ipcMain.handle(
		"artifact:delete",
		withLogging(
			"artifact:delete",
			async (_, id: string) => {
				const ok = deleteArtifact(id);
				for (const win of BrowserWindow.getAllWindows()) {
					win.webContents.send("artifact:changed");
				}
				return ok;
			},
		),
	);

	ipcMain.handle(
		"artifact:clear",
		withLogging(
			"artifact:clear",
			async () => {
				clearArtifacts();
				for (const win of BrowserWindow.getAllWindows()) {
					win.webContents.send("artifact:changed");
				}
			},
		),
	);

	// --- Long-term memory store ---
	// Persistent facts/preferences that survive across sessions. JSON file at
	// `app.getPath('userData')/memories.json`. Search is a simple tf + tag
	// overlap score with a recency tiebreaker (good enough for v1; embeddings
	// can replace this later). Broadcasts `memory:changed` on mutations.

	ipcMain.handle(
		"memory:list",
		withLogging("memory:list", () => listMemories()),
	);

	ipcMain.handle(
		"memory:get",
		withLogging("memory:get", (_, id: string) => getMemory(id)),
	);

	ipcMain.handle(
		"memory:store",
		withLogging(
			"memory:store",
			async (_, input: MemoryInput) => {
				const result = storeMemory(input);
				for (const win of BrowserWindow.getAllWindows()) {
					win.webContents.send("memory:changed");
				}
				return result;
			},
		),
	);

	ipcMain.handle(
		"memory:update",
		withLogging(
			"memory:update",
			async (
				_,
				id: string,
				patch: Partial<Pick<Memory, "content" | "category" | "tags">>,
			) => {
				const result = updateMemory(id, patch);
				if (result) {
					for (const win of BrowserWindow.getAllWindows()) {
						win.webContents.send("memory:changed");
					}
				}
				return result;
			},
		),
	);

	ipcMain.handle(
		"memory:delete",
		withLogging(
			"memory:delete",
			async (_, id: string) => {
				const ok = deleteMemory(id);
				for (const win of BrowserWindow.getAllWindows()) {
					win.webContents.send("memory:changed");
				}
				return ok;
			},
		),
	);

	ipcMain.handle(
		"memory:search",
		withLogging(
			"memory:search",
			(_, query: string, limit?: number) => searchMemories(query, limit ?? 5),
		),
	);

	ipcMain.handle(
		"memory:clear",
		withLogging(
			"memory:clear",
			async () => {
				clearMemories();
				for (const win of BrowserWindow.getAllWindows()) {
					win.webContents.send("memory:changed");
				}
			},
		),
	);

	ipcMain.handle(
		"memory:stats",
		withLogging("memory:stats", () => memoryStats()),
	);

	// --- Web search ---

	ipcMain.handle(
		"web-search:query",
		withLogging(
			"web-search:query",
			async (_: unknown, provider: string, query: string, limit?: number) => {
				if (!isProviderId(provider)) {
					return {
						ok: false,
						reason: "unsupported_provider",
						message: "Unsupported web search provider.",
					}
				}
				const normalizedQuery = normalizeWebSearchQuery(query)
				if (normalizedQuery === null) {
					return {
						ok: false,
						reason: "invalid_query",
						message: "Enter a valid search query.",
					}
				}
				const normalizedLimit = normalizeWebSearchLimit(limit)
				const settings = getSettings()
				if (!settings.webSearch?.enabled) {
					return {
						ok: false,
						reason: "not_configured",
						message:
							"Web search is disabled. Enable it under Settings → Web Search.",
					}
				}
				return runWebSearch(
					provider as WebSearchProviderId,
					normalizedQuery,
					normalizedLimit,
					{
						braveApiKey: settings.webSearch.braveApiKey ?? "",
						tavilyApiKey: settings.webSearch.tavilyApiKey ?? "",
					},
				)
			},
		),
	)

	ipcMain.handle(
		"web-search:test",
		withLogging(
			"web-search:test",
			async (_: unknown, provider: string) => {
				if (!isProviderId(provider)) {
					return {
						ok: false,
						reason: "unsupported_provider",
						message: "Unsupported web search provider.",
					}
				}
				const settings = getSettings()
				return runWebSearch(
					provider as WebSearchProviderId,
					"test query",
					3,
					{
						braveApiKey: settings.webSearch.braveApiKey ?? "",
						tavilyApiKey: settings.webSearch.tavilyApiKey ?? "",
					},
				)
			},
		),
	)

	// --- Voice / STT capability probe ---

	ipcMain.handle("voice:capability", () => {
		// Renderer-side Web Speech API lives in the renderer process, not the
		// main process. We return a permissive "no opinion" probe here — the
		// renderer does the actual feature detection via window.SpeechRecognition
		// before mounting the mic button.
		return { available: true, vendor: null, microphoneSupported: true }
	})
}
