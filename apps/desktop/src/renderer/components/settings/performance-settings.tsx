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
			label: "Balanced",
			description: "Use the percentage setting below. Best for most people.",
		},
		{
			value: "conservative",
			label: "Less often",
			description:
				"Keep more of your older messages in the conversation. The assistant may run out of room sooner on very long tasks.",
		},
		{
			value: "aggressive",
			label: "More often",
			description:
				"Trim older messages sooner so the assistant has more room. Helpful for long, multi-hour sessions.",
		},
		{
			value: "off",
			label: "Manual only",
			description:
				"Don't trim anything automatically. The assistant only cleans up when you run the /compact command or when it runs out of room.",
		},
	]

const SELF_VERIFY_DESCRIPTION =
	"Turn this on to have the assistant double-check its own answer against the original task before sending it. It only rewrites the answer if it spots a real mistake. No extra tools or APIs are called. Recommended for tasks where accuracy matters."

const COMPACT_STRATEGY_DESCRIPTION =
	"How the assistant makes room during long conversations. It usually cleans up older messages automatically so newer ones still fit. The /compact command still works the same way regardless of this setting."

const THRESHOLD_DESCRIPTION =
	"Auto trims older messages once the chat reaches this percentage of its limit. 80% is a safe default for most conversations."

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
					"Saved. The assistant will restart in the background to apply your changes.",
				)
			} catch (error) {
				console.error("Failed to save agent behavior settings", error)
				setStatusMessage("Couldn't save your changes. Please try again.")
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
					title="How the assistant works"
					description="Whether the assistant double-checks its own answers and how it makes room for long conversations."
				>
					<div className="px-4 py-3 text-sm text-muted-foreground">Loading…</div>
				</SettingsSection>
			</div>
		)
	}

	return (
		<div className="flex flex-col gap-6">
			<SettingsSection
				title="Agent behavior"
				description="Tune how the assistant works — whether it double-checks its own answers and how it makes room for long conversations."
			>
				<SettingsRow
					label="Double-check answers before replying"
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
						<span>{performance.selfVerify ? "On" : "Off"}</span>
					</label>
				</SettingsRow>

					<label className="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							checked={performance.suggestFollowups}
							disabled={saving}
							onChange={(event) =>
								updateOne({ suggestFollowups: event.target.checked })
							}
						/>
						<span>{performance.suggestFollowups ? "On" : "Off"}</span>
					</label>
				</SettingsRow>

				<SettingsRow
					label="Suggest next steps at the end of each turn"
					description="Adds a clickable chip row below non-trivial assistant turns. Each chip uses an emoji + short label; clicking submits the chip's prompt as your next message. Off only turns off the system-prompt block — the tool itself stays registered."
				>
					<label className="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							checked={performance.suggestFollowups}
							disabled={saving}
							onChange={(event) =>
								updateOne({ suggestFollowups: event.target.checked })
							}
						/>
						<span>{performance.suggestFollowups ? "On" : "Off"}</span>
					</label>
				</SettingsRow>

				<SettingsRow
					label="When to trim older messages"
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
					label="How full before trimming"
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