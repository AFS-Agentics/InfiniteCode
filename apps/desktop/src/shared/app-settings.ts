/**
 * Shared desktop settings defaults.
 *
 * Used by both the Electron main process and the renderer. Keep this module
 * free of Electron or React imports so it can be bundled in either context.
 */

import type {
	AppSettings,
	AppearanceSettings,
	DesktopFolderSettings,
	NotificationSettings,
	OpenInSettings,
	PerformanceSettings,
	VoiceSettings,
	WebSearchSettings,
} from "../preload/api"
import { DEFAULT_SERVER_SETTINGS } from "./server-config"

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
	completionMode: "unfocused",
	permissions: true,
	questions: true,
	errors: true,
	dockBadge: true,
}

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
	colorScheme: "dark",
	themeId: "default",
	displayMode: "default",
	hideThinkingWhileWorking: true,
	rendererPreferencesMigrated: false,
}

export const DEFAULT_OPEN_IN_SETTINGS: OpenInSettings = {
	preferredTargetId: null,
}

export const DEFAULT_DESKTOP_FOLDER_SETTINGS: DesktopFolderSettings = {
	folders: [],
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
	enabled: false,
	inputMode: "push_to_talk",
	provider: "web_speech",
	language: "en-US",
	openaiApiKey: "",
	maxDurationMs: 30_000,
}

export const DEFAULT_WEB_SEARCH_SETTINGS: WebSearchSettings = {
	enabled: false,
	defaultProvider: "duckduckgo",
	braveApiKey: "",
	tavilyApiKey: "",
	maxResults: 5,
}

export const DEFAULT_PERFORMANCE_SETTINGS: PerformanceSettings = {
	// Off by default — the user opts in explicitly. Self-verify adds a
	// `<verify_solution_protocol>` block to the system prompt and exposes
	// the `verify_solution` tool for structured self-reflection before
	// submission. Suggest-followups is on by default so non-trivial turns
	// end with clickable next-step chips (`<suggest_followups_protocol>`
	// block + the `suggest_followups` tool). Conservative compaction matches
	// the historical `compact_at_threshold` behavior; auto-compaction
	// threshold is 80%.
	selfVerify: false,
	suggestFollowups: true,
	compactStrategy: "auto",
	compactThresholdPercent: 80,
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
	notifications: DEFAULT_NOTIFICATION_SETTINGS,
	opaqueWindows: false,
	appearance: DEFAULT_APPEARANCE_SETTINGS,
	openIn: DEFAULT_OPEN_IN_SETTINGS,
	desktopFolders: DEFAULT_DESKTOP_FOLDER_SETTINGS,
	servers: DEFAULT_SERVER_SETTINGS,
	voice: DEFAULT_VOICE_SETTINGS,
	webSearch: DEFAULT_WEB_SEARCH_SETTINGS,
	performance: DEFAULT_PERFORMANCE_SETTINGS,
}
