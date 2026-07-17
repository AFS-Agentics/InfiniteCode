/**
 * Atoms for the Long-Term Memory feature — persistent facts/preferences the
 * agent should remember across sessions.
 */

import { atom } from "jotai"
import type { Memory, MemoryCategory, MemoryStats, ScoredMemory } from "../../preload/api"

// ============================================================
// Filter / view state
// ============================================================

/** Currently selected category filter (null = all). */
export const memoryCategoryFilterAtom = atom<MemoryCategory | null>(null)

/** Currently typed search query for the settings list view. */
export const memorySearchQueryAtom = atom<string>("")

/** Free-text new-memory draft in the settings page composer. */
export const memoryNewDraftAtom = atom<{
	content: string
	category: MemoryCategory
	tags: string
}>({
	content: "",
	category: "note",
	tags: "",
})

// ============================================================
// Ephemeral state
// ============================================================

/** Full list of memories (loaded via the IPC service). */
export const memoriesListAtom = atom<Memory[]>([])

/** Aggregated stats: total + byCategory counts. */
export const memoryStatsAtom = atom<MemoryStats>({
	total: 0,
	byCategory: { preference: 0, fact: 0, project: 0, note: 0, feedback: 0 },
})

/** Most recent recall results (set by useMemoryRecall). */
export const memoryRecallResultsAtom = atom<ScoredMemory[]>([])

/** Last query that produced the current recallResults. */
export const memoryRecallQueryAtom = atom<string>("")

/** True while a recall is in flight. */
export const memoryRecallingAtom = atom<boolean>(false)

/** True while the initial list load is in flight. */
export const memoriesLoadingAtom = atom<boolean>(false)

// ============================================================
// Optimistic mutations
// ============================================================

export const memoriesOptimisticAppendAtom = atom(null, (_get, set, memory: Memory) => {
	set(memoriesListAtom, (prev) => {
		const filtered = prev.filter((m) => m.id !== memory.id)
		return [memory, ...filtered].sort((a, b) => b.createdAt - a.createdAt)
	})
})

export const memoriesOptimisticReplaceAtom = atom(null, (_get, set, memory: Memory) => {
	set(memoriesListAtom, (prev) => prev.map((m) => (m.id === memory.id ? memory : m)))
})

export const memoriesOptimisticRemoveAtom = atom(null, (_get, set, id: string) => {
	set(memoriesListAtom, (prev) => prev.filter((m) => m.id !== id))
})

export const memoriesOptimisticClearAtom = atom(null, (_get, set) => {
	set(memoriesListAtom, [])
	set(memoryStatsAtom, {
		total: 0,
		byCategory: { preference: 0, fact: 0, project: 0, note: 0, feedback: 0 },
	})
})

export const memoriesOptimisticSetStatsAtom = atom(null, (_get, set, stats: MemoryStats) => {
	set(memoryStatsAtom, stats)
})

// ============================================================
// Derived atoms
// ============================================================

/** Filtered list of memories for the settings page view. */
export const memoriesFilteredAtom = atom((get) => {
	const list = get(memoriesListAtom)
	const filter = get(memoryCategoryFilterAtom)
	const query = get(memorySearchQueryAtom).trim().toLowerCase()
	let result = list
	if (filter) result = result.filter((m) => m.category === filter)
	if (query) {
		result = result.filter(
			(m) =>
				m.content.toLowerCase().includes(query) ||
				m.tags.some((t) => t.toLowerCase().includes(query)),
		)
	}
	return result
})
