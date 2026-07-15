import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaultInfiniteCodeSourcePath, runtimeBinaryName, stageRuntime } from "./prepare-runtime"

describe("prepare-runtime helpers", () => {
	test("uses platform executable names", () => {
		expect({
			darwin: runtimeBinaryName("infinitecode", "darwin"),
			linux: runtimeBinaryName("infinitecode", "linux"),
			win32: runtimeBinaryName("infinitecode", "win32"),
		}).toEqual({
			darwin: "infinitecode",
			linux: "infinitecode",
			win32: "infinitecode.exe",
		})
	})

	test("resolves cargo release output by target triple", () => {
		expect(
			defaultInfiniteCodeSourcePath({
				repoRoot: "/repo",
				targetTriple: "x86_64-apple-darwin",
				platform: "darwin",
			}),
		).toBe(join("/repo", "target", "x86_64-apple-darwin", "release", "infinitecode"))
	})

	test("derives Windows executable names from target triples", () => {
		expect(
			defaultInfiniteCodeSourcePath({
				repoRoot: "/repo",
				targetTriple: "x86_64-pc-windows-msvc",
				platform: "darwin",
			}),
		).toBe(join("/repo", "target", "x86_64-pc-windows-msvc", "release", "infinitecode.exe"))
	})

	test("requires explicit ripgrep sidecar for cross-target staging", () => {
		const root = mkdtempSync(join(tmpdir(), "infinitecode-runtime-test-"))
		const repoRoot = join(root, "repo")
		const desktopDir = join(root, "desktop")
		const targetDir = join(repoRoot, "target", "aarch64-apple-darwin", "release")
		mkdirSync(targetDir, { recursive: true })
		mkdirSync(desktopDir, { recursive: true })
		writeFileSync(join(targetDir, "infinitecode"), "")

		expect(() =>
			stageRuntime({
				desktopDir,
				repoRoot,
				targetTriple: "aarch64-apple-darwin",
				hostPlatform: "linux",
				hostArch: "x64",
			}),
		).toThrow("ripgrep sidecar for cross-target aarch64-apple-darwin must be passed")
		expect(existsSync(join(desktopDir, "resources", "runtime", "bin"))).toBe(false)
	})

	test("stages InfiniteCode and ripgrep sidecars into the desktop runtime directory", () => {
		const root = mkdtempSync(join(tmpdir(), "infinitecode-runtime-test-"))
		const desktopDir = join(root, "desktop")
		const sourceDir = join(root, "source")
		const infinitecodeBin = join(sourceDir, "infinitecode")
		const rgBin = join(sourceDir, "rg")
		mkdirSync(sourceDir, { recursive: true })
		writeFileSync(infinitecodeBin, "infinitecode")
		writeFileSync(rgBin, "rg")

		stageRuntime({
			desktopDir,
			repoRoot: root,
			platform: "darwin",
			infinitecodeBin,
			rgBin,
		})

		expect({
			infinitecode: readFileSync(join(desktopDir, "resources", "runtime", "bin", "infinitecode"), "utf8"),
			rg: readFileSync(join(desktopDir, "resources", "runtime", "bin", "rg"), "utf8"),
		}).toEqual({
			infinitecode: "infinitecode",
			rg: "rg",
		})
	})
})
