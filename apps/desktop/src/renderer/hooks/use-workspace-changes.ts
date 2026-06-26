import type { WorkspaceChangeScope, WorkspaceChangeView } from "@devo-ai/sdk/v2/client"
import { useAtomValue, useSetAtom } from "jotai"
import { useCallback, useEffect, useMemo } from "react"
import { isMockModeAtom } from "../atoms/mock-mode"
import {
	latestWorkspaceTurnIdFamily,
	markWorkspaceChangesLoadingAtom,
	setWorkspaceChangesErrorAtom,
	setWorkspaceChangesViewAtom,
	workspaceChangesKey,
	workspaceChangesStateFamily,
} from "../atoms/workspace-changes"
import { getProjectClient } from "../services/connection-manager"
import { getWorkspaceChanges } from "../services/devo"

const FULL_DIFF_LIMIT_BYTES = 2_000_000

export function useWorkspaceChanges(
	sessionId: string,
	directory: string,
	scope: WorkspaceChangeScope,
	options: { enabled?: boolean; baseBranch?: string | null } = {},
) {
	const latestTurnId = useAtomValue(latestWorkspaceTurnIdFamily(sessionId))
	const turnId = scope === "turn" ? latestTurnId : undefined
	const key = useMemo(
		() =>
			workspaceChangesKey({
				sessionId,
				scope,
				turnId: turnId ?? undefined,
				baseBranch: options.baseBranch,
			}),
		[sessionId, scope, turnId, options.baseBranch],
	)
	const state = useAtomValue(workspaceChangesStateFamily(key))
	const markLoading = useSetAtom(markWorkspaceChangesLoadingAtom)
	const setView = useSetAtom(setWorkspaceChangesViewAtom)
	const setError = useSetAtom(setWorkspaceChangesErrorAtom)
	const isMockMode = useAtomValue(isMockModeAtom)
	const enabled = options.enabled ?? true

	const fetchChanges = useCallback(async () => {
		if (isMockMode) return
		const client = getProjectClient(directory)
		if (!client) return
		markLoading({ key, loading: true, error: null })
		try {
			const result = await getWorkspaceChanges(client, {
				sessionId,
				scopes: [scope],
				baseBranch: options.baseBranch ?? undefined,
				turnId: turnId ?? undefined,
				diffDetail: "full",
				maxDiffBytes: FULL_DIFF_LIMIT_BYTES,
			})
			const view = result.views.find((item) => item.scope === scope) as
				| WorkspaceChangeView
				| undefined
			if (view) {
				setView({ key, view })
			} else {
				setError({ key, error: "Workspace change view missing from response" })
			}
		} catch (error) {
			setError({
				key,
				error: error instanceof Error ? error.message : "Failed to load workspace changes",
			})
		}
	}, [
		directory,
		isMockMode,
		key,
		markLoading,
		options.baseBranch,
		scope,
		sessionId,
		setError,
		setView,
		turnId,
	])

	useEffect(() => {
		if (!enabled) return
		if (!state.view || state.stale) void fetchChanges()
	}, [enabled, fetchChanges, state.stale, state.view])

	return {
		...state,
		key,
		latestTurnId,
		refetch: fetchChanges,
	}
}
