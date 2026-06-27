import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const desktopDir = join(import.meta.dir, "..")

describe("desktop package runtime resources", () => {
	test("packages private runtime resources instead of public CLI launcher scripts", () => {
		const config = readFileSync(join(desktopDir, "electron-builder.yml"), "utf8")

		expect({
			includesPrivateRuntime: config.includes("from: resources/runtime"),
			excludesPublicCliLauncher: !config.includes("from: resources/bin"),
		}).toEqual({
			includesPrivateRuntime: true,
			excludesPublicCliLauncher: true,
		})
	})
})
