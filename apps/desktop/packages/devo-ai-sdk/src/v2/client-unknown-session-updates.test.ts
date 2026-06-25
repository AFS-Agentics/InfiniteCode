import { describe, expect, test } from "bun:test"
import { createDevoClient, type DevoAcpTransport, type DevoAcpTransportEvent } from "./client"
import type { AcpSessionNotification } from "./generated"

class FakeTransport implements DevoAcpTransport {
	readonly requests: Array<{ method: string; params: unknown; directory?: string }> = []
	private listeners: Array<(event: DevoAcpTransportEvent) => void> = []

	constructor(
		private readonly handler: (
			method: string,
			params: unknown,
			directory?: string,
		) => unknown,
	) {}

	async request(method: string, params?: unknown, directory?: string): Promise<unknown> {
		this.requests.push({ method, params, directory })
		return this.handler(method, params, directory)
	}

	async respond(): Promise<void> {}

	subscribe(listener: (event: DevoAcpTransportEvent) => void): () => void {
		this.listeners.push(listener)
		return () => {
			this.listeners = this.listeners.filter((item) => item !== listener)
		}
	}

	connected(): boolean {
		return true
	}

	emitSessionUpdate(params: unknown): void {
		for (const listener of this.listeners) {
			listener({ type: "notification", method: "session/update", params })
		}
	}
}

const initializeResult = {
	protocolVersion: 1,
	agentCapabilities: {},
	authMethods: [],
}

async function nextPayload(stream: AsyncIterator<any>, label: string): Promise<any> {
	const result = await Promise.race([
		stream.next(),
		new Promise<IteratorResult<any>>((resolve) =>
			setTimeout(() => resolve({ value: { payload: { type: `timeout:${label}` } }, done: false }), 20),
		),
	])
	return result.value.payload
}

describe("ACP desktop SDK unknown session updates", () => {
	test("does not drop live agent text while session discovery is empty", async () => {
		const transport = new FakeTransport((method) => {
			if (method === "initialize") return initializeResult
			if (method === "session/list") return { sessions: [] }
			throw new Error(`unexpected request ${method}`)
		})
		const client = createDevoClient({ transport })
		const stream = (await client.global.event()).stream[Symbol.asyncIterator]()

		transport.emitSessionUpdate({
			sessionId: "s-missing",
			update: {
				sessionUpdate: "agent_message_chunk",
				messageId: "a1",
				content: { type: "text", text: "hello" },
			},
		} satisfies AcpSessionNotification)

		const placeholderSession = {
			id: "s-missing",
			title: "New session",
			parentID: undefined,
			time: { created: expect.any(Number), updated: expect.any(Number) },
			directory: expect.any(String),
			totalInputTokens: 0,
			totalOutputTokens: 0,
			totalTokens: 0,
			totalCacheCreationTokens: 0,
			totalCacheReadTokens: 0,
			promptTokenEstimate: 0,
			lastQueryTotalTokens: 0,
		}
		expect(await nextPayload(stream, "session")).toEqual({
			type: "session.updated",
			properties: {
				info: placeholderSession,
				session: placeholderSession,
			},
		})
		expect(await nextPayload(stream, "message")).toEqual({
			type: "message.updated",
			properties: {
				info: {
					id: "a1",
					sessionID: "s-missing",
					role: "assistant",
					time: { created: expect.any(Number) },
				},
				message: {
					id: "a1",
					sessionID: "s-missing",
					role: "assistant",
					time: { created: expect.any(Number) },
				},
			},
		})
		expect(await nextPayload(stream, "part")).toEqual({
			type: "message.part.updated",
			properties: {
				part: {
					id: "a1-text",
					sessionID: "s-missing",
					messageID: "a1",
					type: "text",
					text: "hello",
					time: { start: expect.any(Number) },
				},
			},
		})
	})
})
