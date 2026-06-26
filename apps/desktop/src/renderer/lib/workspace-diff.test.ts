import { describe, expect, test } from "bun:test"
import type { WorkspaceChangeView } from "@devo-ai/sdk/v2/client"
import { workspacePatchFilesFromView } from "./workspace-diff"

describe("workspacePatchFilesFromView", () => {
	test("splits unified git diff into per-file patch entries", () => {
		const view = {
			scope: "turn",
			status: "ready",
			workspace_root: "/repo",
			coverage: "git_visible",
			attribution: "workspace_net",
			change_set_status: "finalized",
			files: [
				file("src/a.ts", "modified", 1, 1),
				file("src/b.ts", "added", 1, 0),
				file("src/c.ts", "deleted", 0, 1),
			],
			stats: { files_changed: 3, additions: 2, deletions: 2 },
			unified_diff: [
				"diff --git a/src/a.ts b/src/a.ts",
				"--- a/src/a.ts",
				"+++ b/src/a.ts",
				"@@ -1 +1 @@",
				"-old",
				"+new",
				"diff --git a/src/b.ts b/src/b.ts",
				"--- /dev/null",
				"+++ b/src/b.ts",
				"@@ -0,0 +1 @@",
				"+new",
				"diff --git a/src/c.ts b/src/c.ts",
				"--- a/src/c.ts",
				"+++ /dev/null",
				"@@ -1 +0,0 @@",
				"-old",
			].join("\n"),
			warnings: [],
			generated_at: "2026-06-26T00:00:00Z",
		} as unknown as WorkspaceChangeView

		expect(workspacePatchFilesFromView(view)).toEqual([
			expect.objectContaining({ file: "src/a.ts", patch: expect.stringContaining("-old") }),
			expect.objectContaining({ file: "src/b.ts", patch: expect.stringContaining("+new") }),
			expect.objectContaining({ file: "src/c.ts", patch: expect.stringContaining("-old") }),
		])
	})

	test("keeps metadata-only files visible", () => {
		const view = {
			scope: "turn",
			status: "partial",
			workspace_root: "/repo",
			coverage: "partial",
			attribution: "workspace_net",
			change_set_status: "finalized",
			files: [file("asset.bin", "modified", 0, 0, true, true)],
			stats: { files_changed: 1, additions: 0, deletions: 0 },
			warnings: ["large_file_without_text_diff"],
			generated_at: "2026-06-26T00:00:00Z",
		} as unknown as WorkspaceChangeView

		expect(workspacePatchFilesFromView(view)).toEqual([
			{
				file: "asset.bin",
				status: "modified",
				rawStatus: "modified",
				additions: 0,
				deletions: 0,
				binary: true,
				diffTruncated: true,
				patch: null,
				warnings: ["Binary file", "Diff truncated", "No text diff available"],
			},
		])
	})
})

function file(
	path: string,
	status: "added" | "modified" | "deleted",
	additions: number,
	deletions: number,
	binary = false,
	diffTruncated = false,
) {
	return {
		path,
		status,
		additions,
		deletions,
		binary,
		diff_truncated: diffTruncated,
	}
}
