import { describe, expect, test } from "bun:test"
import path from "node:path"
import { resolveProgram } from "./devo-program"

describe("resolveProgram", () => {
	test("prefers the checkout debug CLI in desktop dev mode", () => {
		const appPath = path.join("repo", "apps", "desktop")
		const checkoutDebug = path.resolve(appPath, "..", "..", "target", "debug", "infinitecode")
		const program = resolveProgram({
			appPath,
			env: {},
			existsSync: (candidate) => candidate === checkoutDebug,
			isPackaged: false,
		})

		expect(program).toBe(checkoutDebug)
	})

	if (process.platform === "win32") {
		test("prefers the checkout debug CLI executable in Windows desktop dev mode", () => {
			const program = resolveProgram({
				appPath: "C:\\repo\\apps\\desktop",
				env: {},
				existsSync: (candidate) => candidate === "C:\\repo\\target\\debug\\infinitecode.exe",
				isPackaged: false,
			})

			expect(program).toBe("C:\\repo\\target\\debug\\infinitecode.exe")
		})
	}

	test("uses explicit override before dev checkout candidates", () => {
		const program = resolveProgram({
			appPath: "/repo/apps/desktop",
			env: { INFINITECODE_DESKTOP_BIN: "/custom/infinitecode" },
			existsSync: () => true,
			isPackaged: false,
		})

		expect(program).toBe("/custom/infinitecode")
	})

	test("uses bundled runtime in packaged apps", () => {
		const program = resolveProgram({
			appPath: "/repo/apps/desktop",
			env: {},
			existsSync: (candidate) => candidate === "/Applications/InfiniteCode.app/Contents/Resources/runtime/bin/infinitecode",
			isPackaged: true,
			resourcesPath: "/Applications/InfiniteCode.app/Contents/Resources",
		})

		expect(program).toBe("/Applications/InfiniteCode.app/Contents/Resources/runtime/bin/infinitecode")
	})

	test("uses bundled Windows runtime executable in packaged apps", () => {
		const program = resolveProgram({
			appPath: "/app/resources/app.asar",
			env: {},
			existsSync: (candidate) => candidate === "/app/resources/runtime/bin/infinitecode.exe",
			isPackaged: true,
			platform: "win32",
			resourcesPath: "/app/resources",
		})

		expect(program).toBe("/app/resources/runtime/bin/infinitecode.exe")
	})

	test("fails clearly when packaged runtime is missing", () => {
		expect(() =>
			resolveProgram({
				appPath: "/repo/apps/desktop",
				env: {},
				existsSync: () => false,
				isPackaged: true,
				resourcesPath: "/Applications/InfiniteCode.app/Contents/Resources",
			}),
		).toThrow("Bundled InfiniteCode runtime not found")
	})
})
