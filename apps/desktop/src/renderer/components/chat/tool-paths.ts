export type ToolPathDisplayOptions = {
	projectRoot?: string | null
}

const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:\//

function normalizePathForDisplay(path: string): string {
	const normalized = path.trim().replace(/\\/g, "/").replace(/\/+/g, "/")
	if (normalized.length > 1) return normalized.replace(/\/+$/, "")
	return normalized
}

function isAbsolutePath(path: string): boolean {
	return WINDOWS_ABSOLUTE_PATH.test(path) || path.startsWith("/")
}

function stripProjectRoot(path: string, projectRoot: string): string | undefined {
	const normalizedRoot = normalizePathForDisplay(projectRoot)
	if (!normalizedRoot) return undefined

	const lowerPath = path.toLowerCase()
	const lowerRoot = normalizedRoot.toLowerCase()
	if (lowerPath === lowerRoot) return "."
	if (!lowerPath.startsWith(`${lowerRoot}/`)) return undefined

	return path.slice(normalizedRoot.length + 1)
}

export function shortenPathForDisplay(path: string | undefined): string | undefined {
	if (!path) return undefined
	const normalized = normalizePathForDisplay(path)
	if (!normalized) return undefined

	const parts = normalized.split("/").filter(Boolean)
	if (parts.length <= 2) return normalized
	return parts.slice(-2).join("/")
}

export function formatToolPathForDisplay(
	path: string | undefined,
	options: ToolPathDisplayOptions = {},
): string | undefined {
	if (!path) return undefined
	const normalized = normalizePathForDisplay(path)
	if (!normalized) return undefined
	if (!isAbsolutePath(normalized)) return normalized

	if (options.projectRoot) {
		const relativePath = stripProjectRoot(normalized, options.projectRoot)
		if (relativePath) return relativePath
	}

	return shortenPathForDisplay(normalized)
}

export function getFirstApplyPatchPath(patch: string | undefined): string | undefined {
	if (!patch) return undefined

	for (const line of patch.split(/\r?\n/)) {
		const applyPatchMatch = line.match(/^\*\*\* (?:Add|Update|Delete) File:\s+(.+)$/)
		if (applyPatchMatch?.[1]) return applyPatchMatch[1].trim()

		const gitDiffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
		if (gitDiffMatch?.[2]) return gitDiffMatch[2].trim()

		const fileHeaderMatch = line.match(/^(?:---|\+\+\+) [ab]\/(.+)$/)
		if (fileHeaderMatch?.[1] && fileHeaderMatch[1] !== "dev/null") {
			return fileHeaderMatch[1].trim()
		}
	}

	return undefined
}
