import fs from "node:fs"
import path from "node:path"

export interface ResolveProgramOptions {
	appPath: string
	env: NodeJS.ProcessEnv
	existsSync?: (path: string) => boolean
	isPackaged: boolean
	platform?: NodeJS.Platform
	resourcesPath?: string
}

const PATH_DEVO = "infinitecode"
const OVERRIDE_ENV = "INFINITECODE_DESKTOP_BIN"

export function resolveProgram({
	appPath,
	env,
	existsSync = fs.existsSync,
	isPackaged,
	platform = process.platform,
	resourcesPath,
}: ResolveProgramOptions): string {
	const override = env[OVERRIDE_ENV]?.trim()
	if (override) return override

	if (isPackaged) {
		const runtimeRoot = resourcesPath ?? path.join(appPath, "..")
		const bundled = path.join(runtimeRoot, "runtime", "bin", executableName(platform))
		if (existsSync(bundled)) return bundled
		throw new Error(`Bundled InfiniteCode runtime not found at ${bundled}`)
	}

	const checkoutRoot = path.resolve(appPath, "../..")
	const candidates = [
		path.join(checkoutRoot, "target", "debug", "infinitecode.exe"),
		path.join(checkoutRoot, "target", "debug", "infinitecode"),
		path.join(checkoutRoot, "target", "release", "infinitecode.exe"),
		path.join(checkoutRoot, "target", "release", "infinitecode"),
	]

	return candidates.find(existsSync) ?? PATH_DEVO
}

function executableName(platform: NodeJS.Platform): string {
	return platform === "win32" ? "infinitecode.exe" : "infinitecode"
}
