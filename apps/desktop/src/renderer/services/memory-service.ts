/**
 * Service layer for the Long-Term Memory feature — thin wrapper over the IPC
 * API that also keeps the Jotai list/stats atoms in sync via optimistic
 * mutations and the `memory:changed` broadcast event.
 */

import { getDefaultStore } from "jotai"
import type { Memory, MemoryInput, MemoryStats, ScoredMemory } from "../../preload/api"
import {
	memoriesListAtom,
	memoriesLoadingAtom,
	memoriesOptimisticAppendAtom,
	memoriesOptimisticClearAtom,
	memoriesOptimisticRemoveAtom,
	memoriesOptimisticReplaceAtom,
	memoriesOptimisticSetStatsAtom,
	memoryRecallQueryAtom,
	memoryRecallResultsAtom,
	memoryRecallingAtom,
} from "../atoms/memory"
import { isElectron } from "./backend"

const store = getDefaultStore()

// ============================================================
// One-time subscription to main-process change events
// ============================================================

let subscribed = false

function ensureSubscribed(): void {
	if (subscribed) return
	if (!isElectron) return
	subscribed = true
	window.infinitecode.memory.onChanged(() => {
		refreshMemories().catch(() => {
			/* error already logged */
		})
		refreshMemoryStats().catch(() => {
			/* error already logged */
		})
	})
}

// ============================================================
// Public API
// ============================================================

export async function refreshMemories(): Promise<Memory[]> {
	ensureSubscribed()
	if (!isElectron) return []
	store.set(memoriesLoadingAtom, true)
	try {
		const list = await window.infinitecode.memory.list()
		store.set(memoriesListAtom, list ?? [])
		return list ?? []
	} finally {
		store.set(memoriesLoadingAtom, false)
	}
}

export async function refreshMemoryStats(): Promise<MemoryStats | null> {
	ensureSubscribed()
	if (!isElectron) return null
	const stats = await window.infinitecode.memory.stats()
	store.set(memoriesOptimisticSetStatsAtom, stats)
	return stats
}

export async function storeMemory(input: MemoryInput): Promise<Memory | null> {
	ensureSubscribed()
	if (!isElectron) return null
	const result = await window.infinitecode.memory.store(input)
	store.set(memoriesOptimisticAppendAtom, result)
	// Refresh stats since category counts may have changed.
	refreshMemoryStats().catch(() => {
		/* ignored */
	})
	return result
}

export async function updateMemory(
	id: string,
	patch: { content?: string; category?: Memory["category"]; tags?: string[] },
): Promise<Memory | null> {
	ensureSubscribed()
	if (!isElectron) return null
	const result = await window.infinitecode.memory.update(id, patch)
	if (result) {
		store.set(memoriesOptimisticReplaceAtom, result)
		refreshMemoryStats().catch(() => {
			/* ignored */
		})
	}
	return result
}

export async function deleteMemory(id: string): Promise<boolean> {
	ensureSubscribed()
	if (!isElectron) return false
	store.set(memoriesOptimisticRemoveAtom, id)
	return window.infinitecode.memory.delete(id)
}

export async function clearMemories(): Promise<void> {
	ensureSubscribed()
	if (!isElectron) return
	store.set(memoriesOptimisticClearAtom)
	await window.infinitecode.memory.clear()
	refreshMemoryStats().catch(() => {
		/* ignored */
	})
}

/**
 * Search memories for relevance to a query. Returns top N (default 5).
 * Side effect: bumps `useCount` / `lastUsedAt` on returned hits (server-side).
 */
export async function recallMemories(
	query: string,
	limit = 5,
): Promise<ScoredMemory[]> {
	if (!isElectron) {
		store.set(memoryRecallQueryAtom, query)
		store.set(memoryRecallResultsAtom, [])
		return []
	}
	store.set(memoryRecallingAtom, true)
	store.set(memoryRecallQueryAtom, query)
	try {
		const results = await window.infinitecode.memory.search(query, limit)
		store.set(memoryRecallResultsAtom, results ?? [])
		return results ?? []
	} finally {
		store.set(memoryRecallingAtom, false)
	}
}
