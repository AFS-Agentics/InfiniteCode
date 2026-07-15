import { app } from "electron"
import { checkInfiniteCodeProgram, type InfiniteCodeCheckResult } from "./compatibility"
import { resolveProgram } from "./infinitecode-program"

export async function checkDesktopRuntime(): Promise<InfiniteCodeCheckResult> {
	let program: string
	try {
		program = resolveProgram({
			appPath: app.getAppPath(),
			env: process.env,
			isPackaged: app.isPackaged,
			resourcesPath: process.resourcesPath,
		})
	} catch (error) {
		return {
			installed: false,
			version: null,
			path: null,
			compatible: false,
			compatibility: "unknown",
			message: error instanceof Error ? error.message : String(error),
		}
	}

	return checkInfiniteCodeProgram({ program })
}
