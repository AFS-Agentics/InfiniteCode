import { useEffect, useRef, type JSX } from "react"

const CONTAINER_ID = "container-ba7ceb35501edf7bae9f9a9e268cb6ca"
const INVOKE_URL =
	"https://pl30395772.effectivecpmnetwork.com/ba7ceb35501edf7bae9f9a9e268cb6ca/invoke.js"

/** Words that flag an ad as 18+/inappropriate — hide the container on match. */
const BLOCKED_WORDS = [
	"hot",
	"sexy",
	"sex",
	"porn",
	"adult",
	"18+",
	"dating",
	"escort",
	"nude",
	"naked",
	"hentai",
	"milf",
	"horny",
]

function containsBlockedWord(text: string): boolean {
	const lower = text.toLowerCase()
	return BLOCKED_WORDS.some((word) => lower.includes(word))
}

/**
 * Adsterra Native Ad with client-side content filtering.
 *
 * Loads invoke.js dynamically after the container is mounted, then watches
 * for ad content via MutationObserver. If the ad text contains any blocked
 * words (18+, adult, etc.), the container is hidden.
 */
export function NativeAd({ className }: { className?: string }): JSX.Element {
	const containerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const container = containerRef.current
		if (!container) return

		// Watch for ad content injected by invoke.js
		const observer = new MutationObserver(() => {
			const text = container.textContent ?? ""
			if (containsBlockedWord(text)) {
				container.style.display = "none"
				observer.disconnect()
			}
		})

		observer.observe(container, { childList: true, subtree: true, characterData: true })

		// Load invoke.js after container is mounted
		const script = document.createElement("script")
		script.src = INVOKE_URL
		script.async = true
		script.setAttribute("data-cfasync", "false")
		container.appendChild(script)

		return () => {
			observer.disconnect()
			script.remove()
		}
	}, [])

	return <div ref={containerRef} id={CONTAINER_ID} className={className} />
}
