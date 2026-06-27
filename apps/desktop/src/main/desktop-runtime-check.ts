import { app } from "electron"
import { checkDevoProgram, type DevoCheckResult } from "./compatibility"
import { resolveDevoProgram } from "./devo-program"

export async function checkDesktopRuntime(): Promise<DevoCheckResult> {
	let program: string
	try {
		program = resolveDevoProgram({
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

	return checkDevoProgram({ program })
}
