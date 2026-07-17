/**
 * Long-term memory store — persistent facts/preferences that the agent should
 * remember across sessions.
 *
 * Backed by a single JSON file at `app.getPath('userData')/memories.json`
 * to avoid pulling in a new database dependency for v1.
 *
 * Caps:
 *   - 1000 memories total (FIFO eviction when exceeded)
 *
 * Search:
 *   - Tokenize query + memory content into word bags.
 *   - Score = sum of (query-token × content/category/tag overlap), with a
 *     recency tiebreaker. Returns top-N matches with non-zero scores.
 *   - Good enough for v1; embeddings can replace this later.
 *
 * Threading: only used from the Electron main process.
 */

import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { app } from "electron"
import { createLogger } from "./logger"

const log = createLogger("memory-store")

// ============================================================
// Schema
// ============================================================

export type MemoryCategory =
	| "preference"
	| "fact"
	| "project"
	| "note"
	| "feedback"

export type MemorySource = "user" | "inferred" | "tool"

export interface Memory {
	id: string
	content: string
	category: MemoryCategory
	tags: string[]
	source: MemorySource
	createdAt: number
	lastUsedAt: number | null
	useCount: number
}

export interface MemoryInput {
	content: string
	category?: MemoryCategory
	tags?: string[]
	source?: MemorySource
}

export interface ScoredMemory {
	memory: Memory
	score: number
}

export interface MemoryStats {
	total: number
	byCategory: Record<MemoryCategory, number>
}

interface PersistedFile {
	version: 1
	memories: Memory[]
}

// ============================================================
// Constants
// ============================================================

const MAX_MEMORY_COUNT = 1000
const FILE_NAME = "memories.json"

// ============================================================
// Module-scope state
// ============================================================

let cache: Memory[] | null = null

function filePath(): string {
	return join(app.getPath("userData"), FILE_NAME)
}

function load(): Memory[] {
	if (cache) return cache
	try {
		const p = filePath()
		if (!existsSync(p)) {
			cache = []
			return cache
		}
		const raw = readFileSync(p, "utf8")
		const parsed = JSON.parse(raw) as PersistedFile
		cache = Array.isArray(parsed?.memories) ? parsed.memories : []
	} catch (err) {
		log.warn("Failed to load memories, starting empty", err)
		cache = []
	}
	return cache
}

function persist(): void {
	try {
		const p = filePath()
		const dir = dirname(p)
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
		const payload: PersistedFile = { version: 1, memories: cache ?? [] }
		writeFileSync(p, JSON.stringify(payload, null, 2), "utf8")
	} catch (err) {
		log.error("Failed to persist memories", err)
	}
}

function enforceCap(): void {
	if (!cache) return
	const list = cache
	if (list.length <= MAX_MEMORY_COUNT) return
	const sorted = [...list].sort((a, b) => a.createdAt - b.createdAt)
	const overflow = sorted.length - MAX_MEMORY_COUNT
	for (let i = 0; i < overflow; i++) {
		const dropped = sorted[i]
		const idx = list.findIndex((m) => m.id === dropped.id)
		if (idx >= 0) {
			list.splice(idx, 1)
			log.info("Evicted memory", { id: dropped.id })
		}
	}
	cache = list
}

// ============================================================
// Search helpers
// ============================================================

const STOPWORDS = new Set([
	"a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
	"has", "have", "i", "in", "is", "it", "of", "on", "or", "that",
	"the", "this", "to", "was", "were", "will", "with", "you", "your",
	"my", "we", "they", "them", "their", "but", "not", "so", "if",
	"me", "do", "does", "did", "would", "should", "could", "can",
])

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.split(/\s+/)
		.filter((t) => t.length >= 2 && !STOPWORDS.has(t))
}

function scoreMemory(memory: Memory, queryTokens: string[]): number {
	if (queryTokens.length === 0) return 0
	const contentTokens = new Set(tokenize(memory.content))
	const tagTokens = new Set(memory.tags.map((t) => t.toLowerCase()))

	const querySet = new Set(queryTokens)
	let score = 0

	for (const qt of querySet) {
		if (contentTokens.has(qt)) score += 2
		if (tagTokens.has(qt)) score += 3
		// Substring match inside content (handles "transactions" matching "transaction")
		const m = memory.content.toLowerCase()
		let from = 0
		while (true) {
			const idx = m.indexOf(qt, from)
			if (idx < 0) break
			score += 1
			from = idx + qt.length
		}
	}

	if (memory.category) {
		for (const qt of querySet) {
			if (memory.category.includes(qt)) score += 1
		}
	}

	// Recency tiebreaker — memories touched in the last 7 days get a small boost.
	if (memory.lastUsedAt && Date.now() - memory.lastUsedAt < 7 * 24 * 3600 * 1000) {
		score += 0.5
	}

	return score
}

// ============================================================
// Public API
// ============================================================

/** List all memories, newest first. */
export function listMemories(): Memory[] {
	return [...load()].sort((a, b) => b.createdAt - a.createdAt)
}

/** Get a single memory by id. */
export function getMemory(id: string): Memory | null {
	return load().find((m) => m.id === id) ?? null
}

/** Store a new memory. Returns the persisted memory. */
export function storeMemory(input: MemoryInput): Memory {
	const list = load()
	const content = (input.content ?? "").trim()
	if (!content) throw new Error("Memory content cannot be empty")

	const memory: Memory = {
		id: randomUUID(),
		content: content.slice(0, 4000),
		category: input.category ?? "note",
		tags: (input.tags ?? []).slice(0, 16).map((t) => t.slice(0, 64)),
		source: input.source ?? "user",
		createdAt: Date.now(),
		lastUsedAt: null,
		useCount: 0,
	}

	list.push(memory)
	cache = list
	enforceCap()
	persist()
	log.info("Stored memory", {
		id: memory.id,
		category: memory.category,
		length: memory.content.length,
	})
	return memory
}

/** Update an existing memory. Returns the updated memory or null if not found. */
export function updateMemory(
	id: string,
	patch: Partial<Pick<Memory, "content" | "category" | "tags">>,
): Memory | null {
	const list = load()
	const idx = list.findIndex((m) => m.id === id)
	if (idx < 0) return null
	const prev = list[idx]
	const next: Memory = {
		...prev,
		content: patch.content?.trim() ? patch.content.slice(0, 4000) : prev.content,
		category: patch.category ?? prev.category,
		tags: patch.tags
			? patch.tags.slice(0, 16).map((t) => t.slice(0, 64))
			: prev.tags,
	}
	list[idx] = next
	cache = list
	persist()
	log.info("Updated memory", { id })
	return next
}

/** Delete a single memory. */
export function deleteMemory(id: string): boolean {
	const list = load()
	const idx = list.findIndex((m) => m.id === id)
	if (idx < 0) return false
	list.splice(idx, 1)
	cache = list
	persist()
	log.info("Deleted memory", { id })
	return true
}

/** Clear all memories. */
export function clearMemories(): void {
	cache = []
	persist()
	log.info("Cleared all memories")
}

/**
 * Search memories by relevance to a query string. Returns up to `limit`
 * matches with non-zero scores, sorted by score (desc) then recency (desc).
 *
 * Side effect: increments `useCount` and updates `lastUsedAt` on returned hits.
 */
export function searchMemories(query: string, limit = 5): ScoredMemory[] {
	const qTokens = tokenize(query ?? "")
	if (qTokens.length === 0) return []
	const list = load()

	const scored: ScoredMemory[] = []
	for (const m of list) {
		const score = scoreMemory(m, qTokens)
		if (score > 0) scored.push({ memory: m, score })
	}

	scored.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score
		return b.memory.createdAt - a.memory.createdAt
	})

	const top = scored.slice(0, limit)

	// Bump usage stats on returned hits (best-effort; not transactional).
	if (top.length > 0) {
		const now = Date.now()
		for (const { memory } of top) {
			const idx = list.findIndex((m) => m.id === memory.id)
			if (idx >= 0) {
				list[idx] = {
					...list[idx],
					useCount: list[idx].useCount + 1,
					lastUsedAt: now,
				}
			}
		}
		cache = list
		persist()
	}

	return top
}

/** Aggregate stats: total + per-category counts. */
export function memoryStats(): MemoryStats {
	const list = load()
	const byCategory: Record<MemoryCategory, number> = {
		preference: 0,
		fact: 0,
		project: 0,
		note: 0,
		feedback: 0,
	}
	for (const m of list) {
		byCategory[m.category] = (byCategory[m.category] ?? 0) + 1
	}
	return { total: list.length, byCategory }
}
