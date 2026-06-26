import type {
	WorkspaceChangeCoverage,
	WorkspaceChangeScope,
	WorkspaceChangeSetStatus,
	WorkspaceChangeView,
	WorkspaceChangeViewStatus,
	WorkspaceChangesUpdatedEventProperties,
} from "@devo-ai/sdk/v2/client"
import { atom } from "jotai"
import { atomFamily } from "jotai/utils"

export type WorkspaceChangesCacheKeyInput = {
	sessionId: string
	scope: WorkspaceChangeScope
	turnId?: string | null
	baseBranch?: string | null
}

export type WorkspaceChangesSummary = {
	sessionId: string
	turnId: string
	scope: WorkspaceChangeScope
	status: WorkspaceChangeViewStatus
	coverage: WorkspaceChangeCoverage
	changeSetStatus: WorkspaceChangeSetStatus
	stats: {
		files_changed: number
		additions: number
		deletions: number
	}
	version: number
	generatedAt: string
}

export type WorkspaceChangesState = {
	summary: WorkspaceChangesSummary | null
	view: WorkspaceChangeView | null
	loading: boolean
	stale: boolean
	error: string | null
}

export function workspaceChangesKey(input: WorkspaceChangesCacheKeyInput): string {
	return [
		input.sessionId,
		input.scope,
		input.turnId ?? "",
		input.baseBranch ?? "",
	].join("\u001f")
}

function emptyWorkspaceChangesState(): WorkspaceChangesState {
	return {
		summary: null,
		view: null,
		loading: false,
		stale: true,
		error: null,
	}
}

function eventSummary(event: WorkspaceChangesUpdatedEventProperties): WorkspaceChangesSummary {
	return {
		sessionId: event.sessionID,
		turnId: event.turnID,
		scope: event.scope,
		status: event.status,
		coverage: event.coverage,
		changeSetStatus: event.changeSetStatus,
		stats: {
			files_changed: event.stats.filesChanged,
			additions: event.stats.additions,
			deletions: event.stats.deletions,
		},
		version: event.version,
		generatedAt: event.generatedAt,
	}
}

export const latestWorkspaceTurnIdFamily = atomFamily((_sessionId: string) =>
	atom<string | null>(null),
)

export const workspaceChangesStateFamily = atomFamily((_key: string) =>
	atom<WorkspaceChangesState>(emptyWorkspaceChangesState()),
)

export const markWorkspaceChangesLoadingAtom = atom(
	null,
	(get, set, args: { key: string; loading: boolean; error?: string | null }) => {
		const current = get(workspaceChangesStateFamily(args.key))
		set(workspaceChangesStateFamily(args.key), {
			...current,
			loading: args.loading,
			error: args.error === undefined ? current.error : args.error,
		})
	},
)

export const setWorkspaceChangesViewAtom = atom(
	null,
	(_get, set, args: { key: string; view: WorkspaceChangeView }) => {
		set(workspaceChangesStateFamily(args.key), {
			summary: null,
			view: args.view,
			loading: false,
			stale: false,
			error: null,
		})
	},
)

export const setWorkspaceChangesErrorAtom = atom(
	null,
	(get, set, args: { key: string; error: string }) => {
		const current = get(workspaceChangesStateFamily(args.key))
		set(workspaceChangesStateFamily(args.key), {
			...current,
			loading: false,
			error: args.error,
		})
	},
)

export const applyWorkspaceChangesUpdatedAtom = atom(
	null,
	(get, set, event: WorkspaceChangesUpdatedEventProperties) => {
		const summary = eventSummary(event)
		if (event.scope === "turn") {
			set(latestWorkspaceTurnIdFamily(event.sessionID), event.turnID)
		}
		const key = workspaceChangesKey({
			sessionId: event.sessionID,
			scope: event.scope,
			turnId: event.scope === "turn" ? event.turnID : undefined,
		})
		const current = get(workspaceChangesStateFamily(key))
		set(workspaceChangesStateFamily(key), {
			...current,
			summary,
			stale: true,
			error: null,
		})
	},
)
