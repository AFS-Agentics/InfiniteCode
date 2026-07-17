/**
 * Long-Term Memory settings page — list, search, category filter, edit, and
 * delete for stored memories. Plus a quick-add composer for adding new
 * memories.
 */

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@infinitecode/ui/components/select"
import { Button } from "@infinitecode/ui/components/button"
import { useAtomValue, useSetAtom } from "jotai"
import {
	BrainIcon,
	Loader2Icon,
	PlusIcon,
	SearchIcon,
	SparklesIcon,
	TrashIcon,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import {
	memoryCategoryFilterAtom,
	memoryNewDraftAtom,
	memorySearchQueryAtom,
	memoriesFilteredAtom,
	memoriesLoadingAtom,
	memoryStatsAtom,
} from "../../atoms/memory"
import {
	clearMemories,
	deleteMemory,
	recallMemories,
	refreshMemories,
	refreshMemoryStats,
	storeMemory,
	updateMemory,
} from "../../services/memory-service"
import type { Memory, MemoryCategory } from "../../../preload/api"
import { SettingsRow } from "./settings-row"
import { SettingsSection } from "./settings-section"

const CATEGORIES: { value: MemoryCategory; label: string }[] = [
	{ value: "preference", label: "Preference" },
	{ value: "fact", label: "Fact" },
	{ value: "project", label: "Project" },
	{ value: "note", label: "Note" },
	{ value: "feedback", label: "Feedback" },
]

export function MemorySettings() {
	const filtered = useAtomValue(memoriesFilteredAtom)
	const loading = useAtomValue(memoriesLoadingAtom)
	const stats = useAtomValue(memoryStatsAtom)
	const searchQuery = useAtomValue(memorySearchQueryAtom)
	const categoryFilter = useAtomValue(memoryCategoryFilterAtom)
	const setFilter = useSetAtom(memoryCategoryFilterAtom)
	const setSearch = useSetAtom(memorySearchQueryAtom)

	useEffect(() => {
		refreshMemories().catch(() => {})
		refreshMemoryStats().catch(() => {})
	}, [])

	const handleClearAll = useCallback(async () => {
		if (
			typeof window !== "undefined" &&
			!window.confirm(
				`Delete all ${stats.total} memories? This cannot be undone.`,
			)
		) {
			return
		}
		await clearMemories()
		toast.success("All memories cleared")
	}, [stats.total])

	return (
		<div className="space-y-8">
			<div className="flex items-center gap-2">
				<BrainIcon className="size-5 text-muted-foreground" aria-hidden="true" />
				<h2 className="text-xl font-semibold">Memory</h2>
			</div>

			<SettingsSection
				title="Overview"
				description={`${stats.total} ${stats.total === 1 ? "memory" : "memories"} stored locally. They survive restarts and are available across all sessions.`}
			>
				<SettingsRow label="Total memories">
					<span className="text-sm tabular-nums text-muted-foreground">
						{stats.total}
					</span>
				</SettingsRow>
				<SettingsRow label="By category">
					<div className="flex flex-wrap items-center gap-1.5">
						{CATEGORIES.map((c) => (
							<span
								key={c.value}
								className="inline-flex items-center gap-1 rounded border border-border/50 bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground"
							>
								<span className="font-medium">{c.label}</span>
								<span className="tabular-nums">
									{stats.byCategory[c.value] ?? 0}
								</span>
							</span>
						))}
					</div>
				</SettingsRow>
				<SettingsRow
					label="Clear all memories"
					description="Permanently delete every stored memory."
				>
					<Button
						variant="outline"
						size="sm"
						onClick={handleClearAll}
						disabled={stats.total === 0}
					>
						<TrashIcon className="size-3.5" aria-hidden="true" />
						Clear all
					</Button>
				</SettingsRow>
			</SettingsSection>

			<SettingsSection title="New memory">
				<NewMemoryComposer />
			</SettingsSection>

			<SettingsSection
				title="Browse"
				description="Search and filter your memories. Click a row to edit it."
			>
				<div className="space-y-2 px-4 py-3">
					<div className="flex flex-wrap items-center gap-2">
						<div className="relative min-w-[180px] flex-1">
							<SearchIcon
								className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60"
								aria-hidden="true"
							/>
							<input
								type="text"
								placeholder="Search content or tags…"
								value={searchQuery}
								onChange={(e) => setSearch(e.target.value)}
								className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-xs focus:border-ring focus:outline-none"
							/>
						</div>
						<Select
							value={categoryFilter ?? "__all__"}
							onValueChange={(v) =>
								setFilter(v === "__all__" ? null : (v as MemoryCategory))
							}
						>
							<SelectTrigger className="min-w-[140px]">
								<SelectValue placeholder="All categories" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="__all__">All categories</SelectItem>
								{CATEGORIES.map((c) => (
									<SelectItem key={c.value} value={c.value}>
										{c.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>

				<MemoryList items={filtered} loading={loading} />
			</SettingsSection>

			<SettingsSection
				title="Recall test"
				description="Searches memories by relevance to a query. Returns the top matches with their scores."
			>
				<RecallTester />
			</SettingsSection>
		</div>
	)
}

// ============================================================
// Sub-components
// ============================================================

function NewMemoryComposer() {
	const draft = useAtomValue(memoryNewDraftAtom)
	const setDraft = useSetAtom(memoryNewDraftAtom)
	const [saving, setSaving] = useState(false)

	const tagsArray = useMemo(
		() =>
			draft.tags
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean),
		[draft.tags],
	)

	const canSave = draft.content.trim().length > 0 && !saving

	const handleSave = useCallback(async () => {
		if (!canSave) return
		setSaving(true)
		try {
			const saved = await storeMemory({
				content: draft.content.trim(),
				category: draft.category,
				tags: tagsArray,
			})
			if (saved) {
				setDraft({ content: "", category: draft.category, tags: "" })
				toast.success("Memory saved")
			}
		} finally {
			setSaving(false)
		}
	}, [canSave, draft.content, draft.category, tagsArray, setDraft])

	return (
		<div className="space-y-2 px-4 py-3">
			<textarea
				value={draft.content}
				onChange={(e) => setDraft({ ...draft, content: e.target.value })}
				placeholder="e.g. The user prefers TypeScript over JavaScript and uses bun as the package manager."
				rows={3}
				className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-xs focus:border-ring focus:outline-none"
			/>
			<div className="flex flex-wrap items-center gap-2">
				<Select
					value={draft.category}
					onValueChange={(v) =>
						setDraft({ ...draft, category: v as MemoryCategory })
					}
				>
					<SelectTrigger className="min-w-[140px]">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{CATEGORIES.map((c) => (
							<SelectItem key={c.value} value={c.value}>
								{c.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<input
					type="text"
					value={draft.tags}
					onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
					placeholder="Tags (comma-separated)"
					className="min-w-[180px] flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-ring focus:outline-none"
				/>
				<Button size="sm" onClick={handleSave} disabled={!canSave}>
					{saving ? (
						<Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
					) : (
						<PlusIcon className="size-3.5" aria-hidden="true" />
					)}
					Save
				</Button>
			</div>
		</div>
	)
}

function MemoryList({
	items,
	loading,
}: {
	items: Memory[]
	loading: boolean
}) {
	const [editingId, setEditingId] = useState<string | null>(null)

	const handleDelete = useCallback((m: Memory) => {
		if (typeof window !== "undefined" && !window.confirm(`Delete this memory?\n\n${m.content.slice(0, 120)}`)) {
			return
		}
		deleteMemory(m.id).catch(() => {})
	}, [])

	if (loading && items.length === 0) {
		return (
			<div className="flex items-center justify-center px-4 py-8 text-xs text-muted-foreground">
				<Loader2Icon className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
				Loading memories…
			</div>
		)
	}

	if (items.length === 0) {
		return (
			<div className="flex flex-col items-center gap-1.5 px-4 py-10 text-center text-xs text-muted-foreground">
				<BrainIcon className="size-6 text-muted-foreground/40" aria-hidden="true" />
				<div className="font-medium">No memories</div>
				<div>Add a memory above, or seed it from your session preferences.</div>
			</div>
		)
	}

	return (
		<ul className="divide-y divide-border">
			{items.map((m) =>
				editingId === m.id ? (
					<li key={m.id} className="px-4 py-3">
						<MemoryEditor
							memory={m}
							onDone={() => setEditingId(null)}
							onCancel={() => setEditingId(null)}
						/>
					</li>
				) : (
					<li key={m.id} className="group px-4 py-3 hover:bg-muted/30">
						<div className="flex items-start gap-2">
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<CategoryChip category={m.category} />
									<span className="text-[10px] text-muted-foreground/70">
										{new Date(m.createdAt).toLocaleString()}
									</span>
									{m.useCount > 0 && (
										<span
											title={`Used ${m.useCount} times`}
											className="text-[10px] text-muted-foreground/70"
										>
											· used {m.useCount}×
										</span>
									)}
								</div>
								<p className="mt-1 text-xs leading-relaxed text-foreground/90">
									{m.content}
								</p>
								{m.tags.length > 0 && (
									<div className="mt-1.5 flex flex-wrap gap-1">
										{m.tags.map((t) => (
											<span
												key={t}
												className="inline-flex items-center rounded border border-border/40 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"
											>
												{t}
											</span>
										))}
									</div>
								)}
							</div>
							<div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
								<button
									type="button"
									title="Edit"
									onClick={() => setEditingId(m.id)}
									className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
								>
									<span className="text-[10px]">Edit</span>
								</button>
								<button
									type="button"
									title="Delete"
									onClick={() => handleDelete(m)}
									className="rounded p-1 text-muted-foreground/60 hover:bg-red-500/15 hover:text-red-400"
								>
									<TrashIcon className="size-3.5" aria-hidden="true" />
								</button>
							</div>
						</div>
					</li>
				),
			)}
		</ul>
	)
}

function MemoryEditor({
	memory,
	onDone,
	onCancel,
}: {
	memory: Memory
	onDone: () => void
	onCancel: () => void
}) {
	const [content, setContent] = useState(memory.content)
	const [category, setCategory] = useState<MemoryCategory>(memory.category)
	const [tags, setTags] = useState(memory.tags.join(", "))
	const [saving, setSaving] = useState(false)

	const handleSave = useCallback(async () => {
		setSaving(true)
		try {
			const tagsArray = tags
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean)
			const updated = await updateMemory(memory.id, { content, category, tags: tagsArray })
			if (updated) {
				toast.success("Memory updated")
				onDone()
			}
		} finally {
			setSaving(false)
		}
	}, [content, category, tags, memory.id, onDone])

	return (
		<div className="space-y-2">
			<textarea
				value={content}
				onChange={(e) => setContent(e.target.value)}
				rows={4}
				className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-xs focus:border-ring focus:outline-none"
			/>
			<div className="flex flex-wrap items-center gap-2">
				<Select
					value={category}
					onValueChange={(v) => setCategory(v as MemoryCategory)}
				>
					<SelectTrigger className="min-w-[140px]">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{CATEGORIES.map((c) => (
							<SelectItem key={c.value} value={c.value}>
								{c.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<input
					type="text"
					value={tags}
					onChange={(e) => setTags(e.target.value)}
					placeholder="Tags (comma-separated)"
					className="min-w-[180px] flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-ring focus:outline-none"
				/>
				<Button size="sm" onClick={handleSave} disabled={saving}>
					{saving ? (
						<Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
					) : null}
					Save
				</Button>
				<Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
					Cancel
				</Button>
			</div>
		</div>
	)
}

function CategoryChip({ category }: { category: MemoryCategory }) {
	const colors: Record<MemoryCategory, string> = {
		preference: "bg-purple-500/15 text-purple-400 border-purple-500/30",
		fact: "bg-blue-500/15 text-blue-400 border-blue-500/30",
		project: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
		note: "bg-muted text-muted-foreground border-border/50",
		feedback: "bg-amber-500/15 text-amber-400 border-amber-500/30",
	}
	return (
		<span
			className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${colors[category]}`}
		>
			{category}
		</span>
	)
}

function RecallTester() {
	const [query, setQuery] = useState("")
	const [results, setResults] = useState<{ memory: Memory; score: number }[]>([])
	const [loading, setLoading] = useState(false)

	const handleRecall = useCallback(async () => {
		if (!query.trim()) return
		setLoading(true)
		try {
			const r = await recallMemories(query.trim(), 5)
			setResults(r)
		} finally {
			setLoading(false)
		}
	}, [query])

	return (
		<div className="space-y-2 px-4 py-3">
			<div className="flex items-center gap-2">
				<input
					type="text"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="e.g. user prefers TypeScript"
					className="min-w-[180px] flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-ring focus:outline-none"
					onKeyDown={(e) => {
						if (e.key === "Enter") handleRecall()
					}}
				/>
				<Button size="sm" onClick={handleRecall} disabled={!query.trim() || loading}>
					{loading ? (
						<Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
					) : (
						<SparklesIcon className="size-3.5" aria-hidden="true" />
					)}
					Recall
				</Button>
			</div>
			{results.length > 0 && (
				<ul className="space-y-1.5">
					{results.map(({ memory, score }) => (
						<li
							key={memory.id}
							className="rounded border border-border/40 bg-muted/30 px-2.5 py-1.5"
						>
							<div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
								<CategoryChip category={memory.category} />
								<span className="tabular-nums">score {score.toFixed(2)}</span>
							</div>
							<p className="mt-0.5 text-xs leading-relaxed text-foreground/90">
								{memory.content}
							</p>
						</li>
					))}
				</ul>
			)}
			{!loading && results.length === 0 && query.trim() && (
				<div className="px-2 py-2 text-xs text-muted-foreground">
					No matching memories.
				</div>
			)}
		</div>
	)
}
