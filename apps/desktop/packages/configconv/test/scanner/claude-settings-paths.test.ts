import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

let testDir: string

function lowercaseSettingsPath(): string {
	return join(testDir, "lowercase-settings.json")
}

function legacySettingsPath(): string {
	return join(testDir, "legacy-settings.json")
}

mock.module("../../src/utils/paths", () => ({
	ccSettingsPaths: () => [lowercaseSettingsPath(), legacySettingsPath()],
	ccUserStatePath: () => join(testDir, ".claude.json"),
	ccGlobalSkillsDir: () => join(testDir, "claude-skills"),
	sharedAgentsSkillsDir: () => join(testDir, ".config", "claude", "skills"),
	ccGlobalClaudeMdPath: () => join(testDir, "CLAUDE.md"),
}))

const { scanGlobal } = await import("../../src/scanner/claude-config")

beforeEach(async () => {
	testDir = join(
		tmpdir(),
		`infinitecode-configconv-claude-settings-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	)
	await mkdir(testDir, { recursive: true })
})

afterEach(async () => {
	await rm(testDir, { recursive: true, force: true })
})

describe("Claude Code settings path scan order", () => {
	test("prefers lowercase settings before legacy uppercase settings", async () => {
		await writeFile(
			lowercaseSettingsPath(),
			JSON.stringify({ env: { ANTHROPIC_MODEL: "lowercase-model" } }),
		)
		await writeFile(
			legacySettingsPath(),
			JSON.stringify({ env: { ANTHROPIC_MODEL: "legacy-model" } }),
		)

		const result = await scanGlobal()

		expect(result.settingsPath).toBe(lowercaseSettingsPath())
		expect(result.settings?.env?.ANTHROPIC_MODEL).toBe("lowercase-model")
	})

	test("falls back to legacy uppercase settings when lowercase settings are absent", async () => {
		await writeFile(
			legacySettingsPath(),
			JSON.stringify({ env: { ANTHROPIC_MODEL: "legacy-model" } }),
		)

		const result = await scanGlobal()

		expect(result.settingsPath).toBe(legacySettingsPath())
		expect(result.settings?.env?.ANTHROPIC_MODEL).toBe("legacy-model")
	})
})
