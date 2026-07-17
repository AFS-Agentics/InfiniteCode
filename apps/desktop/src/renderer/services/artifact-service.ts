/**
 * Service layer for the Artifact System — thin wrapper over the IPC API that
 * also keeps the Jotai list atom in sync via optimistic mutations and the
 * `artifact:changed` broadcast event.
 */

import { isElectron } from "./backend"
import {
	artifactsListAtom,
	artifactsLoadingAtom,
	artifactsOptimisticAppendAtom,
	artifactsOptimisticClearAtom,
	artifactsOptimisticRemoveAtom,
} from "../atoms/artifacts"
import { getDefaultStore } from "jotai"
import type { Artifact, ArtifactInput } from "../../preload/api"

const store = getDefaultStore()

// ============================================================
// One-time subscription to main-process change events
// ============================================================

let subscribed = false

function ensureSubscribed(): void {
	if (subscribed) return
	if (!isElectron) return
	subscribed = true
	window.infinitecode.artifact.onChanged(() => {
		// Cheap: just re-list and replace atom contents.
		refreshArtifacts().catch(() => {
			/* error already logged */
		})
	})
}

// ============================================================
// Public API
// ============================================================

export async function refreshArtifacts(): Promise<Artifact[]> {
	ensureSubscribed()
	if (!isElectron) return []
	store.set(artifactsLoadingAtom, true)
	try {
		const list = await window.infinitecode.artifact.list()
		store.set(artifactsListAtom, list ?? [])
		return list ?? []
	} finally {
		store.set(artifactsLoadingAtom, false)
	}
}

export async function getArtifact(id: string): Promise<Artifact | null> {
	if (!isElectron) return null
	return window.infinitecode.artifact.get(id)
}

export async function storeArtifact(input: ArtifactInput): Promise<Artifact | null> {
	ensureSubscribed()
	if (!isElectron) return null
	const result = await window.infinitecode.artifact.store(input)
	// Optimistic update; main process also broadcasts `artifact:changed` but
	// we don't want to wait for the round-trip to update the UI.
	store.set(artifactsOptimisticAppendAtom, result)
	return result
}

export async function deleteArtifact(id: string): Promise<boolean> {
	ensureSubscribed()
	if (!isElectron) return false
	store.set(artifactsOptimisticRemoveAtom, id)
	return window.infinitecode.artifact.delete(id)
}

export async function clearArtifacts(): Promise<void> {
	ensureSubscribed()
	if (!isElectron) return
	store.set(artifactsOptimisticClearAtom)
	await window.infinitecode.artifact.clear()
}
