import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"
import { getToolDuration, getToolSubtitle, shouldDefaultOpen } from "./chat-tool-call"

const elapsedHookSource = readFileSync(new URL("../../hooks/use-elapsed-time.ts", import.meta.url), "utf8")
const chatToolCallSource = readFileSync(new URL("./chat-tool-call.tsx", import.meta.url), "utf8")
const rendererCssSource = readFileSync(new URL("../../index.css", import.meta.url), "utf8")

describe("shouldDefaultOpen", () => {
	test("collapses tool output by default", () => {
		const tools = ["bash", "read", "edit", "write", "apply_patch", "glob", "grep", "list"]

		expect(Object.fromEntries(tools.map((tool) => [tool, shouldDefaultOpen(tool, "completed")]))).toEqual({
			bash: false,
			read: false,
			edit: false,
			write: false,
			apply_patch: false,
			glob: false,
			grep: false,
			list: false,
		})
	})

	test("keeps error output expanded", () => {
		expect({
			bash: shouldDefaultOpen("bash", "error"),
			read: shouldDefaultOpen("read", "error"),
			unknown: shouldDefaultOpen("unknown", "error"),
		}).toEqual({
			bash: true,
			read: true,
			unknown: true,
		})
	})
})

describe("getToolDuration", () => {
	test("uses SDK tool state start and end timestamps", () => {
		expect(
			getToolDuration({
				id: "tool-1",
				type: "tool",
				state: { status: "completed", time: { start: 1_000, end: 3_500 } },
			} as any),
		).toBe("2s")
	})

	test("clamps reversed timestamps instead of showing negative durations", () => {
		expect(
			getToolDuration({
				id: "tool-1",
				type: "tool",
				state: { status: "completed", time: { start: 3_500, end: 1_000 } },
			} as any),
		).toBe("0ms")
	})
})

describe("getToolSubtitle", () => {
	test("shows read paths relative to the project root", () => {
		expect(
			getToolSubtitle(
				{
					callID: "call-1",
					id: "tool-1",
					tool: "read",
					type: "tool",
					state: {
						input: { filePath: "C:\\Users\\lenovo\\Desktop\\devo\\apps\\desktop\\src\\main.ts" },
						status: "completed",
						time: { end: 1, start: 0 },
						output: "",
					},
				} as any,
				{ projectRoot: "C:\\Users\\lenovo\\Desktop\\devo" },
			),
		).toBe("apps/desktop/src/main.ts")
	})

	test("shows write paths relative to the project root", () => {
		expect(
			getToolSubtitle(
				{
					callID: "call-1",
					id: "tool-1",
					tool: "write",
					type: "tool",
					state: {
						input: { path: "C:\\Users\\lenovo\\Desktop\\devo\\README.md" },
						status: "completed",
						time: { end: 1, start: 0 },
						output: "",
					},
				} as any,
				{ projectRoot: "C:\\Users\\lenovo\\Desktop\\devo" },
			),
		).toBe("README.md")
	})

	test("shows apply_patch paths from patch input", () => {
		expect(
			getToolSubtitle(
				{
					callID: "call-1",
					id: "tool-1",
					tool: "apply_patch",
					type: "tool",
					state: {
						input: {
							patch: `*** Begin Patch
*** Update File: C:\\Users\\lenovo\\Desktop\\devo\\apps\\desktop\\src\\main.ts
@@
*** End Patch`,
						},
						status: "completed",
						time: { end: 1, start: 0 },
						output: "",
					},
				} as any,
				{ projectRoot: "C:\\Users\\lenovo\\Desktop\\devo" },
			),
		).toBe("apps/desktop/src/main.ts")
	})
})

describe("read tool output density source", () => {
	test("overrides CodeBlock internal text sizing for read output", () => {
		expect({
			readClass: chatToolCallSource.includes("devo-read-output"),
			preRule: rendererCssSource.includes(".devo-read-output pre"),
			codeRule: rendererCssSource.includes(".devo-read-output code"),
			lineHeight: rendererCssSource.includes("line-height: 1.35"),
		}).toEqual({
			readClass: true,
			preRule: true,
			codeRule: true,
			lineHeight: true,
		})
	})
})

describe("useToolElapsedTime source", () => {
	test("uses tool state time without renderer first-seen timestamps", () => {
		expect({
			usesStateStart: elapsedHookSource.includes("part.state.time"),
			usesFirstSeen: elapsedHookSource.includes("getPartFirstSeenAt"),
		}).toEqual({
			usesStateStart: true,
			usesFirstSeen: false,
		})
	})
})
