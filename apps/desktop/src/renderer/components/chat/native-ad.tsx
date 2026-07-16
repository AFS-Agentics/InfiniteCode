import { useEffect, useRef, type JSX } from "react"

const CONTAINER_ID = "container-ba7ceb35501edf7bae9f9a9e268cb6ca"
const INVOKE_URL =
	"https://pl30395772.effectivecpmnetwork.com/ba7ceb35501edf7bae9f9a9e268cb6ca/invoke.js"

/**
 * Adsterra Native Ad (container-based, blends into content).
 *
 * Loads invoke.js dynamically only after the container div is in the DOM,
 * so the ad script finds the container immediately and doesn't inject
 * a fallback element at the top of the page.
 */
export function NativeAd({ className }: { className?: string }): JSX.Element {
	const containerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const container = containerRef.current
		if (!container) return

		// Load invoke.js after container is mounted
		const script = document.createElement("script")
		script.src = INVOKE_URL
		script.async = true
		script.setAttribute("data-cfasync", "false")
		container.appendChild(script)

		return () => {
			// Cleanup: remove the script when component unmounts
			script.remove()
		}
	}, [])

	return <div ref={containerRef} id={CONTAINER_ID} className={className} />
}
