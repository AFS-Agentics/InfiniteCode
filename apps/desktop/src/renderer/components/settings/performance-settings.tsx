/**
 * Performance / agent behavior settings.
 *
 * Surfaces the `AgentBehaviorConfig` knobs that the InfiniteCode Rust server
 * exposes:
 *
 *   - `selfVerify` → appends the `<verify_solution_protocol>` block to the
 *     system prompt and encourages the model to call the `verify_solution`
 *     tool before non-trivial final answers. Off by default.
 *   - `compactStrategy` → `auto` (default, threshold-driven), `conservative`
 *     (95% threshold), `aggressive` (60% threshold), or `off` (manual
 *     `/compact` only).
 *   - `compactThresholdPercent` → percent of the input budget that triggers
 *     auto-compaction when `compactStrategy === "auto"`. Clamped to [50, 95].
 *
 * Changes are saved with a status banner and the IPC handler restarts the
 * spawned Rust process so the new env vars take effect on the next boot.
 */
import { useCallback, useState } from "react"
import { useSettings } from "../../hooks/use-settings"
import type { CompactStrategyId, PerformanceSettings } from "../../../preload/api"
import { SettingsRow } from "./settings-row"
import { SettingsSection } from "./settings-section"

const STRATEGY_OPTIONS: { value: CompactStrategyId; label: string; description: string }[] =
	[
		{
			value: "auto",
			label: "Auto",
			description:
				"Use the configured threshold (default 80% of input budget). Matches the historical behavior.",
		},
		{
			value: "conservative",
			label: "Conservative",
			description:
				"Wait until 95% of the input budget before auto-compacting. Preserves as much raw history as possible.",
		},
		{
			value: "aggressive",
			label: "Aggressive",
			description:
				"Trigger at 60% of the input budget. Keeps more headroom for long-running tasks and cache-friendly prompts.",
		},
		{
			value: "off",
			label: "Off",
			description:
				"Disable auto-compaction entirely. Compaction still runs on /compact and context_too_long retries.",
		},
	]

const SELF_VERIFY_DESCRIPTION =
	"When enabled, the model gets a verify_solution_protocol block in its system prompt and is encouraged to call the verify_solution tool before submitting non-trivial final answers. The tool asks the model to walk through any explicit criteria and factual claims. It does NOT run external tools or APIs."

const COMPACT_STRATEGY_DESCRIPTION =
	"Controls when auto-compaction triggers. Manual /compact and provider context_too_long retries always run regardless."

const THRESHOLD_DESCRIPTION =
	"Percent of the input budget at which auto-compaction fires. Used only when strategy is auto. Range 50-95%."

const DEFAULT_PERFORMANCE: PerformanceSettings = {
	selfVerify: false,
	compactStrategy: "auto",
	compactThresholdPercent: 80,
}

export function PerformanceSettings() {
	const { settings, updateSettings, loading } = useSettings()
	const [saving, setSaving] = useState(false)
	const [statusMessage, setStatusMessage] = useState<string | null>(null)
	const performance: PerformanceSettings = settings.performance ?? DEFAULT_PERFORMANCE

	const updateOne = useCallback(
		async (patch: Partial<PerformanceSettings>) => {
			setSaving(true)
			setStatusMessage(null)
			try {
				await updateSettings({ performance: { ...performance, ...patch } })
				setStatusMessage(
					"Saved. The InfiniteCode server will restart to apply changes.",
				)
			} catch (error) {
				console.error("Failed to save performance settings", error)
				setStatusMessage("Failed to save. Check the logs.")
			} finally {
				setSaving(false)
			}
		},
		[performance, updateSettings],
	)

	if (loading) {
		return (
			<div className="flex flex-col gap-6">
				<SettingsSection
					title="Performance"
					description="Agent behavior knobs: self-verification and context compaction strategy."
				>
					<div className="px-4 py-3 text-sm text-muted-foreground">Loading…</div>
				</SettingsSection>
			</div>
		)
	}

	return (
		<div className="flex flex-col gap-6">
			<SettingsSection
				title="Performance"
				description="Agent behavior knobs: self-verification and context compaction strategy."
			>
				<SettingsRow
					label="Self-verify before final answers"
					description={SELF_VERIFY_DESCRIPTION}
				>
					<label className="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							checked={performance.selfVerify}
							disabled={saving}
							onChange={(event) =>
								updateOne({ selfVerify: event.target.checked })
							}
						/>
						<span>{performance.selfVerify ? "Enabled" : "Disabled"}</span>
					</label>
				</SettingsRow>

				<SettingsRow
					label="Context compaction strategy"
					description={COMPACT_STRATEGY_DESCRIPTION}
				>
					<select
						className="rounded-md border bg-background px-2 py-1 text-sm"
						value={performance.compactStrategy}
						disabled={saving}
						onChange={(event) =>
							updateOne({
								compactStrategy: event.target.value as CompactStrategyId,
							})
						}
					>
						{STRATEGY_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</SettingsRow>

				<SettingsRow
					label="Auto-compact threshold"
					description={THRESHOLD_DESCRIPTION}
				>
					<div className="flex items-center gap-3">
						<input
							type="range"
							min={50}
							max={95}
							step={1}
							value={performance.compactThresholdPercent}
							disabled={saving || performance.compactStrategy !== "auto"}
							onChange={(event) =>
								updateOne({
									compactThresholdPercent: Number(event.target.value),
								})
							}
							className="w-48"
						/>
						<span className="w-12 text-right text-sm tabular-nums">
							{performance.compactThresholdPercent}%
						</span>
					</div>
				</SettingsRow>
			</SettingsSection>

			<StrategyDescriptions />

			{statusMessage && (
				<div
					className={
						statusMessage.startsWith("Failed")
							? "rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500"
							: "rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-500"
					}
				>
					{statusMessage}
				</div>
			)}
		</div>
	)
}

function StrategyDescriptions() {
	return (
		<div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
			<ul className="flex flex-col gap-1.5">
				{STRATEGY_OPTIONS.map((option) => (
					<li key={option.value}>
						<strong className="text-foreground">{option.label}.</strong>{" "}
						{option.description}
					</li>
				))}
			</ul>
		</div>
	)
}