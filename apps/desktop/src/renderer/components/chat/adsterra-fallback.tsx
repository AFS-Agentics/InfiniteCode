import { type JSX, useEffect, useRef } from "react"

type GravityPlacement =
	| "above_response"
	| "below_response"
	| "inline_response"
	| "search_result"
	| "bottom_page"
	| "sidebar"
	| "mid_response"
	| "mid_timeline"
	| "startup_overlay"

interface AdsterraSlot {
	containerId: string
	scriptSrc: string
}

const ADSTERRA_SLOTS: Record<GravityPlacement, AdsterraSlot> = {
	above_response: {
		containerId: "container-dbffd4bb6aab1ead6bb05117a7263848",
		scriptSrc: "https://pl30440053.effectivecpmnetwork.com/dbffd4bb6aab1ead6bb05117a7263848/invoke.js",
	},
	below_response: {
		containerId: "container-cca3b61cc8aaf5f2a02e0023bc5e7592",
		scriptSrc: "https://pl30440081.effectivecpmnetwork.com/cca3b61cc8aaf5f2a02e0023bc5e7592/invoke.js",
	},
	inline_response: {
		containerId: "container-bebbea40bd5b18c3eba3c47039f730cd",
		scriptSrc: "https://pl30440084.effectivecpmnetwork.com/bebbea40bd5b18c3eba3c47039f730cd/invoke.js",
	},
	search_result: {
		containerId: "container-8f42a126aafc27189f56130789147df4",
		scriptSrc: "https://pl30440089.effectivecpmnetwork.com/8f42a126aafc27189f56130789147df4/invoke.js",
	},
	bottom_page: {
		containerId: "container-2094b8945c4daf9561b4e7286ec34a3d",
		scriptSrc: "https://pl30440097.effectivecpmnetwork.com/2094b8945c4daf9561b4e7286ec34a3d/invoke.js",
	},
	sidebar: {
		containerId: "container-08de200ac6dd6880f5ec296310440f44",
		scriptSrc: "https://pl30440099.effectivecpmnetwork.com/08de200ac6dd6880f5ec296310440f44/invoke.js",
	},
	mid_response: {
		containerId: "container-af6c03f7f08ea5d178bcbc658eb02b06",
		scriptSrc: "https://pl30440151.effectivecpmnetwork.com/af6c03f7f08ea5d178bcbc658eb02b06/invoke.js",
	},
	mid_timeline: {
		containerId: "container-705d823e476483950dc21fafa431abf3",
		scriptSrc: "https://pl30440154.effectivecpmnetwork.com/705d823e476483950dc21fafa431abf3/invoke.js",
	},
	startup_overlay: {
		containerId: "container-ba7ceb35501edf7bae9f9a9e268cb6ca",
		scriptSrc: "https://pl30395772.effectivecpmnetwork.com/ba7ceb35501edf7bae9f9a9e268cb6ca/invoke.js",
	},
}

export function AdsterraFallbackAd({
	placement,
}: {
	placement: GravityPlacement;
}): JSX.Element {
	const elRef = useRef<HTMLDivElement>(null)
	const cleanupRef = useRef<(() => void) | null>(null)

	useEffect(() => {
		const slot = ADSTERRA_SLOTS[placement]
		if (!slot) return
		if (cleanupRef.current) return

		if (!document.getElementById(slot.containerId)) {
			const container = document.createElement("div")
			container.id = slot.containerId
			container.setAttribute("data-adsterra-src", slot.scriptSrc)

			elRef.current?.appendChild(container)
		}

		const existingScript = document.querySelector(
			`script[src="${slot.scriptSrc}"]`,
		)
		if (!existingScript) {
			const s = document.createElement("script")
			s.src = slot.scriptSrc
			s.setAttribute("data-cfasync", "false")
			s.async = true
			document.head.appendChild(s)
		}

		cleanupRef.current = () => {
			const container = document.getElementById(slot.containerId)
			if (container && elRef.current?.contains(container)) {
				container.remove()
			}
			const script = document.querySelector(
				`script[src="${slot.scriptSrc}"]`,
			)
			if (script) script.remove()
			cleanupRef.current = null
		}

		return cleanupRef.current
	}, [placement])

	return (
		<div
			ref={elRef}
			data-adsterra-fallback={placement}
		/>
	)
}
