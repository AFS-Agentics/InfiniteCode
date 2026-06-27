import { beforeEach, describe, expect, mock, test } from "bun:test"

const setOption = mock(async () => undefined)

mock.module("../services/connection-manager", () => ({
	getProjectClient: () => ({
		config: { setOption },
	}),
}))

const { persistRuntimeModelConfigOption, persistRuntimeModelSelection } = await import(
	"./model-config-options"
)

describe("runtime model config option persistence", () => {
	beforeEach(() => {
		setOption.mockClear()
	})

	test("persists selected model through runtime config", async () => {
		await persistRuntimeModelSelection("/repo", {
			providerID: "session",
			modelID: "deepseek-v4-flash",
		})

		expect(setOption).toHaveBeenCalledWith({
			configID: "model",
			value: "deepseek-v4-flash",
		})
	})

	test("persists selected reasoning effort through runtime config", async () => {
		await persistRuntimeModelConfigOption("/repo", "thought_level", "max")

		expect(setOption).toHaveBeenCalledWith({
			configID: "thought_level",
			value: "max",
		})
	})
})
