import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"

const source = readFileSync(new URL("./chat-turn.tsx", import.meta.url), "utf8")
const chatViewSource = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8")
const chatToolCallSource = readFileSync(new URL("./chat-tool-call.tsx", import.meta.url), "utf8")
const responseActionsProps =
	source.match(/\{responseText && \([\s\S]*?<MessageActions([^>]*)>/)?.[1] ?? ""

describe("ChatTurnComponent transcript controls", () => {
	test("keeps completed steps collapsed, suppresses zero-second footer, and shows actions", () => {
		expect({
			filtersToolsWhenCollapsed: source.includes(
				'orderedParts.filter((part) => part.kind !== "tool")',
			),
			suppressesSubSecondDuration: source.includes(
				'workTimeMs >= 1000 ? formatWorkDuration(workTimeMs) : ""',
			),
			usesAlwaysVisibleActions: responseActionsProps.trim() === "",
			usesHoverHiddenActions:
				responseActionsProps.includes("opacity-0") ||
				responseActionsProps.includes("group-hover/turn:opacity-100"),
		}).toEqual({
			filtersToolsWhenCollapsed: true,
			suppressesSubSecondDuration: true,
			usesAlwaysVisibleActions: true,
			usesHoverHiddenActions: false,
		})
	})

	test("wires pending permission requests into the active chat turn", () => {
		expect({
			chatTurnAcceptsPendingPermission: source.includes("pendingPermission?: PendingPermission"),
			chatTurnRendersPermissionItem:
				source.includes("<PermissionItem") && source.includes("pendingPermission.request"),
			chatViewPassesPermissionToLastTurn: chatViewSource.includes(
				"pendingPermission={index === turns.length - 1 ? effectivePermission : undefined}",
			),
			inputKeepsNoTurnPermissionFallback: chatViewSource.includes(
				"turns.length === 0 && effectivePermission",
			),
			permissionReplyClearsPendingCard:
				chatViewSource.includes("removePermissionAtom") &&
				chatViewSource.includes("removePermission({ sessionId: permissionSessionId, permissionId })"),
			noTurnPermissionFallbackUsesClearingHandlers:
				chatViewSource.includes("onApprove={handleApprovePermission}") &&
				chatViewSource.includes("onDeny={handleDenyPermission}"),
			chatToolCallKeepsUnusedPermissionProp: chatToolCallSource.includes("permission?:"),
		}).toEqual({
			chatTurnAcceptsPendingPermission: true,
			chatTurnRendersPermissionItem: true,
			chatViewPassesPermissionToLastTurn: true,
			inputKeepsNoTurnPermissionFallback: true,
			permissionReplyClearsPendingCard: true,
			noTurnPermissionFallbackUsesClearingHandlers: true,
			chatToolCallKeepsUnusedPermissionProp: false,
		})
	})
})
