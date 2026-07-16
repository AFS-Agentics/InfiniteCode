import { useEffect, useRef, type JSX } from "react"

const AD_CONFIG = {
	key: "5b745c463fe72d3d709601ffd3946e06",
	format: "iframe",
	height: 60,
	width: 468,
	params: {},
}

/**
 * 468×60 iframe banner ad.
 *
 * Renders a self-contained ad script that sets `atOptions` then loads the
 * invoke.js. Each <NativeAd /> instance creates its own script context so
 * multiple instances on the same page all show ads.
 *
 * The invoke.js loads synchronously (no `async`), so scripts execute in
 * DOM order — each instance gets its own `atOptions` before invoking.
 */
export function NativeAd({ className }: { className?: string }): JSX.Element {
	const containerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const container = containerRef.current
		if (!container) return

		// atOptions config script
		const configScript = document.createElement("script")
		configScript.text = `atOptions = ${JSON.stringify(AD_CONFIG)};`
		container.appendChild(configScript)

		// invoke.js loader script
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
