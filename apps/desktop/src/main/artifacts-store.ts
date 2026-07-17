/**
 * Artifact store — persists tool outputs / file snapshots / fetched content
 * that the user has chosen to keep for later reference.
 *
 * Backed by a single JSON file at `app.getPath('userData')/artifacts.json`
 * to avoid pulling in a new database dependency for v1.
 *
 * Caps:
 *   - 500 artifacts total (FIFO eviction when exceeded)
 *   - 10 MB total content size on disk
 *   - 512 KB per individual artifact
 *
 * Threading: this module is only used from the Electron main process. The
 * store is a module-scoped singleton that loads lazily on first access.
 */

import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { app } from "electron"
import { createLogger } from "./logger"

const log = createLogger("artifacts-store")

// ============================================================
// Schema
// ============================================================

export type ArtifactKind =
	| "code"
	| "diff"
	| "text"
	| "json"
	| "image"
	| "html"
	| "bash"
	| "file"
	| "log"

export interface Artifact {
	id: string
	sessionId: string | null
	turnId: string | null
	toolCallId: string | null
	kind: ArtifactKind
	title: string
	subtitle: string | null
	content: string
	language: string | null
	mime: string | null
	sizeBytes: number
	createdAt: number
	source: "tool" | "user" | "auto"
	tags: string[]
}

export interface ArtifactInput {
	sessionId?: string | null
	turnId?: string | null
	toolCallId?: string | null
	kind: ArtifactKind
	title: string
	subtitle?: string | null
	content: string
	language?: string | null
	mime?: string | null
	source?: Artifact["source"]
	tags?: string[]
}

interface PersistedFile {
	version: 1
	artifacts: Artifact[]
}

// ============================================================
// Constants
// ============================================================

const MAX_ARTIFACT_COUNT = 500
const MAX_TOTAL_BYTES = 10 * 1024 * 1024 // 10 MB
const MAX_ARTIFACT_BYTES = 512 * 1024 // 512 KB

const FILE_NAME = "artifacts.json"

// ============================================================
// Module-scope state
// ============================================================

let cache: Artifact[] | null = null

function filePath(): string {
	return join(app.getPath("userData"), FILE_NAME)
}

function load(): Artifact[] {
	if (cache) return cache
	try {
		const p = filePath()
		if (!existsSync(p)) {
			cache = []
			return cache
		}
		const raw = readFileSync(p, "utf8")
		const parsed = JSON.parse(raw) as PersistedFile
		cache = Array.isArray(parsed?.artifacts) ? parsed.artifacts : []
	} catch (err) {
		log.warn("Failed to load artifacts, starting empty", err)
		cache = []
	}
	return cache
}

function persist(): void {
	try {
		const p = filePath()
		const dir = dirname(p)
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
		const payload: PersistedFile = { version: 1, artifacts: cache ?? [] }
		writeFileSync(p, JSON.stringify(payload, null, 2), "utf8")
	} catch (err) {
		log.error("Failed to persist artifacts", err)
	}
}

function totalBytes(list: Artifact[]): number {
	let n = 0
	for (const a of list) n += a.sizeBytes
	return n
}

/**
 * Enforce the size/count caps by evicting oldest artifacts (FIFO by createdAt)
 * until the new artifact fits.
 */
function evictForNew(incomingSize: number): void {
	if (!cache) return
	const list = cache

	// Single artifact too large → reject at store-time, not evict-time.
	if (incomingSize > MAX_ARTIFACT_BYTES) {
		throw new Error(
			`Artifact exceeds max size (${MAX_ARTIFACT_BYTES} bytes); got ${incomingSize}`,
		)
	}

	// Sort by createdAt ascending so we evict oldest first when we trim.
	const sorted = [...list].sort((a, b) => a.createdAt - b.createdAt)

	while (
		sorted.length >= MAX_ARTIFACT_COUNT ||
		totalBytes(sorted) + incomingSize > MAX_TOTAL_BYTES
	) {
		if (sorted.length === 0) break
		const dropped = sorted.shift()
		if (!dropped) break
		const idx = list.findIndex((a) => a.id === dropped.id)
		if (idx >= 0) list.splice(idx, 1)
		log.info("Evicted artifact", { id: dropped.id, title: dropped.title })
	}

	cache = list
}

// ============================================================
// Public API
// ============================================================

/** List all artifacts, newest first. */
export function listArtifacts(): Artifact[] {
	return [...load()].sort((a, b) => b.createdAt - a.createdAt)
}

/** Get a single artifact by id. */
export function getArtifact(id: string): Artifact | null {
	return load().find((a) => a.id === id) ?? null
}

/** Store a new artifact. Returns the persisted artifact with id + sizeBytes. */
export function storeArtifact(input: ArtifactInput): Artifact {
	const list = load()
	const content = input.content ?? ""
	const sizeBytes = Buffer.byteLength(content, "utf8")

	evictForNew(sizeBytes)

	const artifact: Artifact = {
		id: randomUUID(),
		sessionId: input.sessionId ?? null,
		turnId: input.turnId ?? null,
		toolCallId: input.toolCallId ?? null,
		kind: input.kind,
		title: input.title.trim().slice(0, 200) || "(untitled)",
		subtitle: input.subtitle ? input.subtitle.slice(0, 500) : null,
		content,
		language: input.language ?? null,
		mime: input.mime ?? null,
		sizeBytes,
		createdAt: Date.now(),
		source: input.source ?? "user",
		tags: (input.tags ?? []).slice(0, 16).map((t) => t.slice(0, 64)),
	}

	list.push(artifact)
	cache = list
	persist()
	log.info("Stored artifact", {
		id: artifact.id,
		kind: artifact.kind,
		sizeBytes: artifact.sizeBytes,
		title: artifact.title,
	})
	return artifact
}

/** Delete a single artifact. */
export function deleteArtifact(id: string): boolean {
	const list = load()
	const idx = list.findIndex((a) => a.id === id)
	if (idx < 0) return false
	list.splice(idx, 1)
	cache = list
	persist()
	log.info("Deleted artifact", { id })
	return true
}

/** Clear all artifacts. */
export function clearArtifacts(): void {
	cache = []
	persist()
	log.info("Cleared all artifacts")
}
