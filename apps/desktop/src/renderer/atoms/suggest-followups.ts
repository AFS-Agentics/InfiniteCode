import { atom } from "jotai"
import type { Agent } from "../lib/types"

// ============================================================
// Types
// ============================================================

/** Public shape of a single chip the user can click. */
export interface SuggestedFollowup {
	label: string
	prompt: string
	emoji?: string
}

/** The currently-displayed set of chips, kept in sync with the latest tool call. */
export interface ActiveFollowups {
	toolCallId: string | null
	turnId: string | null
	followups: SuggestedFollowup[]
	/** Per-toolCallId, which indices the user already clicked in this session. */
	clickedByToolCall: Map<string, Set<number>>
}

// ============================================================
// State atoms
// ============================================================

export const suggestedFollowupsAtom = atom<ActiveFollowups | null>(null)

/**
 * Toggle / set a click for a specific (toolCallId, index). Composed via
 * `atom()` so React components dispatch with a single call:
 *   `useSetAtom(toggleFollowupClickedAtom)({ toolCallId, index })`
 *
 * Reads `suggestedFollowupsAtom` and writes back an updated
 * `clickedByToolCall` map without mutating the existing structure.
 */
export const toggleFollowupClickedAtom = atom(
	null,
	(
		get,
		set,
		{ toolCallId, index }: { toolCallId: string | null; index: number },
	) => {
		const active = get(suggestedFollowupsAtom)
		if (!active) return
		const key = toolCallId ?? "*"
		const next = new Map(active.clickedByToolCall)
		const setForCall = new Set(next.get(key) ?? [])
		if (!setForCall.add(index)) return
		next.set(key, setForCall)
		set(suggestedFollowupsAtom, { ...active, clickedByToolCall: next })
	},
)
