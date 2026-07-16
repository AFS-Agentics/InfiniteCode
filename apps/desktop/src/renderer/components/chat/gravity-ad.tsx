import { GravityAd as GravityAdComponent } from "@gravity-ai/react"
import { useEffect, useState, type JSX } from "react"

interface GravityAdData {
	adText: string
	title?: string
	cta?: string
	brandName?: string
	url?: string
	favicon?: string
	impUrl?: string
	clickUrl?: string
	[key: string]: unknown
}

/**
 * Fetches a contextual ad from Gravity via IPC and renders it using the
 * Gravity React SDK. The ad request includes the last few conversation turns
 * so Gravity can match relevant ads.
 */
export function GravityAd({
	messages,
}: {
	/** Last 2–4 conversation turns for contextual ad matching. */
	messages: { role: string; content: string }[]
}): JSX.Element {
	const [ad, setAd] = useState<GravityAdData | null>(null)

	useEffect(() => {
		let cancelled = false

		async function load() {
			if (!window.infinitecode?.gravity?.getAds) return
			try {
				const ads = await window.infinitecode.gravity.getAds(messages)
				if (!cancelled && ads.length > 0) {
					setAd(ads[0] as GravityAdData)
				}
			} catch {
				// Silently fail — no ad shown
			}
		}

		void load()
		return () => {
			cancelled = true
		}
	}, [messages])

	if (!ad) return <></>

	return (
		<div className="py-4">
			<GravityAdComponent ad={ad} variant="card" />
		</div>
	)
}
