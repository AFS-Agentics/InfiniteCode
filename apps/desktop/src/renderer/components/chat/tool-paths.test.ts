import { describe, expect, test } from "bun:test"
import { formatToolPathForDisplay, getFirstApplyPatchPath } from "./tool-paths"

describe("formatToolPathForDisplay", () => {
	test("shows project-relative Windows paths", () => {
		expect(
			formatToolPathForDisplay("C:\\Users\\lenovo\\Desktop\\devo\\src\\main.ts", {
				projectRoot: "c:\\users\\lenovo\\desktop\\devo",
			}),
		).toBe("src/main.ts")
	})

	test("shows project-relative POSIX paths", () => {
		expect(
			formatToolPathForDisplay("/home/lenovo/devo/src/main.ts", {
				projectRoot: "/home/lenovo/devo",
			}),
		).toBe("src/main.ts")
	})

	test("keeps already-relative paths", () => {
		expect(formatToolPathForDisplay("apps/desktop/src/main.ts")).toBe(
			"apps/desktop/src/main.ts",
		)
	})

	test("does not leak absolute paths outside the project root", () => {
		expect(
			formatToolPathForDisplay("C:\\Users\\lenovo\\Other\\secrets.ts", {
				projectRoot: "C:\\Users\\lenovo\\Desktop\\devo",
			}),
		).toBe("Other/secrets.ts")
	})
})

describe("getFirstApplyPatchPath", () => {
	test("extracts paths from apply_patch input", () => {
		expect(
			getFirstApplyPatchPath(`*** Begin Patch
*** Update File: apps/desktop/src/main.ts
@@
*** End Patch`),
		).toBe("apps/desktop/src/main.ts")
	})

	test("extracts paths from git diff input", () => {
		expect(
			getFirstApplyPatchPath(`diff --git a/apps/desktop/src/main.ts b/apps/desktop/src/main.ts
--- a/apps/desktop/src/main.ts
+++ b/apps/desktop/src/main.ts`),
		).toBe("apps/desktop/src/main.ts")
	})
})
