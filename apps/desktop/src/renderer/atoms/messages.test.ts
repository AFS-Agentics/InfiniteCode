import { describe, expect, test } from "bun:test"
import { createStore } from "jotai"
import { groupIntoTurns, mergeSessionParts } from "./derived/session-chat"
import { messagesFamily, setMessagesAtom, upsertMessageAtom } from "./messages"
import { partsFamily, partStorageKey } from "./parts"

describe("message ordering", () => {
	test("keeps assistant replies after optimistic user messages by creation time", () => {
		const store = createStore()
		const user = {
			id: "optimistic-2000",
			sessionID: "s1",
			role: "user",
			time: { created: 2_000 },
		}
		const assistant = {
			id: "019ef97e-0b70-7b20-88ee-d124de3aacde",
			sessionID: "s1",
			role: "assistant",
			parentID: user.id,
			time: { created: 2_100 },
		}

		store.set(upsertMessageAtom, user)
		store.set(upsertMessageAtom, assistant)

		const messages = store.get(messagesFamily("s1"))
		const entries = mergeSessionParts("s1", messages, () => [], 0)

		expect(messages.map((message) => message.id)).toEqual([user.id, assistant.id])
		expect(groupIntoTurns(entries, [])).toEqual([
			{
				id: user.id,
				userMessage: { info: user, parts: [] },
				assistantMessages: [{ info: assistant, parts: [] }],
			},
		])
	})

	test("keeps parts scoped when message IDs repeat across sessions", () => {
		const store = createStore()
		const messageId = "repeat-message"
		const firstMessage = {
			id: messageId,
			sessionID: "s1",
			role: "user",
			time: { created: 1 },
		}
		const secondMessage = {
			id: messageId,
			sessionID: "s2",
			role: "user",
			time: { created: 1 },
		}
		const firstPart = {
			id: "text",
			sessionID: "s1",
			messageID: messageId,
			type: "text",
			text: "first session",
			time: { start: 1 },
		}
		const secondPart = {
			id: "text",
			sessionID: "s2",
			messageID: messageId,
			type: "text",
			text: "second session",
			time: { start: 1 },
		}

		store.set(setMessagesAtom, {
			sessionId: "s1",
			messages: [firstMessage],
			parts: { [messageId]: [firstPart] },
		})
		store.set(setMessagesAtom, {
			sessionId: "s2",
			messages: [secondMessage],
			parts: { [messageId]: [secondPart] },
		})

		const firstEntries = mergeSessionParts(
			"s1",
			store.get(messagesFamily("s1")),
			(id) => store.get(partsFamily(partStorageKey("s1", id))),
			0,
		)
		const secondEntries = mergeSessionParts(
			"s2",
			store.get(messagesFamily("s2")),
			(id) => store.get(partsFamily(partStorageKey("s2", id))),
			0,
		)

		expect(firstEntries).toEqual([{ info: firstMessage, parts: [firstPart] }])
		expect(secondEntries).toEqual([{ info: secondMessage, parts: [secondPart] }])
	})
})
