import { describe, expect, test } from "bun:test"
import type { SidebarProject } from "../../lib/types"
import { sortSidebarProjectsForDefaultList } from "./agents"

function project(
	name: string,
	directory: string,
	lastActiveAt: number,
	hasActiveAgent = false,
): SidebarProject {
	return {
		id: `${name}-id`,
		slug: `${name}-slug`,
		name,
		directory,
		agentCount: lastActiveAt > 0 ? 1 : 0,
		lastActiveAt,
		hasActiveAgent,
	}
}

describe("project list ordering", () => {
	test("default project order follows discovery order when activity fields change", () => {
		const alpha = project("alpha", "/repo/alpha", 10)
		const beta = project("beta", "/repo/beta", 90, true)
		const gamma = project("gamma", "/repo/gamma", 0)
		const activeAlpha = project("alpha", "/repo/alpha", 120, true)
		const idleBeta = project("beta", "/repo/beta", 20)
		const discoveryOrder = [beta.directory, alpha.directory, gamma.directory]

		expect(sortSidebarProjectsForDefaultList([beta, gamma, alpha], discoveryOrder)).toEqual([
			beta,
			alpha,
			gamma,
		])
		expect(sortSidebarProjectsForDefaultList([idleBeta, gamma, activeAlpha], discoveryOrder)).toEqual([
			idleBeta,
			activeAlpha,
			gamma,
		])
	})

	test("default project order falls back to name for projects outside discovery", () => {
		const alpha = project("alpha", "/repo/alpha", 10)
		const beta = project("beta", "/repo/beta", 90, true)
		const gamma = project("gamma", "/repo/gamma", 0)

		expect(sortSidebarProjectsForDefaultList([beta, gamma, alpha], [])).toEqual([
			alpha,
			beta,
			gamma,
		])
	})
})
