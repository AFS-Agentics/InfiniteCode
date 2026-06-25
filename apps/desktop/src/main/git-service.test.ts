import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { listBranches } from "./git-service"

describe("git service", () => {
	test("returns an empty branch summary for non-git directories", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "devo-git-service-"))
		try {
			await expect(listBranches(directory)).resolves.toEqual({
				current: "",
				detached: false,
				local: [],
				remote: [],
			})
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})
})
