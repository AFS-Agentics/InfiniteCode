// @ts-nocheck

import {
	AsyncEventQueue,
	type AcpConfigOption,
	configDataFromConfigOptions,
	createIpcTransport,
	defaultCwd,
	permissionOptionId,
	partTime,
	providerDataFromConfigOptions,
	questionInfoFromAcp,
	sessionErrorEvent,
	stableId,
	statusFromDevo,
	textFromUpdate,
	toolCallIdFromUpdate,
	toolPartFromUpdate,
} from "./acp-client-support"
import type {
	AcpCancelParams,
	AcpDeleteSessionParams,
	AcpListSessionsResult,
	AcpLoadSessionResult,
	AcpNewSessionResult,
	AcpPromptParams,
	AcpRequestPermissionParams,
	AcpSessionInfo,
	AcpSessionNotification,
	AcpSetConfigOptionParams,
	AcpSetConfigOptionResult,
} from "./generated"
import type {
	ModelConfigParams,
	ModelConfigResult,
	RequestUserInputRespondParams,
} from "./generated/protocol"
import {
	ProtocolValidationError,
	assertValidProtocolPayload,
} from "./protocol-validation"

export type JsonRpcId = number | string

export interface DevoAcpTransportEvent {
	type: "notification" | "request" | "closed"
	id?: JsonRpcId
	method?: string
	params?: unknown
	error?: string
}

export interface DevoAcpTransport {
	request(method: string, params?: unknown, directory?: string): Promise<unknown>
	respond(id: JsonRpcId, result: unknown): Promise<void>
	subscribe(listener: (event: DevoAcpTransportEvent) => void): () => void
	connected(): boolean
}

export interface CreateDevoClientOptions {
	baseUrl?: string
	directory?: string
	fetch?: typeof fetch
	transport?: DevoAcpTransport
}

export type Agent = any
export type AgentConfig = any
export type AgentPart = any
export type AssistantMessage = any
export type Command = any
export type CompactionPart = any
export type Config = any
export type Event = any
export type EventMessagePartDelta = any
export type EventMessagePartUpdated = any
export type EventPermissionAsked = any
export type EventSessionCreated = any
export type EventSessionDeleted = any
export type EventSessionError = any
export type EventSessionStatus = any
export type EventSessionUpdated = any
export type FileDiff = any
export type FilePart = any
export type FilePartInput = any
export type McpLocalConfig = any
export type McpOAuthConfig = any
export type McpRemoteConfig = any
export type Message = any
export type Model = any
export type Part = any
export type PatchPart = any
export type PermissionAction = any
export type PermissionActionConfig = any
export type PermissionConfig = any
export type PermissionObjectConfig = any
export type PermissionRequest = any
export type PermissionRule = any
export type PermissionRuleConfig = any
export type PermissionRuleset = any
export type Project = any
export type Provider = any
export type ProviderAuthMethod = any
export type ProviderConfig = any
export type QuestionAnswer = any
export type QuestionInfo = any
export type QuestionOption = any
export type QuestionRequest = any
export type ReasoningPart = any
export type RetryPart = any
export type ServerConfig = any
export type Session = any
export type SessionStatus = any
export type SnapshotPart = any
export type StepFinishPart = any
export type StepStartPart = any
export type SubtaskPart = any
export type TextPart = any
export type Todo = any
export type ToolPart = any
export type ToolState = any
export type ToolStateCompleted = any
export type UserMessage = any
export type Worktree = any

interface GlobalEvent {
	directory: string
	payload: Event
}

type PendingPermission = {
	id: JsonRpcId
	sessionId: string
	options: AcpRequestPermissionParams["options"]
}

type PendingQuestion = {
	sessionId: string
	turnId: string
	questions: QuestionInfo[]
}

function partCacheKey(sessionId: string, messageId: string): string {
	return `${sessionId}\u001f${messageId}`
}

class AcpClient {
	private transport: DevoAcpTransport | null = null
	private openPromise: Promise<void> | null = null
	private initialized = false
	private events = new AsyncEventQueue<GlobalEvent>()
	private sessions = new Map<string, Session>()
	private sessionDirectories = new Map<string, string>()
	private sessionStatuses = new Map<string, SessionStatus>()
	private messages = new Map<string, Message[]>()
	private parts = new Map<string, Part[]>()
	private loadedSessions = new Set<string>()
	private lastUserMessageBySession = new Map<string, string>()
	private configOptionsBySession = new Map<string, AcpConfigOption[]>()
	private configOptionsByDirectory = new Map<string, AcpConfigOption[]>()
	private pendingPermissions = new Map<string, PendingPermission>()
	private pendingQuestions = new Map<string, PendingQuestion>()
	private sessionDiscovery = new Map<string, Promise<Session | undefined>>()
	private lastEventTime = 0

	constructor(private readonly options: CreateDevoClientOptions) {}
	project = {
		list: async () => ({ data: await this.listProjects() }),
	}
	session = {
		list: async (params?: { limit?: number; roots?: boolean; search?: string }) => ({
			data: await this.listSessions(params),
		}),
		status: async () => ({ data: Object.fromEntries(this.sessionStatuses) }),
		create: async (_params?: { title?: string }) => ({ data: await this.createSession() }),
		promptAsync: async (params: {
			sessionID: string
			parts: Array<{ type: string; text?: string; url?: string; filename?: string; mime?: string; mediaType?: string }>
			model?: unknown
			agent?: string
			variant?: string
		}) => {
			const model = params.model as { modelID?: string } | undefined
			if (model?.modelID) await this.setSessionConfigOption(params.sessionID, "model", model.modelID)
			if (params.variant) await this.setSessionConfigOption(params.sessionID, "thought_level", params.variant)
			const text = params.parts
				.map((part) => (part.type === "text" ? (part.text ?? "") : ""))
				.join("\n")
				.trim()
			const prompt = []
			if (text || params.parts.every((part) => part.type !== "file")) {
				prompt.push({ type: "text", text })
			}
			for (const part of params.parts) {
				if (part.type !== "file" || !part.url) continue
				prompt.push({
					type: "resource_link",
					uri: part.url,
					name: part.filename ?? part.url,
					...(part.mime || part.mediaType ? { mimeType: part.mime ?? part.mediaType } : {}),
				})
			}
			const promptParams: AcpPromptParams = {
				sessionId: params.sessionID,
				prompt,
			}
			const directory = this.sessionDirectories.get(params.sessionID) ?? this.options.directory ?? defaultCwd()
			this.lastUserMessageBySession.delete(params.sessionID)
			const busyStatus = { type: "busy" }
			this.sessionStatuses.set(params.sessionID, busyStatus)
			this.emit(directory, {
				type: "session.status",
				properties: { sessionID: params.sessionID, status: busyStatus },
			})
			void this.request("session/prompt", promptParams)
				.then(() => {
					const idleStatus = { type: "idle" }
					this.sessionStatuses.set(params.sessionID, idleStatus)
					this.emit(directory, {
						type: "session.status",
						properties: { sessionID: params.sessionID, status: idleStatus },
					})
				})
				.catch((error) => {
					const idleStatus = { type: "idle" }
					this.sessionStatuses.set(params.sessionID, idleStatus)
					this.emit(directory, sessionErrorEvent(params.sessionID, error))
					this.emit(directory, {
						type: "session.status",
						properties: { sessionID: params.sessionID, status: idleStatus },
					})
				})
		},
		abort: async (params: { sessionID: string }) => {
			const cancelParams: AcpCancelParams = { sessionId: params.sessionID }
			await this.request("session/cancel", cancelParams)
		},
		update: async (params: { sessionID: string; title: string }) => {
			const result = (await this.request("_devo/session/title/update", {
				session_id: params.sessionID,
				title: params.title,
			})) as { session?: Record<string, unknown> }
			const metadata = result.session ?? {}
			const session = this.rememberSession({
				sessionId: String(metadata.session_id ?? params.sessionID),
				cwd: String(metadata.cwd ?? this.sessionDirectories.get(params.sessionID) ?? this.options.directory ?? defaultCwd()),
				title: typeof metadata.title === "string" ? metadata.title : params.title,
				updatedAt: typeof metadata.updated_at === "string" ? metadata.updated_at : undefined,
				_meta: { "devo/session": metadata },
			})
			this.emit(session.directory ?? this.options.directory ?? defaultCwd(), {
				type: "session.updated",
				properties: { info: session, session },
			})
			return { data: session }
		},
		delete: async (params: { sessionID: string }) => {
			const deleteParams: AcpDeleteSessionParams = { sessionId: params.sessionID }
			await this.request("session/delete", deleteParams)
			const directory = this.sessionDirectories.get(params.sessionID) ?? this.options.directory ?? defaultCwd()
			this.sessions.delete(params.sessionID)
			this.sessionStatuses.delete(params.sessionID)
			this.sessionDirectories.delete(params.sessionID)
			this.loadedSessions.delete(params.sessionID)
			this.messages.delete(params.sessionID)
			for (const [messageId, parts] of this.parts) {
				if (parts.some((part) => part.sessionID === params.sessionID)) {
					this.parts.delete(messageId)
				}
			}
			this.emit(directory, {
				type: "session.deleted",
				properties: { info: { id: params.sessionID, directory } },
			})
		},
		get: async (params: { sessionID: string }) => ({
			data: await this.getSessionById(params.sessionID),
		}),
		diff: async (_params: { sessionID: string }) => ({ data: [] }),
		revert: async (params: { sessionID: string }) => ({
			data: this.sessions.get(params.sessionID),
		}),
		unrevert: async (params: { sessionID: string }) => ({
			data: this.sessions.get(params.sessionID),
		}),
		command: async (params: { sessionID: string; command: string; arguments?: string }) => {
			const suffix = params.arguments ? ` ${params.arguments}` : ""
			await this.session.promptAsync({
				sessionID: params.sessionID,
				parts: [{ type: "text", text: `/${params.command}${suffix}` }],
			})
		},
		summarize: async (params: { sessionID: string }) => {
			await this.session.promptAsync({
				sessionID: params.sessionID,
				parts: [{ type: "text", text: "/compact" }],
			})
		},
		messages: async (params: { sessionID: string }) => ({
			data: await this.sessionMessages(params.sessionID),
		}),
		fork: async (params: { sessionID: string }) => ({
			data: this.sessions.get(params.sessionID),
		}),
	}

	permission = {
		respond: async (params: {
			sessionID: string
			permissionID: string
			response: "once" | "always" | "reject"
		}) => {
			await this.respondToPermission(params.permissionID, params.response)
		},
		reply: async (params: { requestID: string; reply?: "once" | "always" | "reject" }) => {
			await this.respondToPermission(params.requestID, params.reply ?? "reject")
		},
	}

	question = {
		reply: async (params: { requestID: string; answers: QuestionAnswer[] }) => {
			await this.respondToQuestion(params.requestID, params.answers, "question.replied")
		},
		reject: async (params: { requestID: string }) => {
			await this.respondToQuestion(params.requestID, [], "question.rejected")
		},
	}

	instance = {
		dispose: async () => {},
	}

	global = {
		dispose: async () => {},
		event: async () => {
			await this.ensureInitialized()
			return { stream: this.events }
		},
		config: {
			update: async (_params: unknown) => ({ data: null }),
		},
	}

	event = {
		subscribe: async () => {
			await this.ensureInitialized()
			return { stream: this.events }
		},
	}

	command = {
		list: async () => ({ data: [{ name: "compact", description: "Compact the session" }] }),
	}

	find = {
		files: async (_params: { query: string }) => ({ data: [] }),
	}

	worktree = {
		list: async () => ({ data: [] }),
		create: async (_params: unknown) => ({ data: null }),
		remove: async (_params: unknown) => ({ data: null }),
		reset: async (_params: unknown) => ({ data: null }),
	}

	config = {
		providers: async () => ({
			data: providerDataFromConfigOptions(await this.ensureCurrentConfigOptions()),
		}),
		get: async () => ({ data: configDataFromConfigOptions(await this.ensureCurrentConfigOptions()) }),
	}

	vcs = {
		get: async () => ({ data: null }),
	}

	app = {
		agents: async () => ({ data: [] }),
		skills: async () => ({ data: [] }),
	}

	provider = {
		list: async () => ({ data: [] }),
		auth: async () => ({ data: [] }),
		oauth: {
			authorize: async (_params: unknown) => ({ data: null }),
			callback: async (_params: unknown) => ({ data: null }),
		},
	}

	auth = {
		set: async (_params: unknown) => ({ data: null }),
		remove: async (_params: unknown) => ({ data: null }),
	}

	part = {
		delete: async (_params: unknown) => ({ data: null }),
	}

	private async listProjects(): Promise<Project[]> {
		const sessions = await this.listSessions()
		const byDirectory = new Map<string, Project>()
		for (const session of sessions) {
			const directory = session.directory ?? this.options.directory
			if (!directory) continue
			const previous = byDirectory.get(directory)
			const updated = session.time.updated
			if (previous) {
				previous.time.updated = Math.max(previous.time.updated ?? 0, updated)
				continue
			}
			byDirectory.set(directory, {
				id: stableId(directory),
				name: directory.split(/[\\/]/).filter(Boolean).at(-1) ?? directory,
				worktree: directory,
				path: { root: directory },
				time: { created: session.time.created, updated },
				sandboxes: [],
			})
		}
		if (byDirectory.size === 0 && this.options.directory) {
			byDirectory.set(this.options.directory, {
				id: stableId(this.options.directory),
				name: this.options.directory.split(/[\\/]/).filter(Boolean).at(-1) ?? this.options.directory,
				worktree: this.options.directory,
				path: { root: this.options.directory },
				time: { created: Date.now(), updated: Date.now() },
				sandboxes: [],
			})
		}
		return [...byDirectory.values()]
	}

	private async listSessions(params?: { limit?: number; roots?: boolean; search?: string }): Promise<Session[]> {
		await this.ensureInitialized()
		const sessions: Session[] = []
		let cursor: string | undefined
		do {
			const result = (await this.request("session/list", {
				cwd: this.options.directory,
				...(cursor ? { cursor } : {}),
			})) as AcpListSessionsResult
			sessions.push(...(result.sessions ?? []).map((info) => this.rememberSession(info)))
			cursor = result.nextCursor ?? undefined
			if (params?.limit && !params.search && sessions.length >= params.limit) break
			if (params?.limit && params.search) {
				const matching = sessions.filter((session) =>
					(session.title ?? session.id).toLowerCase().includes(params.search!.toLowerCase()),
				)
				if (matching.length >= params.limit) break
			}
		} while (cursor)
		const filtered = params?.search
			? sessions.filter((session) =>
					(session.title ?? session.id).toLowerCase().includes(params.search!.toLowerCase()),
				)
			: sessions
		return filtered.slice(0, params?.limit ?? filtered.length)
	}

	private async createSession(): Promise<Session> {
		await this.ensureInitialized()
		const cwd = this.options.directory ?? defaultCwd()
		const result = (await this.request("session/new", {
			cwd,
			additionalDirectories: [],
			mcpServers: [],
		})) as AcpNewSessionResult
		const session = this.rememberSession({ sessionId: result.sessionId, cwd })
		this.rememberConfigOptions(session.id, cwd, result.configOptions)
		this.emit(session.directory ?? cwd, {
			type: "session.created",
			properties: { info: session, session },
		})
		return session
		}
		private async sessionMessages(sessionId: string): Promise<Array<{ info: Message; parts: Part[] }>> {
		await this.loadSession(sessionId)
		const messages = this.messages.get(sessionId) ?? []
		return messages.map((info) => ({
			info,
			parts: this.parts.get(partCacheKey(sessionId, info.id)) ?? [],
		}))
	}
		private async loadSession(sessionId: string): Promise<void> {
		if (this.loadedSessions.has(sessionId)) return
		await this.ensureInitialized()
		const session = await this.getSessionById(sessionId)
		const cwd = session?.directory ?? this.sessionDirectories.get(sessionId)
		if (!cwd) throw new Error(`session ${sessionId} not found`)
		const result = (await this.request("session/load", {
			sessionId,
			cwd,
			additionalDirectories: [],
			mcpServers: [],
		})) as AcpLoadSessionResult
		this.rememberConfigOptions(sessionId, cwd, result.configOptions)
		this.loadedSessions.add(sessionId)
	}

	private async getSessionById(sessionId: string): Promise<Session | undefined> {
		const session = this.sessions.get(sessionId)
		if (session) return session
		return this.discoverSession(sessionId)
	}

	private async discoverSession(sessionId: string): Promise<Session | undefined> {
		const pending = this.sessionDiscovery.get(sessionId)
		if (pending) return pending
		const discovery = this.listSessions()
			.then((sessions) => sessions.find((session) => session.id === sessionId))
			.finally(() => {
				this.sessionDiscovery.delete(sessionId)
			})
		this.sessionDiscovery.set(sessionId, discovery)
		return discovery
	}

	private rememberSession(info: AcpSessionInfo): Session {
		const meta = info._meta?.["devo/session"]
		const created = Date.parse(meta?.created_at ?? info.updatedAt ?? "") || Date.now()
		const updated = Date.parse(meta?.updated_at ?? info.updatedAt ?? "") || created
		const session: Session = {
			id: info.sessionId,
			title: info.title ?? "New session",
			parentID: meta?.parent_session_id ?? undefined,
			time: { created, updated },
			directory: info.cwd,
			totalInputTokens: meta?.total_input_tokens ?? 0,
			totalOutputTokens: meta?.total_output_tokens ?? 0,
			totalTokens: meta?.total_tokens ?? 0,
			totalCacheCreationTokens: meta?.total_cache_creation_tokens ?? 0,
			totalCacheReadTokens: meta?.total_cache_read_tokens ?? 0,
			promptTokenEstimate: meta?.prompt_token_estimate ?? 0,
			lastQueryTotalTokens: meta?.last_query_total_tokens ?? 0,
		}
		this.sessions.set(session.id, session)
		this.sessionDirectories.set(session.id, info.cwd)
		this.sessionStatuses.set(session.id, statusFromDevo(meta?.status))
		return session
	}

	private async ensureInitialized(): Promise<void> {
		if (this.initialized) return
		await this.open()
		await this.request("initialize", {
			protocolVersion: 1,
			clientCapabilities: {
				fs: { readTextFile: false, writeTextFile: false },
				terminal: false,
			},
			clientInfo: {
				name: "devo-desktop",
				title: "Devo Desktop",
				version: "0.1.0",
			},
		})
		this.initialized = true
	}

	private async open(): Promise<void> {
		if (this.transport) return
		if (this.openPromise) return this.openPromise
		this.openPromise = Promise.resolve()
			.then(() => {
				this.transport = this.options.transport ?? createIpcTransport()
				this.transport.subscribe((event) => this.handleTransportEvent(event))
			})
			.finally(() => {
				this.openPromise = null
			})
		return this.openPromise
	}

	private async request(method: string, params: unknown): Promise<unknown> {
		await this.open()
		if (!this.transport) throw new Error("Devo ACP transport is not connected")
		const validParams = assertValidProtocolPayload({
			method,
			direction: "outgoingRequest",
			payload: params,
		})
		const result = await this.transport.request(method, validParams, this.options.directory)
		return assertValidProtocolPayload({
			method,
			direction: "incomingResult",
			payload: result,
		})
	}

	private handleTransportEvent(event: DevoAcpTransportEvent): void {
		if (event.type === "closed") {
			this.events.close()
			return
		}
		if (event.type === "notification" && event.method === "session/update" && event.params) {
			const notification = this.validateTransportPayload<AcpSessionNotification>(
				event.method,
				"incomingNotification",
				event.params,
			)
			if (!notification) return
			this.handleSessionUpdate(notification)
			return
		}
		if (event.type === "request" && event.id !== undefined && event.method) {
			const params = this.validateTransportPayload(event.method, "incomingRequest", event.params)
			if (!params) return
			this.handleServerRequest(event.id, event.method, params)
		}
	}

	private validateTransportPayload<T>(
		method: string,
		direction:
			| "incomingNotification"
			| "incomingRequest",
		payload: unknown,
	): T | null {
		try {
			return assertValidProtocolPayload<T>({ method, direction, payload })
		} catch (error) {
			this.emitProtocolValidationError(method, payload, error)
			return null
		}
	}

	private handleServerRequest(id: JsonRpcId, method: string, params: unknown): void {
		if (method !== "session/request_permission") return
		const value = params as AcpRequestPermissionParams
		const sessionId = String(value.sessionId ?? "")
		if (!sessionId) return
		const permissionId = `acp-permission-${String(id)}`
		const options = Array.isArray(value.options)
			? value.options.map((option) => ({
					optionId: String(option.optionId),
					kind: String(option.kind),
				}))
			: []
		this.pendingPermissions.set(permissionId, { id, sessionId, options })

		const toolCall = (value.toolCall ?? {}) as Record<string, unknown>
		const permission = String(toolCall.title ?? "Agent requested permission")
		const rawInput = toolCall.rawInput
		const command =
			rawInput && typeof rawInput === "object" && "command" in rawInput
				? String((rawInput as { command: unknown }).command)
				: undefined
		const directory = this.sessionDirectories.get(sessionId) ?? this.options.directory ?? defaultCwd()
		this.emit(directory, {
			type: "permission.asked",
			properties: {
				id: permissionId,
				requestID: permissionId,
				sessionID: sessionId,
				permission,
				metadata: {
					tool: toolCall.kind,
					command,
				},
			},
		})
	}

	private async respondToPermission(permissionId: string, response: "once" | "always" | "reject"): Promise<void> {
		await this.open()
		if (!this.transport) throw new Error("Devo ACP transport is not connected")
		const pending = this.pendingPermissions.get(permissionId)
		if (!pending) return
		this.pendingPermissions.delete(permissionId)
		const optionId = permissionOptionId(pending.options, response)
		const result = {
			outcome: {
				outcome: "selected",
				optionId,
			},
		}
		await this.transport.respond(
			pending.id,
			assertValidProtocolPayload({
				method: "session/request_permission",
				direction: "outgoingResponse",
				payload: result,
			}),
		)
		this.emit(this.sessionDirectories.get(pending.sessionId) ?? this.options.directory ?? defaultCwd(), {
			type: "permission.replied",
			properties: {
				sessionID: pending.sessionId,
				requestID: permissionId,
			},
		})
	}

	private async respondToQuestion(
		requestId: string,
		answers: QuestionAnswer[],
		eventType: "question.replied" | "question.rejected",
	): Promise<void> {
		const pending = this.pendingQuestions.get(requestId)
		if (!pending) return
		const responseAnswers: Record<string, { answers: string[] }> = {}
		pending.questions.forEach((question, index) => {
			const rawAnswer = answers[index]
			const answerValues = Array.isArray(rawAnswer)
				? rawAnswer.map(String)
				: rawAnswer === undefined || rawAnswer === null
					? []
					: [String(rawAnswer)]
			responseAnswers[question.id] = { answers: answerValues }
		})
		const respondParams: RequestUserInputRespondParams = {
			session_id: pending.sessionId,
			turn_id: pending.turnId,
			request_id: requestId,
			response: { answers: responseAnswers },
		}
		await this.request("_devo/request_user_input/respond", respondParams)
		this.pendingQuestions.delete(requestId)
		this.emit(this.sessionDirectories.get(pending.sessionId) ?? this.options.directory ?? defaultCwd(), {
			type: eventType,
			properties: {
				sessionID: pending.sessionId,
				requestID: requestId,
			},
		})
	}

	private handleSessionUpdate(notification: AcpSessionNotification): void {
		const sessionId = notification.sessionId
		const update = notification.update as Record<string, unknown>
		const kind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : undefined
		let session = this.sessions.get(sessionId)
		let directory = this.sessionDirectories.get(sessionId) ?? session?.directory
		if (!session || !directory) {
			const canApplyWithoutDiscoveredSession =
				kind === "user_message_chunk" ||
				kind === "userMessageChunk" ||
				kind === "agent_message_chunk" ||
				kind === "agentMessageChunk" ||
				kind === "agent_thought_chunk" ||
				kind === "agentThoughtChunk" ||
				kind === "tool_call" ||
				kind === "tool_call_update" ||
				kind === "toolCall" ||
				kind === "toolCallUpdate" ||
				kind?.includes("tool") ||
				Boolean(update.toolCallId)
			if (canApplyWithoutDiscoveredSession) {
				directory = this.options.directory ?? defaultCwd()
				session = this.rememberSession({ sessionId, cwd: directory })
			} else {
				void this.discoverSession(sessionId)
					.then((discovered) => {
						if (discovered) this.handleSessionUpdate(notification)
					})
					.catch((error) => {
						this.emit(this.options.directory ?? defaultCwd(), sessionErrorEvent(sessionId, error))
					})
				return
			}
		}
		if (kind === "session_info_update" || kind === "sessionInfoUpdate") {
			if (typeof update.title === "string") session.title = update.title
			let updated = typeof update.updatedAt === "string" ? Date.parse(update.updatedAt) : NaN
			if (!Number.isFinite(updated)) {
				const original = notification._meta?.["devo/originalEvent"]
				const originalEvent = original && typeof original === "object" ? (original as Record<string, unknown>) : {}
				const turn = originalEvent.turn
				const turnValue = turn && typeof turn === "object" ? (turn as Record<string, unknown>) : {}
				const completedAt =
					typeof turnValue.completed_at === "string"
						? turnValue.completed_at
						: typeof turnValue.completedAt === "string"
							? turnValue.completedAt
							: undefined
				const startedAt =
					typeof turnValue.started_at === "string"
						? turnValue.started_at
						: typeof turnValue.startedAt === "string"
							? turnValue.startedAt
							: undefined
				updated = Date.parse(completedAt ?? startedAt ?? "")
			}
			if (Number.isFinite(updated)) session.time.updated = updated
		}
		this.emit(directory, { type: "session.updated", properties: { info: session, session } })
		this.handleOriginalEvent(sessionId, directory, notification)

		switch (kind) {
			case "user_message_chunk":
			case "userMessageChunk":
				this.appendText(sessionId, directory, "user", "text", update)
				break
			case "agent_message_chunk":
			case "agentMessageChunk":
				this.appendText(sessionId, directory, "assistant", "text", update)
				break
			case "agent_thought_chunk":
			case "agentThoughtChunk":
				this.appendText(sessionId, directory, "assistant", "reasoning", update)
				break
			case "plan":
				this.emitPlan(sessionId, directory, update)
				break
			case "config_option_update":
			case "configOptionUpdate":
				if (Array.isArray(update.configOptions) && update.configOptions.length > 0) {
					this.rememberConfigOptions(sessionId, directory, update.configOptions as AcpConfigOption[])
				}
				this.emit(directory, {
					type: "session.config.updated",
					properties: { sessionID: sessionId, configOptions: update.configOptions ?? [] },
				})
				break
			case "available_commands_update":
			case "availableCommandsUpdate":
				this.emit(directory, {
					type: "session.commands.updated",
					properties: { sessionID: sessionId, commands: update.availableCommands ?? [] },
				})
				break
			case "current_mode_update":
			case "currentModeUpdate":
				this.emit(directory, {
					type: "session.mode.updated",
					properties: { sessionID: sessionId, modeID: update.currentModeId },
				})
				break
			case "usage_update":
			case "usageUpdate":
				this.emit(directory, {
					type: "session.usage.updated",
					properties: {
						sessionID: sessionId,
						used: update.used,
						size: update.size,
						cost: update.cost,
					},
				})
				break
			case "tool_call":
			case "tool_call_update":
			case "toolCall":
			case "toolCallUpdate":
				this.appendTool(sessionId, directory, update)
				break
			default:
				if (kind?.includes("tool") || update.toolCallId) {
					this.appendTool(sessionId, directory, update)
				}
		}
	}

	private handleOriginalEvent(
		sessionId: string,
		directory: string,
		notification: AcpSessionNotification,
	): void {
		const original = notification._meta?.["devo/originalEvent"]
		if (!original || typeof original !== "object") return
		if ("RequestUserInput" in original) {
			const payload = (original as { RequestUserInput: Record<string, unknown> }).RequestUserInput
			this.handleRequestUserInput(sessionId, directory, payload)
		}
		if ("ServerRequestResolved" in original) {
			const payload = (original as { ServerRequestResolved: Record<string, unknown> })
				.ServerRequestResolved
			const requestId = String(payload.request_id ?? payload.requestId ?? "")
			const pending = this.pendingQuestions.get(requestId)
			if (!pending) return
			this.pendingQuestions.delete(requestId)
			this.emit(directory, {
				type: "question.replied",
				properties: { sessionID: pending.sessionId, requestID: requestId },
			})
		}
	}

	private handleRequestUserInput(
		sessionId: string,
		directory: string,
		payload: Record<string, unknown>,
	): void {
		const request = (payload.request ?? {}) as Record<string, unknown>
		const requestId = String(request.request_id ?? request.requestId ?? "")
		if (!requestId) return
		const requestSessionId = String(request.session_id ?? request.sessionId ?? sessionId)
		const turnId = String(request.turn_id ?? request.turnId ?? "")
		const rawQuestions = Array.isArray(payload.questions) ? payload.questions : []
		const questions = rawQuestions.map(questionInfoFromAcp)
		this.pendingQuestions.set(requestId, { sessionId: requestSessionId, turnId, questions })
		this.emit(directory, {
			type: "question.asked",
			properties: {
				id: requestId,
				requestID: requestId,
				sessionID: requestSessionId,
				questions,
			},
		})
	}

	private appendText(
		sessionId: string,
		directory: string,
		role: "assistant" | "user",
		partType: "reasoning" | "text",
		update: Record<string, unknown>,
	): void {
		const text = textFromUpdate(update)
		if (!text) return
		const now = this.nextEventTime()
		const messageId =
			typeof update.messageId === "string"
				? update.messageId
				: `${role}-${sessionId}-${now}`
		const existingMessage = this.messages.get(sessionId)?.find((message) => message.id === messageId)
		const message =
			existingMessage ??
			({
				id: messageId,
				sessionID: sessionId,
				role,
				...(role === "assistant" && this.lastUserMessageBySession.get(sessionId)
					? { parentID: this.lastUserMessageBySession.get(sessionId) }
					: {}),
				time: { created: now },
			} as Message)
		this.appendMessage(sessionId, message)
		if (role === "user") this.lastUserMessageBySession.set(sessionId, messageId)
		this.emit(directory, { type: "message.updated", properties: { info: message, message } })

		const partId = `${messageId}-${partType === "reasoning" ? "reasoning" : "text"}`
		const existingPart = this.parts
			.get(partCacheKey(sessionId, messageId))
			?.find((part) => part.id === partId)
		const field = partType === "reasoning" ? "text" : "text"
		const part = {
			id: partId,
			sessionID: sessionId,
			messageID: messageId,
			type: partType,
			[field]: `${typeof existingPart?.[field] === "string" ? existingPart[field] : ""}${text}`,
			time: partTime(existingPart, now),
		} as TextPart | ReasoningPart
		this.appendPart(sessionId, messageId, part)
		this.emit(directory, { type: "message.part.updated", properties: { part } })
	}

	private emitPlan(sessionId: string, directory: string, update: Record<string, unknown>): void {
		const entries = Array.isArray(update.entries) ? update.entries : []
		const todos = entries.map((entry) => {
			const value = entry as Record<string, unknown>
			return {
				content: String(value.content ?? value.title ?? ""),
				status: String(value.status ?? "pending"),
			}
		})
		this.emit(directory, {
			type: "todo.updated",
			properties: { sessionID: sessionId, todos },
		})
	}

	private appendTool(sessionId: string, directory: string, update: Record<string, unknown>): void {
		const now = this.nextEventTime()
		const toolCallId = toolCallIdFromUpdate(update, now)
		const messageId = `tool-${toolCallId}`
		const existingPart = this.parts
			.get(partCacheKey(sessionId, messageId))
			?.find((part) => part.id === `${messageId}-part`)
		const message: Message = {
			id: messageId,
			sessionID: sessionId,
			role: "assistant",
			time: { created: now },
		}
		const part = toolPartFromUpdate(sessionId, update, existingPart, now) as ToolPart
		this.appendMessage(sessionId, message)
		this.appendPart(sessionId, message.id, part)
		this.emit(directory, { type: "message.updated", properties: { info: message, message } })
		this.emit(directory, { type: "message.part.updated", properties: { part } })
	}

	private appendMessage(sessionId: string, message: Message): void {
		const messages = this.messages.get(sessionId) ?? []
		const index = messages.findIndex((existing) => existing.id === message.id)
		if (index >= 0) {
			messages[index] = message
		} else {
			messages.push(message)
		}
		this.messages.set(sessionId, messages)
	}

	private appendPart(sessionId: string, messageId: string, part: Part): void {
		const key = partCacheKey(sessionId, messageId)
		const parts = this.parts.get(key) ?? []
		const index = parts.findIndex((existing) => existing.id === part.id)
		if (index >= 0) {
			parts[index] = part
		} else {
			parts.push(part)
		}
		this.parts.set(key, parts)
	}

	private nextEventTime(): number {
		const now = Date.now()
		const eventTime = Math.max(now, this.lastEventTime + 1)
		this.lastEventTime = eventTime
		return eventTime
	}

	private rememberConfigOptions(
		sessionId: string,
		directory: string,
		configOptions?: AcpConfigOption[],
	): void {
		if (!Array.isArray(configOptions)) return
		this.configOptionsBySession.set(sessionId, configOptions)
		this.rememberDirectoryConfigOptions(directory, configOptions)
	}

	private rememberDirectoryConfigOptions(
		directory: string,
		configOptions?: AcpConfigOption[] | null,
	): void {
		if (!Array.isArray(configOptions)) return
		this.configOptionsByDirectory.set(directory, configOptions)
	}

	private async setSessionConfigOption(
		sessionId: string,
		configId: string,
		value: string,
	): Promise<void> {
		const setConfigParams: AcpSetConfigOptionParams = {
			sessionId,
			configId,
			value,
		}
		const result = (await this.request("session/set_config_option", setConfigParams)) as AcpSetConfigOptionResult
		const directory = this.sessionDirectories.get(sessionId) ?? this.options.directory ?? defaultCwd()
		this.rememberConfigOptions(sessionId, directory, result.configOptions)
	}

	private cachedConfigOptions(): AcpConfigOption[] | undefined {
		if (this.options.directory) {
			const byDirectory = this.configOptionsByDirectory.get(this.options.directory)
			if (byDirectory) return byDirectory
		}
		return this.configOptionsBySession.values().next().value
	}

	private currentConfigOptions(): AcpConfigOption[] {
		return this.cachedConfigOptions() ?? []
	}

	private async ensureCurrentConfigOptions(): Promise<AcpConfigOption[]> {
		const cached = this.cachedConfigOptions()
		if (cached) return cached

		await this.ensureInitialized()
		const directory = this.options.directory ?? defaultCwd()
		const params: ModelConfigParams = this.options.directory ? { cwd: this.options.directory } : {}
		const result = (await this.request("model/config", params)) as ModelConfigResult
		this.rememberDirectoryConfigOptions(directory, result.configOptions)
		return this.currentConfigOptions()
	}

	private emit(directory: string, payload: Event): void {
		this.events.push({ directory, payload })
	}

	private emitProtocolValidationError(method: string, payload: unknown, error: unknown): void {
		const sessionId = sessionIdFromPayload(payload) ?? "protocol"
		const directory = this.sessionDirectories.get(sessionId) ?? this.options.directory ?? defaultCwd()
		const reason =
			error instanceof ProtocolValidationError
				? error
				: new ProtocolValidationError({
						method,
						direction: "incomingNotification",
						payload,
						message: error instanceof Error ? error.message : String(error),
					})
		this.emit(directory, sessionErrorEvent(sessionId, reason))
	}
}

export type DevoClient = any

export function createDevoClient(options: CreateDevoClientOptions = {}): DevoClient {
	return new AcpClient(options)
}

function sessionIdFromPayload(payload: unknown): string | null {
	if (!payload || typeof payload !== "object") return null
	const value = payload as Record<string, unknown>
	for (const key of ["sessionId", "session_id"]) {
		if (typeof value[key] === "string") return value[key] as string
	}
	return null
}
