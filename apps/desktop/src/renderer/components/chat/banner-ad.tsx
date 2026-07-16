import { useEffect, useRef, type JSX } from "react"

const AD_CONFIG = {
	key: "5b745c463fe72d3d709601ffd3946e06",
	format: "iframe",
	height: 60,
	width: 468,
	params: {},
}

/**
 * 468×60 traditional iframe banner ad.
 *
 * Self-contained script — each instance creates its own `atOptions` + invoke.js
 * so multiple instances on the same page all show ads independently.
 */
export function BannerAd({ className }: { className?: string }): JSX.Element {
	const containerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const container = containerRef.current
		if (!container) return

		const configScript = document.createElement("script")
		configScript.text = `atOptions = ${JSON.stringify(AD_CONFIG)};`
		container.appendChild(configScript)

		const invokeScript = document.createElement("script")
		invokeScript.src =
			"https://www.highperformanceformat.com/5b745c463fe72d3d709601ffd3946e06/invoke.js"
		container.appendChild(invokeScript)

		return () => {
			container.innerHTML = ""
		}
	}, [])

	return (
		<div
			ref={containerRef}
			className={className}
			style={{ minHeight: 60, width: "100%" }}
		/>
	)
}
