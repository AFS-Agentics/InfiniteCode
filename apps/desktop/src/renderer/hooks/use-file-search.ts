/**
 * Hook for server-backed `@` reference file search in the composer.
 *
 * Uses connection-local `search/start` + `search/update` RPCs and listens for
 * `search/updated` / `search/completed` notifications. Replaces the legacy
 * `find.files` stub; debounce + cancel behavior matches the TUI composer.
 */
import { useEffect, useRef, useState } from "react"
import type { ReferenceSearchSnapshot } from "@devo-ai/sdk/v2/client"
import { getProjectClient } from "../services/connection-manager"

const FILE_SEARCH_DEBOUNCE_MS = 150

function filePathsFromSnapshot(snapshot: ReferenceSearchSnapshot): string[] {
	return snapshot.results
		.filter((result) => result.kind === "file")
		.map((result) => result.display_name)
		.filter((path) => path.trim().length > 0)
}

export function useFileSearch(directory: string | null, query: string, enabled = true) {
	const [debouncedQuery, setDebouncedQuery] = useState(query)
	const [files, setFiles] = useState<string[]>([])
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(() => {
		if (timerRef.current) clearTimeout(timerRef.current)
		timerRef.current = setTimeout(() => {
			setDebouncedQuery(query)
		}, FILE_SEARCH_DEBOUNCE_MS)
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current)
		}
	}, [query])

	useEffect(() => {
		if (!directory || !enabled) {
			setFiles([])
			setIsLoading(false)
			setError(null)
			return
		}

		const client = getProjectClient(directory)
		if (!client) {
			setFiles([])
			setIsLoading(false)
			setError(null)
			return
		}

		let cancelled = false
		const applySnapshot = (snapshot: ReferenceSearchSnapshot) => {
			if (cancelled) return
			setFiles(filePathsFromSnapshot(snapshot).slice(0, 20))
			setIsLoading(!snapshot.file_search_complete)
			setError(client.referenceSearch.getState().error)
		}

		const unsubscribe = client.referenceSearch.subscribe(applySnapshot)
		setIsLoading(true)
		setError(null)
		void client.referenceSearch.startOrUpdate({ query: debouncedQuery }).catch((searchError) => {
			if (cancelled) return
			setFiles([])
			setIsLoading(false)
			setError(searchError instanceof Error ? searchError.message : "file search failed")
		})

		return () => {
			cancelled = true
			unsubscribe()
			void client.referenceSearch.cancel()
		}
	}, [directory, debouncedQuery, enabled])

	return {
		files,
		isLoading,
		error,
	}
}
