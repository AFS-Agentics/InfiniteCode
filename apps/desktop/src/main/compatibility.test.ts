import { describe, expect, test } from "bun:test"
import { satisfies } from "semver"
import { checkDevoProgram, INFINITECODE_COMPAT } from "./compatibility"

describe("INFINITECODE_COMPAT", () => {
	test("supports 0.1.21 as the minimum CLI version", () => {
		expect(satisfies("0.1.21", INFINITECODE_COMPAT.supported)).toBe(true)
		expect(satisfies("0.1.21", INFINITECODE_COMPAT.tested)).toBe(true)
		expect(satisfies("0.1.20", INFINITECODE_COMPAT.supported)).toBe(false)
	})
})

describe("checkDevoProgram", () => {
	test("checks an explicit bundled runtime path without consulting PATH", async () => {
		const result = await checkDevoProgram({
			program: "/Applications/InfiniteCode.app/Contents/Resources/runtime/bin/infinitecode",
			env: { PATH: "/usr/bin" },
			execFile: (_cmd, _args, _options, callback) => {
				callback(null, "infinitecode v0.1.22\n")
			},
		})

		expect(result).toEqual({
			installed: true,
			version: "0.1.22",
			path: "/Applications/InfiniteCode.app/Contents/Resources/runtime/bin/infinitecode",
			compatible: true,
			compatibility: "ok",
			message: null,
		})
	})
})
