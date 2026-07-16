/**
 * Brand the unpacked Electron.app used for `electron-vite dev` on macOS.
 *
 * Without this, macOS Notification Center / Launch Services keep the stock
 * "Electron" name (or a previous brand like "Devo") for the permission banner
 * and dock, even when `app.setName("InfiniteCode")` is set in main.
 *
 * Safe to re-run; force-registers with Launch Services so renames stick.
 */
import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, utimesSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

if (process.platform !== "darwin") {
	process.exit(0)
}

const appName = "InfiniteCode"
// Fresh-ish id so macOS Notification Center does not keep a cached display name
// from the previous "Devo" brand (same Electron.app path, old CFBundleName).
const bundleIdentifier = "com.infinitecode.desktop.development"
/** Previous brands — drop Launch Services records so banners stop saying "Devo". */
const legacyBundleIdentifiers = [
	"com.devo.desktop.dev",
	"com.infinitecode.desktop.dev",
	"com.github.Electron",
]

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopDir = dirname(scriptDir)
const electronAppPath = join(desktopDir, "node_modules/electron/dist/Electron.app")
const plistPath = join(electronAppPath, "Contents/Info.plist")
const iconSourcePath = join(desktopDir, "resources/icon.icns")
const iconTargetPath = join(electronAppPath, "Contents/Resources/electron.icns")

if (!existsSync(plistPath) || !existsSync(iconSourcePath)) {
	process.exit(0)
}

function setPlistString(plist, key, value) {
	try {
		execFileSync("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plist], {
			stdio: "ignore",
		})
	} catch {
		execFileSync("/usr/libexec/PlistBuddy", ["-c", `Add :${key} string ${value}`, plist], {
			stdio: "ignore",
		})
	}
}

function lsregister(args) {
	const bin =
		"/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
	if (!existsSync(bin)) return
	try {
		execFileSync(bin, args, { stdio: "ignore" })
	} catch {
		// Best-effort — branding still applies via Info.plist + app.setName.
	}
}

mkdirSync(dirname(iconTargetPath), { recursive: true })
copyFileSync(iconSourcePath, iconTargetPath)

// Main app identity (what macOS shows in ““App” Notifications” banners).
setPlistString(plistPath, "CFBundleName", appName)
setPlistString(plistPath, "CFBundleDisplayName", appName)
setPlistString(plistPath, "CFBundleIdentifier", bundleIdentifier)
setPlistString(plistPath, "CFBundleIconFile", "electron.icns")

// Drop any stale Launch Services record for this path / old brand, then re-add.
lsregister(["-u", electronAppPath])
for (const id of legacyBundleIdentifiers) {
	// -u with a fake path is ignored; path-based unregister above is what matters.
	void id
}
lsregister(["-f", "-R", "-trusted", electronAppPath])

const now = new Date()
utimesSync(electronAppPath, now, now)
// Nudge Spotlight / Launch Services mtime cache.
try {
	utimesSync(plistPath, now, now)
} catch {
	// ignore
}

console.log(`Branded Electron dev app as ${appName} (${bundleIdentifier})`)
