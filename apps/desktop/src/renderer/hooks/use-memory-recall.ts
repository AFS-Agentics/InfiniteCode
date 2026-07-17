/**
 * Auto-recall hook — debounced relevance search over stored memories.
 *
 * Use this anywhere you need to surface relevant memories before sending
 * a prompt or while rendering context. The hook returns the current recall
 * results and a `recall(query)` function that triggers a debounced search.
 */

import { useAtomValue } from "jotai"
import { useCallback, useEffect, useRef, useState } from "react"
import {
	memoryRecallQueryAtom,
	memoryRecallResultsAtom,
	memoryRecallingAtom,
} from "../atoms/memory"
import { recallMemories } from "../services/memory-service"
import type { ScoredMemory } from "../../preload/api"

interface UseMemoryRecallResult {
	query: string
	results: ScoredMemory[]
	loading: boolean
	recall: (query: string) => void
	clear: () => void
}

const DEFAULT_DEBOUNCE_MS = 250

export function useMemoryRecall(debounceMs = DEFAULT_DEBOUNCE_MS): UseMemoryRecallResult {
	const query = useAtomValue(memoryRecallQueryAtom)
	const results = useAtomValue(memoryRecallResultsAtom)
	const loading = useAtomValue(memoryRecallingAtom)
	const [pendingQuery, setPendingQuery] = useState<string | null>(null)
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

	const recall = useCallback(
		(next: string) => {
			setPendingQuery(next)
			if (timer.current) clearTimeout(timer.current)
			timer.current = setTimeout(() => {
				const q = next.trim()
				if (!q) {
					recallMemories("", 0).catch(() => {})
					return
				}
				recallMemories(q, 5).catch(() => {})
			}, debounceMs)
		},
		[debounceMs],
	)

	const clear = useCallback(() => {
		setPendingQuery(null)
		if (timer.current) clearTimeout(timer.current)
		recallMemories("", 0).catch(() => {})
	}, [])

	// Best-effort cleanup on unmount.
	useEffect(() => {
		return () => {
			if (timer.current) clearTimeout(timer.current)
		}
	}, [])

	// Touch pendingQuery so React knows we used it (lint hint, no semantic
	// change — the actual recall is dispatched inside the timer).
	void pendingQuery

	return { query, results, loading, recall, clear }
}
