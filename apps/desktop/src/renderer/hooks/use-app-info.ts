import { useEffect, useState } from "react"
import type { AppInfo } from "../../preload/api"

const isElectron = typeof window !== "undefined" && "infinitecode" in window

export function useAppInfo() {
	const [info, setInfo] = useState<AppInfo | null>(null)

	useEffect(() => {
		if (!isElectron) return
		window.infinitecode.getAppInfo().then(setInfo)
	}, [])

	return info
}
