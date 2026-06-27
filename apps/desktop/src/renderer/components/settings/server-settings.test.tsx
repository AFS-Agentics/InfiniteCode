import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { AcpTrafficLogStatus, ServerSettings } from "./server-settings"

describe("ServerSettings", () => {
	test("keeps runtime status and restart controls without transport or stop rows", () => {
		const markup = renderToStaticMarkup(<ServerSettings />)

		expect({
			hasServerHeading: markup.includes(">Server</h2>"),
			hasLocalRuntime: markup.includes("Local runtime"),
			hasRestartRuntime: markup.includes("Restart runtime"),
			hasRestartButton: markup.includes(">Restart</button>"),
			hasTransportRow: markup.includes("Transport"),
			hasTransportDescription: markup.includes("ACP over child-process stdin/stdout"),
			hasStopRuntime: markup.includes("Stop runtime"),
			hasStopDescription: markup.includes("Stop the managed Devo child process"),
				hasDeveloperMode: markup.includes("Developer mode"),
				hasDeveloperOptions: markup.includes("Developer options"),
				hasAcpTrafficLog: markup.includes("ACP traffic log"),
				hasNetworkProxy: markup.includes("Network proxy"),
				hasProxyMode: markup.includes("Proxy mode"),
				hasRestartNotice: markup.includes("Restart runtime to apply proxy changes."),
			}).toEqual({
				hasServerHeading: true,
				hasLocalRuntime: true,
				hasRestartRuntime: true,
			hasRestartButton: true,
			hasTransportRow: false,
			hasTransportDescription: false,
				hasStopRuntime: false,
				hasStopDescription: false,
				hasDeveloperMode: false,
				hasDeveloperOptions: false,
				hasAcpTrafficLog: false,
				hasNetworkProxy: true,
				hasProxyMode: true,
				hasRestartNotice: true,
			})
		})

	test("shows a collapsed developer trigger without the log path when enabled", () => {
		const logPath = "/Users/tester/Library/Application Support/Devo/logs/acp-traffic/traffic.jsonl"
		const markup = renderToStaticMarkup(
			<AcpTrafficLogStatus
				state={{
					enabled: true,
					path: logPath,
				}}
			/>,
		)

		expect({
			hasDeveloperOptions: markup.includes("Developer options"),
			hasTrigger: markup.includes("ACP traffic log"),
			hasDescription: markup.includes("View the current JSONL log location"),
			hasCollapsedState: markup.includes('aria-expanded="false"'),
			hasPath: markup.includes(logPath),
			hasSensitiveHint: markup.includes("prompts, paths, tool arguments, and provider details"),
			hasSwitch: markup.includes("switch"),
		}).toEqual({
			hasDeveloperOptions: true,
			hasTrigger: true,
			hasDescription: true,
			hasCollapsedState: true,
			hasPath: false,
			hasSensitiveHint: false,
			hasSwitch: false,
		})
	})

	test("shows log location details when the developer trigger is expanded", () => {
		const logPath = "/Users/tester/Library/Application Support/Devo/logs/acp-traffic/traffic.jsonl"
		const markup = renderToStaticMarkup(
			<AcpTrafficLogStatus
				initialExpanded
				state={{
					enabled: true,
					path: logPath,
				}}
			/>,
		)

		expect({
			hasExpandedState: markup.includes('aria-expanded="true"'),
			hasPath: markup.includes(logPath),
			hasSensitiveHint: markup.includes("prompts, paths, tool arguments, and provider details"),
			hasSwitch: markup.includes("switch"),
		}).toEqual({
			hasExpandedState: true,
			hasPath: true,
			hasSensitiveHint: true,
			hasSwitch: false,
		})
	})
})
