/**
 * Web search settings page.
 *
 * Configure which search provider backs the `/search <query>` slash command:
 *   - DuckDuckGo (default, no API key needed; rate-limited / may break)
 *   - Brave Search API (opt-in, requires API key)
 *   - Tavily (opt-in, requires API key, designed for AI use cases)
 *
 * Includes a "live query" verification panel so users can confirm the
 * configuration works end-to-end before relying on it.
 */

import { Button } from "@infinitecode/ui/components/button"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@infinitecode/ui/components/select"
import { Switch } from "@infinitecode/ui/components/switch"
import { SearchIcon, SparklesIcon, TrashIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { isElectron } from "../../services/backend"
import { useSettings } from "../../hooks/use-settings"
import type {
	WebSearchProviderId,
	WebSearchResponse,
	WebSearchResultRow,
} from "../../../preload/api"
import { SettingsRow } from "./settings-row"
import { SettingsSection } from "./settings-section"

const PROVIDER_OPTIONS: { id: WebSearchProviderId; label: string; description: string }[] = [
	{
		id: "duckduckgo",
		label: "DuckDuckGo",
		description: "No API key required. Works out of the box.",
	},
	{
		id: "brave",
		label: "Brave Search",
		description: "Brave Search API. Requires an API key.",
	},
	{
		id: "tavily",
		label: "Tavily",
		description: "Tavily Search API. Designed for AI workflows.",
	},
]

export function WebSearchSettings() {
	const { settings, updateSettings } = useSettings()
	const webSearch = settings.webSearch ?? {
		enabled: false,
		defaultProvider: "duckduckgo" as WebSearchProviderId,
		braveApiKey: "",
		tavilyApiKey: "",
		maxResults: 5,
	}

	const updateWebSearch = useCallback(
		(patch: Partial<typeof webSearch>) => {
			updateSettings({ webSearch: { ...webSearch, ...patch } })
		},
		[updateSettings, webSearch],
	)

	const needsKey = webSearch.defaultProvider === "brave" || webSearch.defaultProvider === "tavily"

	return (
		<div className="space-y-8">
			<div className="flex items-center gap-2">
				<SearchIcon className="size-5 text-muted-foreground" aria-hidden="true" />
				<h2 className="text-xl font-semibold">Web search</h2>
			</div>

			<SettingsSection
				title="Provider"
				description="The provider used when you run /search in the chat composer."
			>
				<SettingsRow label="Enable web search">
					<Switch
						checked={webSearch.enabled}
						onCheckedChange={(enabled) => updateWebSearch({ enabled })}
					/>
				</SettingsRow>
				<SettingsRow label="Default provider">
					<Select
						value={webSearch.defaultProvider}
						onValueChange={(v) => {
							if (v !== null) updateWebSearch({ defaultProvider: v as WebSearchProviderId })
						}}
						items={Object.fromEntries(PROVIDER_OPTIONS.map((p) => [p.id, p.label]))}
					>
						<SelectTrigger className="min-w-[180px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{PROVIDER_OPTIONS.map((p) => (
								<SelectItem key={p.id} value={p.id}>
									{p.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingsRow>
				<SettingsRow label="Description">
					<p className="max-w-prose text-xs text-muted-foreground">
						{PROVIDER_OPTIONS.find((p) => p.id === webSearch.defaultProvider)?.description}
					</p>
				</SettingsRow>
				<SettingsRow label="Max results">
					<Select
						value={String(webSearch.maxResults)}
						onValueChange={(v) => {
							if (v === null) return
							const n = Number(v)
							if (Number.isFinite(n) && n >= 1 && n <= 10) {
								updateWebSearch({ maxResults: n })
							}
						}}
						items={{ "3": "3 results", "5": "5 results", "8": "8 results", "10": "10 results" }}
					>
						<SelectTrigger className="min-w-[140px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="3">3 results</SelectItem>
							<SelectItem value="5">5 results</SelectItem>
							<SelectItem value="8">8 results</SelectItem>
							<SelectItem value="10">10 results</SelectItem>
						</SelectContent>
					</Select>
				</SettingsRow>
			</SettingsSection>

			{webSearch.defaultProvider === "brave" && (
				<SettingsSection
					title="Brave API key"
					description="Stored locally in the main process settings file. Get a key at brave.com/search/api."
				>
					<ApiKeyField
						value={webSearch.braveApiKey}
						onChange={(v) => updateWebSearch({ braveApiKey: v })}
						placeholder="BSA..."
					/>
				</SettingsSection>
			)}

			{webSearch.defaultProvider === "tavily" && (
				<SettingsSection
					title="Tavily API key"
					description="Stored locally in the main process settings file. Get a key at tavily.com."
				>
					<ApiKeyField
						value={webSearch.tavilyApiKey}
						onChange={(v) => updateWebSearch({ tavilyApiKey: v })}
						placeholder="tvly-..."
					/>
				</SettingsSection>
			)}

			<SettingsSection
				title="Live query"
				description="Send a real query through the configured provider and preview the results. Helps confirm the API key works before relying on /search in the composer."
			>
				<LiveQuery
					provider={webSearch.defaultProvider}
					limit={webSearch.maxResults}
					disabled={!webSearch.enabled || (needsKey && !hasKey(webSearch, webSearch.defaultProvider))}
					disabledReason={
						!webSearch.enabled
							? "Enable web search first"
							: needsKey && !hasKey(webSearch, webSearch.defaultProvider)
								? `Enter a ${webSearch.defaultProvider === "brave" ? "Brave" : "Tavily"} API key first`
								: null
					}
				/>
			</SettingsSection>
		</div>
	)
}

function hasKey(
	settings: { braveApiKey: string; tavilyApiKey: string },
	provider: WebSearchProviderId,
): boolean {
	if (provider === "brave") return settings.braveApiKey.trim().length > 0
	if (provider === "tavily") return settings.tavilyApiKey.trim().length > 0
	return true // duckduckgo needs no key
}

function ApiKeyField({
	value,
	onChange,
	placeholder,
}: {
	value: string
	onChange: (next: string) => void
	placeholder: string
}) {
	const [draft, setDraft] = useState(value)
	const [editing, setEditing] = useState(false)

	useEffect(() => {
		if (!editing) setDraft(value)
	}, [value, editing])

	return (
		<div className="space-y-2 px-4 py-3">
			<input
				type="password"
				value={draft}
				placeholder={placeholder}
				onChange={(e) => {
					setDraft(e.target.value)
					setEditing(true)
				}}
				className="w-full rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs focus:border-ring focus:outline-none"
			/>
			<div className="flex items-center gap-2">
				<Button
					size="sm"
					variant="outline"
					onClick={() => {
						onChange(draft)
						setEditing(false)
						toast.success("API key saved")
					}}
					disabled={draft === value}
				>
					Save
				</Button>
				{value && (
					<Button
						size="sm"
						variant="ghost"
						onClick={() => {
							onChange("")
							setDraft("")
							setEditing(false)
							toast.success("API key cleared")
						}}
					>
						<TrashIcon className="size-3" aria-hidden="true" />
						Clear
					</Button>
				)}
			</div>
		</div>
	)
}

function LiveQuery({
	provider,
	limit,
	disabled,
	disabledReason,
}: {
	provider: WebSearchProviderId
	limit: number
	disabled: boolean
	disabledReason: string | null
}) {
	const [query, setQuery] = useState("")
	const [results, setResults] = useState<WebSearchResultRow[] | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [running, setRunning] = useState(false)
	const mountedRef = useRef(true)

	useEffect(() => {
		return () => {
			mountedRef.current = false
		}
	}, [])

	const runQuery = useCallback(async () => {
		if (!isElectron) {
			setError("Web search is only available in Electron mode.")
			return
		}
		const trimmed = query.trim()
		if (!trimmed) return
		setRunning(true)
		setError(null)
		setResults(null)
		try {
			const resp: WebSearchResponse = await window.infinitecode.webSearch.query(
				provider,
				trimmed,
				limit,
			)
			if (!mountedRef.current) return
			if (resp.ok) {
				setResults(resp.results)
			} else {
				setError(resp.message)
			}
		} catch (err) {
			if (!mountedRef.current) return
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			if (mountedRef.current) setRunning(false)
		}
	}, [provider, query, limit])

	return (
		<div className="space-y-3 px-4 py-3">
			<div className="flex items-center gap-2">
				<input
					type="text"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="e.g. latest news on AI coding assistants"
					onKeyDown={(e) => {
						if (e.key === "Enter" && !running && !disabled) {
							e.preventDefault()
							runQuery()
						}
					}}
					className="min-w-[200px] flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-ring focus:outline-none"
				/>
				<Button
					size="sm"
					onClick={runQuery}
					disabled={running || disabled || !query.trim()}
				>
					<SparklesIcon className="size-3.5" aria-hidden="true" />
					{running ? "Searching…" : "Search"}
				</Button>
			</div>
			{disabledReason && (
				<div className="text-[11px] text-muted-foreground">{disabledReason}</div>
			)}
			{error && (
				<div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">
					{error}
				</div>
			)}
			{results && results.length === 0 && !error && (
				<div className="text-xs text-muted-foreground">No results.</div>
			)}
			{results && results.length > 0 && (
				<ul className="space-y-2">
					{results.map((row, idx) => (
						<li
							key={`${row.url}-${idx}`}
							className="rounded border border-border/40 bg-muted/30 px-3 py-2"
						>
							<a
								href={row.url}
								target="_blank"
								rel="noreferrer noopener"
								className="text-xs font-medium text-foreground hover:underline"
							>
								{row.title}
							</a>
							<div className="mt-0.5 text-[10px] text-muted-foreground/70">
								{row.source}
							</div>
							<p className="mt-1 text-xs leading-relaxed text-foreground/80">
								{row.snippet}
							</p>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
