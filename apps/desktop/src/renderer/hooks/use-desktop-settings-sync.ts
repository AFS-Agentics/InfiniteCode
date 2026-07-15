import { useSetAtom } from "jotai"
import { useCallback, useEffect } from "react"
import type { AppSettings } from "../../preload/api"
import { desktopFoldersAtom } from "../atoms/desktop-folders"
import { colorSchemeAtom, displayModeAtom, hideThinkingWhileWorkingAtom, opaqueWindowsAtom, themeAtom } from "../atoms/preferences"
import { buildRendererPreferencesMigrationPatch } from "../lib/settings-sync"

function isElectron(): boolean {
	return typeof window !== "undefined" && "infinitecode" in window
}

export function useDesktopSettingsSync() {
	const setColorScheme = useSetAtom(colorSchemeAtom)
	const setTheme = useSetAtom(themeAtom)
	const setDisplayMode = useSetAtom(displayModeAtom)
	const setHideThinkingWhileWorking = useSetAtom(hideThinkingWhileWorkingAtom)
	const setOpaqueWindows = useSetAtom(opaqueWindowsAtom)
	const setDesktopFolders = useSetAtom(desktopFoldersAtom)

	const applySettings = useCallback(
		(settings: AppSettings) => {
			setColorScheme(settings.appearance.colorScheme)
			setTheme(settings.appearance.themeId)
			setDisplayMode(settings.appearance.displayMode)
			setHideThinkingWhileWorking(settings.appearance.hideThinkingWhileWorking)
			setOpaqueWindows(settings.opaqueWindows)
			setDesktopFolders(settings.desktopFolders.folders)
		},
		[setColorScheme, setDesktopFolders, setDisplayMode, setHideThinkingWhileWorking, setOpaqueWindows, setTheme],
	)

	useEffect(() => {
		if (!isElectron()) return

		let cancelled = false

		const hydrateSettings = async () => {
			try {
				let settings = await window.infinitecode.getSettings()
				const migrationPatch = buildRendererPreferencesMigrationPatch(settings, window.localStorage)
				if (migrationPatch) {
					settings = await window.infinitecode.updateSettings(migrationPatch)
				}
				if (!cancelled) applySettings(settings)
			} catch (err) {
				console.error("Failed to sync desktop settings:", err)
			}
		}

		void hydrateSettings()

		const unsubscribe = window.infinitecode.onSettingsChanged((settings) => {
			if (!cancelled) applySettings(settings)
		})

		return () => {
			cancelled = true
			unsubscribe()
		}
	}, [applySettings])
}
