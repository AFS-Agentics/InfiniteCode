/**
 * Web Search service — provider abstraction over DuckDuckGo (default, no
 * API key required) and Brave/Tavily (API-key opt-in).
 *
 * - DuckDuckGo HTML scraping as a zero-config fallback. Works out of the box
 *   but is rate-limited and can break if DDG changes their markup.
 * - Brave Search API — opt-in, requires API key.
 * - Tavily Search API — opt-in, requires API key, designed for AI use cases.
 *
 * Results are normalized into a stable shape so the renderer doesn't have to
 * branch on provider. A small in-memory cache (TTL 5min, max 200 entries)
 * avoids hammering upstream APIs when the user re-runs the same slash
 * command.
 */

import { createHash } from "node:crypto"

// ============================================================
// Types
// ============================================================

export type WebSearchProviderId = "duckduckgo" | "brave" | "tavily"

export interface WebSearchResultRow {
	provider: WebSearchProviderId
	title: string
	url: string
	snippet: string
	source: string // hostname extracted from url
}

export type WebSearchErrorReason =
	| "invalid_query"
	| "not_configured"
	| "invalid_credentials"
	| "rate_limited"
	| "network_error"
	| "timeout"
	| "provider_error"
	| "unsupported_provider"

export type WebSearchResponse =
	| { ok: true; results: WebSearchResultRow[]; cached: boolean }
	| { ok: false; reason: WebSearchErrorReason; message: string }

// ============================================================
// Constants
// ============================================================

export const WEB_SEARCH_QUERY_MAX_CHARS = 200
export const WEB_SEARCH_DEFAULT_LIMIT = 5
export const WEB_SEARCH_MAX_LIMIT = 10

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 min
const CACHE_MAX_ENTRIES = 200
const PROVIDER_TIMEOUT_MS = 10_000

// ============================================================
// Cache
// ============================================================

interface CacheEntry {
	query: string
	provider: WebSearchProviderId
	limit: number
	results: WebSearchResultRow[]
	expiresAt: number
}

const cache = new Map<string, CacheEntry>()

function cacheKey(
	provider: WebSearchProviderId,
	query: string,
	limit: number,
): string {
	return createHash("sha256")
		.update(`${provider}|${limit}|${query}`)
		.digest("hex")
		.slice(0, 32)
}

function cacheGet(
	provider: WebSearchProviderId,
	query: string,
	limit: number,
): WebSearchResultRow[] | null {
	const key = cacheKey(provider, query, limit)
	const entry = cache.get(key)
	if (!entry) return null
	if (entry.expiresAt < Date.now()) {
		cache.delete(key)
		return null
	}
	return entry.results
}

function cacheSet(
	provider: WebSearchProviderId,
	query: string,
	limit: number,
	results: WebSearchResultRow[],
): void {
	if (cache.size >= CACHE_MAX_ENTRIES) {
		// Drop the oldest entry (FIFO).
		const oldestKey = cache.keys().next().value
		if (oldestKey) cache.delete(oldestKey)
	}
	cache.set(cacheKey(provider, query, limit), {
		query,
		provider,
		limit,
		results,
		expiresAt: Date.now() + CACHE_TTL_MS,
	})
}

// ============================================================
// Public API
// ============================================================

export function normalizeWebSearchQuery(raw: unknown): string | null {
	if (typeof raw !== "string") return null
	const trimmed = raw.trim()
	if (trimmed.length === 0) return null
	if (trimmed.length > WEB_SEARCH_QUERY_MAX_CHARS) {
		return trimmed.slice(0, WEB_SEARCH_QUERY_MAX_CHARS)
	}
	return trimmed
}

export function normalizeWebSearchLimit(raw: unknown): number {
	if (typeof raw !== "number" || !Number.isFinite(raw)) return WEB_SEARCH_DEFAULT_LIMIT
	const rounded = Math.trunc(raw)
	if (rounded < 1) return 1
	if (rounded > WEB_SEARCH_MAX_LIMIT) return WEB_SEARCH_MAX_LIMIT
	return rounded
}

export function isProviderId(value: unknown): value is WebSearchProviderId {
	return value === "duckduckgo" || value === "brave" || value === "tavily"
}

export interface QueryDeps {
	braveApiKey: string
	tavilyApiKey: string
	now?: () => number
}

/**
 * Run a web search using the specified provider.
 *
 * `provider === "duckduckgo"` always works (no API key needed).
 * `provider === "brave"` requires `deps.braveApiKey`.
 * `provider === "tavily"` requires `deps.tavilyApiKey`.
 */
export async function runWebSearch(
	provider: WebSearchProviderId,
	query: string,
	limit: number,
	deps: QueryDeps,
): Promise<WebSearchResponse> {
	const trimmed = normalizeWebSearchQuery(query)
	if (trimmed === null) {
		return { ok: false, reason: "invalid_query", message: "Enter a valid search query." }
	}
	const cappedLimit = normalizeWebSearchLimit(limit)

	// Cache hit short-circuit
	const cached = cacheGet(provider, trimmed, cappedLimit)
	if (cached) {
		return { ok: true, results: cached, cached: true }
	}

	let result: WebSearchResponse
	switch (provider) {
		case "duckduckgo":
			result = await queryDuckDuckGo(trimmed, cappedLimit)
			break
		case "brave":
			if (!deps.braveApiKey) {
				return {
					ok: false,
					reason: "not_configured",
					message: "Brave API key is not configured.",
				}
			}
			result = await queryBrave(trimmed, cappedLimit, deps.braveApiKey)
			break
		case "tavily":
			if (!deps.tavilyApiKey) {
				return {
					ok: false,
					reason: "not_configured",
					message: "Tavily API key is not configured.",
				}
			}
			result = await queryTavily(trimmed, cappedLimit, deps.tavilyApiKey)
			break
	}

	if (result.ok) cacheSet(provider, trimmed, cappedLimit, result.results)
	return result
}

// ============================================================
// Provider implementations
// ============================================================

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((_, reject) =>
			setTimeout(() => reject(new Error("timeout")), ms),
		),
	])
}

function hostFromUrl(rawUrl: string): string {
	try {
		return new URL(rawUrl).hostname.replace(/^www\./, "")
	} catch {
		return rawUrl
	}
}

function htmlUnescape(s: string): string {
	return s
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ")
}

/**
 * DuckDuckGo HTML lite endpoint — no API key required. Returns a stable,
 * minimal HTML page that's easy to scrape. Unofficial.
 *
 * Note: DDG may rate-limit or block headless scrapers. We send a desktop
 * User-Agent and request only the first page of results.
 */
async function queryDuckDuckGo(
	query: string,
	limit: number,
): Promise<WebSearchResponse> {
	const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
	try {
		const res = await withTimeout(
			fetch(url, {
				method: "GET",
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
					Accept: "text/html",
				},
			}),
			PROVIDER_TIMEOUT_MS,
		)
		if (!res.ok) {
			return {
				ok: false,
				reason: res.status === 429 ? "rate_limited" : "provider_error",
				message: `DuckDuckGo returned ${res.status}`,
			}
		}
		const html = await res.text()
		const results = parseDuckDuckGoHtml(html, limit)
		if (results.length === 0) {
			return {
				ok: false,
				reason: "provider_error",
				message: "DuckDuckGo returned no parseable results.",
			}
		}
		return { ok: true, results, cached: false }
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		return {
			ok: false,
			reason: message === "timeout" ? "timeout" : "network_error",
			message,
		}
	}
}

/**
 * Best-effort parser for DDG HTML lite. The markup is fairly stable but
 * not formally documented; we fall back to empty list on any deviation.
 */
function parseDuckDuckGoHtml(html: string, limit: number): WebSearchResultRow[] {
	const results: WebSearchResultRow[] = []
	// Each result is wrapped in <div class="result"> ... <a class="result__a" href="...">title</a> ... <a class="result__snippet">snippet</a>
	const blockRe = /<div[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g
	const titleRe = /<a[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/
	const snippetRe = /<a[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/

	let m: RegExpExecArray | null
	while ((m = blockRe.exec(html)) !== null && results.length < limit) {
		const block = m[1]
		const titleMatch = titleRe.exec(block)
		if (!titleMatch) continue
		const href = htmlUnescape(titleMatch[1])
		const titleRaw = titleMatch[2].replace(/<[^>]+>/g, "").trim()
		const title = htmlUnescape(titleRaw)
		const snippetMatch = snippetRe.exec(block)
		const snippetRaw = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, "") : ""
		const snippet = htmlUnescape(snippetRaw).trim()
		if (!href || !title) continue

		// DDG wraps destinations in a redirect; unwrap if present.
		let finalUrl = href
		try {
			const u = new URL(href)
			const uddg = u.searchParams.get("uddg")
			if (uddg) finalUrl = uddg
		} catch {
			// ignore
		}

		results.push({
			provider: "duckduckgo",
			title,
			url: finalUrl,
			snippet,
			source: hostFromUrl(finalUrl),
		})
	}

	return results
}

async function queryBrave(
	query: string,
	limit: number,
	apiKey: string,
): Promise<WebSearchResponse> {
	const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`
	try {
		const res = await withTimeout(
			fetch(url, {
				headers: {
					"X-Subscription-Token": apiKey,
					Accept: "application/json",
				},
			}),
			PROVIDER_TIMEOUT_MS,
		)
		if (res.status === 401 || res.status === 403) {
			return {
				ok: false,
				reason: "invalid_credentials",
				message: "Brave API rejected the key.",
			}
		}
		if (res.status === 429) {
			return { ok: false, reason: "rate_limited", message: "Brave rate limit hit." }
		}
		if (!res.ok) {
			return {
				ok: false,
				reason: "provider_error",
				message: `Brave returned ${res.status}`,
			}
		}
		const data = (await res.json()) as {
			web?: { results?: Array<{ title?: string; url?: string; description?: string }> }
		}
		const raw = data.web?.results ?? []
		const results: WebSearchResultRow[] = raw
			.filter((r) => typeof r.url === "string" && typeof r.title === "string")
			.slice(0, limit)
			.map((r) => ({
				provider: "brave" as const,
				title: r.title ?? "",
				url: r.url ?? "",
				snippet: r.description ?? "",
				source: hostFromUrl(r.url ?? ""),
			}))
		if (results.length === 0) {
			return {
				ok: false,
				reason: "provider_error",
				message: "Brave returned no results.",
			}
		}
		return { ok: true, results, cached: false }
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		return {
			ok: false,
			reason: message === "timeout" ? "timeout" : "network_error",
			message,
		}
	}
}

async function queryTavily(
	query: string,
	limit: number,
	apiKey: string,
): Promise<WebSearchResponse> {
	try {
		const res = await withTimeout(
			fetch("https://api.tavily.com/search", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({
					query,
					max_results: limit,
					include_answer: false,
					include_images: false,
				}),
			}),
			PROVIDER_TIMEOUT_MS,
		)
		if (res.status === 401 || res.status === 403) {
			return {
				ok: false,
				reason: "invalid_credentials",
				message: "Tavily API rejected the key.",
			}
		}
		if (res.status === 429) {
			return { ok: false, reason: "rate_limited", message: "Tavily rate limit hit." }
		}
		if (!res.ok) {
			return {
				ok: false,
				reason: "provider_error",
				message: `Tavily returned ${res.status}`,
			}
		}
		const data = (await res.json()) as {
			results?: Array<{ title?: string; url?: string; content?: string }>
		}
		const raw = data.results ?? []
		const results: WebSearchResultRow[] = raw
			.filter((r) => typeof r.url === "string" && typeof r.title === "string")
			.slice(0, limit)
			.map((r) => ({
				provider: "tavily" as const,
				title: r.title ?? "",
				url: r.url ?? "",
				snippet: r.content ?? "",
				source: hostFromUrl(r.url ?? ""),
			}))
		if (results.length === 0) {
			return {
				ok: false,
				reason: "provider_error",
				message: "Tavily returned no results.",
			}
		}
		return { ok: true, results, cached: false }
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		return {
			ok: false,
			reason: message === "timeout" ? "timeout" : "network_error",
			message,
		}
	}
}
