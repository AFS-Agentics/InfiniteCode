import { afterAll, describe, expect, mock, test } from "bun:test"

const originalPlatform = process.platform
Object.defineProperty(process, "platform", { value: "darwin" })

let preferredTargetId: string | null = null
const updateSettingsCalls: unknown[] = []

function currentSettings() {
	return {
		notifications: {
			completionMode: "unfocused",
			permissions: true,
			questions: true,
			errors: true,
			dockBadge: true,
		},
		opaqueWindows: false,
		appearance: {
			colorScheme: "dark",
			themeId: "default",
			displayMode: "default",
			rendererPreferencesMigrated: false,
		},
		openIn: {
			preferredTargetId,
		},
		servers: {
			servers: [{ id: "local", name: "This Mac", type: "local" }],
			activeServerId: "local",
		},
	}
}

mock.module("./settings-store", () => ({
	getSettings: currentSettings,
	updateSettings: (partial: { openIn?: { preferredTargetId?: string | null } }) => {
		updateSettingsCalls.push(partial)
		if (partial.openIn) {
			preferredTargetId = partial.openIn.preferredTargetId ?? null
		}
		return currentSettings()
	},
}))

mock.module("electron", () => ({
	app: {
		getFileIcon: async () => ({
			toPNG: () => Buffer.from("icon"),
		}),
	},
}))

afterAll(() => {
	Object.defineProperty(process, "platform", { value: originalPlatform })
})

async function loadOpenInTargets(name: string) {
	return await import(`./open-in-targets?case=${name}-${Date.now()}`)
}

describe("open-in-targets preferences", () => {
	test("persists the preferred open target in desktop settings", async () => {
		preferredTargetId = null
		updateSettingsCalls.length = 0
		const { setPreferredTarget } = await loadOpenInTargets("persist")

		setPreferredTarget("cursor")

		expect(updateSettingsCalls).toEqual([
			{
				openIn: {
					preferredTargetId: "cursor",
				},
			},
		])
	})

	test("falls back to the first available target when the stored target is unavailable", async () => {
		const { resolvePreferredTargetId } = await loadOpenInTargets("fallback")

		expect(resolvePreferredTargetId("cursor", ["vscode", "finder"])).toBe("vscode")
	})
})
