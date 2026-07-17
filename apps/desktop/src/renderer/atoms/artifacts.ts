/**
 * Atoms for the Artifact System — right-side pane that holds saved tool
 * outputs / file snapshots / fetched content the user wants to keep.
 */

import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import type { Artifact } from "../../preload/api"

// ============================================================
// Persisted UI prefs
// ============================================================

/** Whether the artifact pane is open. Persisted to localStorage. */
export const artifactPaneOpenAtom = atomWithStorage<boolean>(
	"infinitecode:artifactPaneOpen",
	false,
)

/** Width of the artifact pane in pixels. Persisted. */
export const artifactPaneWidthAtom = atomWithStorage<number>(
	"infinitecode:artifactPaneWidth",
	420,
)

// ============================================================
// Ephemeral state
// ============================================================

/** Selected artifact id (the one currently shown in the pane). */
export const selectedArtifactIdAtom = atom<string | null>(null)

/** Full list of artifacts (loaded via the IPC service). */
export const artifactsListAtom = atom<Artifact[]>([])

/** Loading flag while a list refresh is in flight. */
export const artifactsLoadingAtom = atom<boolean>(false)

/** Optimistic add — appended to the list when a new artifact is stored. */
export const artifactsOptimisticAppendAtom = atom(null, (_get, set, artifact: Artifact) => {
	set(artifactsListAtom, (prev) => {
		// Dedupe by id (idempotent across windows).
		const filtered = prev.filter((a) => a.id !== artifact.id)
		return [artifact, ...filtered].sort((a, b) => b.createdAt - a.createdAt)
	})
})

/** Optimistic delete — removes an artifact from the list without a refetch. */
export const artifactsOptimisticRemoveAtom = atom(null, (_get, set, id: string) => {
	set(artifactsListAtom, (prev) => prev.filter((a) => a.id !== id))
})

/** Optimistic clear — empties the list. */
export const artifactsOptimisticClearAtom = atom(null, (_get, set) => {
	set(artifactsListAtom, [])
})

// ============================================================
// Derived atoms
// ============================================================

/** Selected artifact object (or null). */
export const selectedArtifactAtom = atom((get) => {
	const id = get(selectedArtifactIdAtom)
	if (!id) return null
	return get(artifactsListAtom).find((a) => a.id === id) ?? null
})

/** Total artifact count for badge display in the toolbar. */
export const artifactCountAtom = atom((get) => get(artifactsListAtom).length)
