/**
 * StartupAdGrid — 2×2 grid of AdsterraAd slots on the startup/landing screen.
 *
 * Each cell independently tries Adsterra first, then falls back to A-Ads
 * after 35s of nofill (same pattern as adsterra-ad.tsx).
 *
 * Freebuff-inspired: uses the cold-boot wait time to show multiple
 * ad creatives instead of a single banner.
 */

import { type JSX } from "react"
import { AdsterraAd } from "./chat/adsterra-ad"

const GRID_PLACEMENTS = [
	"startup_grid_0",
	"startup_grid_1",
	"startup_grid_2",
	"startup_grid_3",
] as const

export function StartupAdGrid(): JSX.Element {
	return (
		<div className="grid grid-cols-2 gap-2 w-full">
			{GRID_PLACEMENTS.map((placement) => (
				<AdsterraAd
					key={placement}
					placement={placement}
					refreshIntervalMs={60_000}
				/>
			))}
		</div>
	)
}
