import { describe, expect, test } from "bun:test"
import { resolveDevoProgram } from "./devo-program"

describe("resolveDevoProgram", () => {
	test("prefers the checkout debug CLI in desktop dev mode", () => {
		const program = resolveDevoProgram({
			appPath: "/repo/apps/desktop",
			env: {},
			existsSync: (candidate) => candidate === "/repo/target/debug/devo",
			isPackaged: false,
		})

		expect(program).toBe("/repo/target/debug/devo")
	})

	test("uses explicit override before dev checkout candidates", () => {
		const program = resolveDevoProgram({
			appPath: "/repo/apps/desktop",
			env: { DEVO_DESKTOP_DEVO_BIN: "/custom/devo" },
			existsSync: () => true,
			isPackaged: false,
		})

		expect(program).toBe("/custom/devo")
	})

	test("falls back to PATH in packaged apps", () => {
		const program = resolveDevoProgram({
			appPath: "/repo/apps/desktop",
			env: {},
			existsSync: () => true,
			isPackaged: true,
		})

		expect(program).toBe("devo")
	})
})
