import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

let testDir: string

function opencodeJsonPath(): string {
	return join(testDir, "opencode.json")
}

function opencodeJsoncPath(): string {
	return join(testDir, "opencode.jsonc")
}

function opencodeAuthPath(): string {
	return join(testDir, "auth.json")
}

mock.module("../../src/utils/paths", () => ({
	opencodeConfigPath: opencodeJsonPath,
	opencodeJsoncConfigPath: opencodeJsoncPath,
	opencodeAuthPath,
}))

const { scanOpenCode } = await import("../../src/scanner/opencode-config")
const { scanFormat } = await import("../../src/scanner")

beforeEach(async () => {
	testDir = join(
		tmpdir(),
		`infinitecode-configconv-opencode-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	)
	await mkdir(testDir, { recursive: true })
})

afterEach(async () => {
	await rm(testDir, { recursive: true, force: true })
})

describe("OpenCode scanner", () => {
	test("prefers opencode.json and reads auth.json", async () => {
		await writeFile(
			opencodeJsonPath(),
			JSON.stringify({
				model: "deepseek/deepseek-v4-pro",
				provider: {
					deepseek: {
						npm: "@ai-sdk/openai-compatible",
						options: { baseURL: "https://api.deepseek.com/v1" },
						models: { "deepseek-v4-pro": { name: "DeepSeek V4 Pro" } },
					},
				},
			}),
		)
		await writeFile(
			opencodeJsoncPath(),
			JSON.stringify({
				provider: {
					mimo: {
						npm: "@ai-sdk/openai-compatible",
						models: { "mimo-v2.5": {} },
					},
				},
			}),
		)
		await writeFile(opencodeAuthPath(), JSON.stringify({ deepseek: { key: "sk-from-auth" } }))

		const result = await scanOpenCode()

		expect(result).toEqual({
			global: {
				configPath: opencodeJsonPath(),
				authPath: opencodeAuthPath(),
				parseErrors: [],
				config: {
					model: "deepseek/deepseek-v4-pro",
					provider: {
						deepseek: {
							npm: "@ai-sdk/openai-compatible",
							options: { baseURL: "https://api.deepseek.com/v1" },
							models: { "deepseek-v4-pro": { name: "DeepSeek V4 Pro" } },
						},
					},
				},
				auth: { deepseek: { key: "sk-from-auth" } },
			},
		})
	})

	test("falls back to opencode.jsonc and supports JSONC comments", async () => {
		await writeFile(
			opencodeJsoncPath(),
			`{
				// OpenCode provider config
				"provider": {
					"mimo": {
						"npm": "@ai-sdk/openai-compatible",
						"models": {
							"mimo-v2.5": { "name": "Mimo v2.5" },
						},
					},
				},
			}`,
		)

		const result = await scanOpenCode()

		expect(result.global.configPath).toBe(opencodeJsoncPath())
		expect(result.global.config?.provider?.mimo?.models?.["mimo-v2.5"]?.name).toBe("Mimo v2.5")
		expect(result.global.parseErrors).toEqual([])
	})

	test("returns parse errors instead of throwing on malformed config or auth", async () => {
		await writeFile(opencodeJsonPath(), "{ malformed")
		await writeFile(opencodeAuthPath(), "{ malformed auth")

		const result = await scanOpenCode()

		expect(result.global.config).toBeUndefined()
		expect(result.global.auth).toBeUndefined()
		expect(result.global.parseErrors.length).toBe(2)
		expect(result.global.parseErrors[0]).toContain(opencodeJsonPath())
		expect(result.global.parseErrors[1]).toContain(opencodeAuthPath())
	})

	test("scanFormat supports opencode as a scan-only format", async () => {
		await writeFile(
			opencodeJsonPath(),
			JSON.stringify({
				provider: {
					deepseek: {
						npm: "@ai-sdk/openai-compatible",
						models: { "deepseek-v4-flash": {} },
					},
				},
			}),
		)

		const result = await scanFormat({ format: "opencode", global: true })

		expect(result).toEqual({
			format: "opencode",
			data: {
				global: {
					configPath: opencodeJsonPath(),
					parseErrors: [],
					config: {
						provider: {
							deepseek: {
								npm: "@ai-sdk/openai-compatible",
								models: { "deepseek-v4-flash": {} },
							},
						},
					},
				},
			},
		})
	})
})
