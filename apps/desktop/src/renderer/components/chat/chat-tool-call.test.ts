import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"
import { getToolDuration, getToolSubtitle, shouldDefaultOpen } from "./chat-tool-call"

const elapsedHookSource = readFileSync(new URL("../../hooks/use-elapsed-time.ts", import.meta.url), "utf8")
const chatToolCallSource = readFileSync(new URL("./chat-tool-call.tsx", import.meta.url), "utf8")
const rendererCssSource = readFileSync(new URL("../../index.css", import.meta.url), "utf8")

describe("shouldDefaultOpen", () => {
	test("keeps all tool output collapsed by default", () => {
		expect({
			bash: shouldDefaultOpen("bash", "completed"),
			read: shouldDefaultOpen("read", "completed"),
			bashError: shouldDefaultOpen("bash", "error"),
			readError: shouldDefaultOpen("read", "error"),
			unknown: shouldDefaultOpen("unknown", "error"),
		}).toEqual({
			bash: false,
			read: false,
			bashError: false,
			readError: false,
			unknown: false,
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
						input: { filePath: "C:\\Users\\lenovo\\Desktop\\infinitecode\\apps\\desktop\\src\\main.ts" },
						status: "completed",
						time: { end: 1, start: 0 },
						output: "",
					},
				} as any,
				{ projectRoot: "C:\\Users\\lenovo\\Desktop\\infinitecode" },
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
						input: { path: "C:\\Users\\lenovo\\Desktop\\infinitecode\\README.md" },
						status: "completed",
						time: { end: 1, start: 0 },
						output: "",
					},
				} as any,
				{ projectRoot: "C:\\Users\\lenovo\\Desktop\\infinitecode" },
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
*** Update File: C:\\Users\\lenovo\\Desktop\\infinitecode\\apps\\desktop\\src\\main.ts
@@
*** End Patch`,
						},
						status: "completed",
						time: { end: 1, start: 0 },
						output: "",
					},
				} as any,
				{ projectRoot: "C:\\Users\\lenovo\\Desktop\\infinitecode" },
			),
		).toBe("apps/desktop/src/main.ts")
	})
})

describe("read tool output density source", () => {
	test("overrides CodeBlock internal text sizing for read output", () => {
		expect({
			readClass: chatToolCallSource.includes("infinitecode-read-output"),
			preRule: rendererCssSource.includes(".infinitecode-read-output pre"),
			codeRule: rendererCssSource.includes(".infinitecode-read-output code"),
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
