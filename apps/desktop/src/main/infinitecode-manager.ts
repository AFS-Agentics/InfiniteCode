import type { AcpTransport, AcpTransportEvent, AcpTransportListener, JsonRpcId } from "./acp-stdio-client"
import {
	INFINITECODE_COMPACT_STRATEGY_ENV,
	INFINITECODE_COMPACT_THRESHOLD_ENV,
	INFINITECODE_SELF_VERIFY_ENV,
	INFINITECODE_SUGGEST_FOLLOWUPS_ENV,
} from "./acp-stdio-client"
import { app } from "electron"
import {
	INFINITECODE_HOME_ENV,
	PROTOCOL_TRACE_ENV,
	PROTOCOL_TRACE_FILE_ENV,
	createAcpTrafficLoggerFromEnv,
	type AcpTrafficLogger,
	type AcpTrafficLogState,
} from "./acp-traffic-log"
import { StdioAcpClient } from "./acp-stdio-client"
import { resolveProgram } from "./infinitecode-program"
import {
	acquire as acquireDesktopSessionLock,
	release as releaseDesktopSessionLock,
} from "./session-lock"
import { createLogger } from "./logger"
import { startNotificationWatcher, stopNotificationWatcher } from "./notification-watcher"
import { getSettings } from "./settings-store"
import { waitForEnv } from "./shell-env"

const log = createLogger("infinitecode-manager")

const STDIO_URL = "stdio://local"
const acpTrafficLogStartupEnv = {
	[INFINITECODE_HOME_ENV]: process.env[INFINITECODE_HOME_ENV],
	[PROTOCOL_TRACE_ENV]: process.env[PROTOCOL_TRACE_ENV],
	[PROTOCOL_TRACE_FILE_ENV]: process.env[PROTOCOL_TRACE_FILE_ENV],
}

export interface InfiniteCodeServer {
	url: string
	transport: "stdio"
	pid: number | null
	managed: boolean
}

let stdioClient: StdioAcpClient | null = null
let server: InfiniteCodeServer | null = null
let initializing: Promise<InfiniteCodeServer> | null = null
let acpTrafficLogger: AcpTrafficLogger | null = null
const serverReadyListeners = new Set<() => void>()

export async function ensureServer(): Promise<InfiniteCodeServer> {
	if (server && stdioClient?.connected()) return server
	if (initializing) return initializing

	initializing = startServer().finally(() => {
		initializing = null
	})
	return initializing
}

export function getServerUrl(): string | null {
	return server?.url ?? null
}

export function onServerReady(listener: () => void): () => void {
	serverReadyListeners.add(listener)
	if (server && stdioClient?.connected()) {
		queueMicrotask(() => {
			if (serverReadyListeners.has(listener) && server && stdioClient?.connected()) {
				listener()
			}
		})
	}
	return () => {
		serverReadyListeners.delete(listener)
	}
}

export function stopServer(): boolean {
	stopNotificationWatcher()
	const hadClient = stdioClient !== null
	stdioClient?.stop()
	stdioClient = null
	server = null
	// Release the cross-process session lock last, after the stdio client has
	// actually torn down. We swallow the "already gone" case inside release()
	// so a benign raced delete does not wedge app quit on Windows.
	try {
		releaseDesktopSessionLock()
	} catch (error) {
		log.warn("Failed to release session lock", error)
	}
	return hadClient
}

export async function restartServer(): Promise<InfiniteCodeServer> {
	stopServer()
	return ensureServer()
}

export async function requestAcp(
	method: string,
	params?: unknown,
	directory?: string,
): Promise<unknown> {
	const client = await ensureClient()
	return client.request(method, params, directory)
}

export async function respondAcp(id: JsonRpcId, result: unknown): Promise<void> {
	const client = await ensureClient()
	await client.respond(id, result)
}

export function subscribeAcp(listener: AcpTransportListener): () => void {
	const client = getOrCreateClient()
	return client.subscribe(listener)
}

export function isAcpConnected(): boolean {
	return stdioClient?.connected() ?? false
}

const sharedAcpTransport: AcpTransport = {
	request: requestAcp,
	respond: respondAcp,
	subscribe: subscribeAcp,
	connected: isAcpConnected,
	pid: () => stdioClient?.pid() ?? null,
	stop: stopServer,
}

export function getAcpTransport(): AcpTransport {
	return sharedAcpTransport
}

export function getAcpTrafficLogState(): AcpTrafficLogState {
	return getAcpTrafficLogger().getState()
}

async function startServer(): Promise<InfiniteCodeServer> {
	await waitForEnv()
	// Cross-surface supersede check: takes the cross-process session lock.
	// If a CLI or another desktop window already holds it, this throws
	// SessionSupersededError; the IPC `infinitecode:ensure` handler catches
	// and broadcasts `session:superseded` to the renderer so the supersede
	// banner copy from Freebuff's `cli-engine/src/hooks/helpers/send-message.ts:600-612`
	// is visible immediately.
	acquireDesktopSessionLock("desktop", null)
	const client = getOrCreateClient()
	client.start()

	await initialize(client)

	server = {
		url: STDIO_URL,
		transport: "stdio",
		pid: client.pid(),
		managed: true,
	}
	startNotificationWatcher(getAcpTransport())
	notifyServerReady()
	log.info("InfiniteCode ACP stdio server ready", { pid: server.pid })
	return server
}

async function ensureClient(): Promise<StdioAcpClient> {
	await ensureServer()
	return getOrCreateClient()
}function getOrCreateClient(): StdioAcpClient {
	if (!stdioClient) {
		const program = resolveProgram({
			appPath: app.getAppPath(),
			env: process.env,
			isPackaged: app.isPackaged,
			resourcesPath: process.resourcesPath,
		})
		stdioClient = new StdioAcpClient({
			program,
			networkProxy: getSettings().servers.networkProxy,
			trafficLogger: getAcpTrafficLogger(),
			env: buildAgentBehaviorEnv(getSettings().performance),
		})
		stdioClient.subscribe(handleTransportEvent)
	}
	return stdioClient
}

/**
 * Builds the env-var overlay forwarded to the spawned Rust server so the
 * running process picks up the user's performance / agent-behavior knobs.
 *
 * Reads from `AppSettings.performance` (which lives in
 * `apps/desktop/src/shared/app-settings.ts`). The Rust server reads these
 * env vars in `infinitecode/crates/config/src/app.rs` via
 * `apply_agent_behavior_env_overrides` and layers them on top of the
 * user/project TOML + CLI overrides at load time.
 *
 * Keys are exported from `acp-stdio-client.ts` as
 * `INFINITECODE_*_ENV` constants so the names stay in lockstep between
 * Desktop and Rust.
 */
function buildAgentBehaviorEnv(performance: ReturnType<typeof getSettings>["performance"]): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {}
	if (performance?.selfVerify) {
		env[INFINITECODE_SELF_VERIFY_ENV] = "1"
	}
	if (performance && performance.suggestFollowups === false) {
		// Default-on: only forward "0" when the user has explicitly turned
		// the chips off. Leaving this unset lets the Rust side keep its
		// own default of true.
		env[INFINITECODE_SUGGEST_FOLLOWUPS_ENV] = "0"
	}
	if (performance?.compactStrategy && performance.compactStrategy !== "auto") {
		env[INFINITECODE_COMPACT_STRATEGY_ENV] = performance.compactStrategy
		// Intentionally omit INFINITECODE_COMPACT_THRESHOLD here — the
		// threshold is only consulted when compactStrategy === "auto".
		// Forwarding it for non-auto strategies would mislead readers into
		// thinking it takes effect for Conservative/Aggressive/Off.
	} else if (
		typeof performance?.compactThresholdPercent === "number" &&
		performance.compactStrategy === "auto"
	) {
		env[INFINITECODE_COMPACT_THRESHOLD_ENV] = String(performance.compactThresholdPercent)
	}
	return env
}

function getAcpTrafficLogger(): AcpTrafficLogger {
	if (!acpTrafficLogger) {
		acpTrafficLogger = createAcpTrafficLoggerFromEnv({
			env: acpTrafficLogStartupEnv,
		})
	}
	return acpTrafficLogger
}

function handleTransportEvent(event: AcpTransportEvent): void {
	if (event.type === "closed") {
		log.warn("InfiniteCode ACP stdio transport closed", { error: event.error })
		server = null
	}
}

function notifyServerReady(): void {
	for (const listener of serverReadyListeners) {
		try {
			listener()
		} catch (error) {
			log.warn("Server-ready listener failed", error)
		}
	}
}

async function initialize(client: StdioAcpClient): Promise<void> {
	await client.request("initialize", {
		protocolVersion: 1,
		clientCapabilities: {
			fs: { readTextFile: false, writeTextFile: false },
			terminal: false,
		},
		clientInfo: {
			name: "infinitecode-desktop",
			title: "InfiniteCode Desktop",
			version: "0.1.0",
		},
	})
}
