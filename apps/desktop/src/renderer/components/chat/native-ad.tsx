import { useEffect, useRef, type JSX } from "react"

const CONTAINER_ID = "container-ba7ceb35501edf7bae9f9a9e268cb6ca"
const INVOKE_URL =
	"https://pl30395772.effectivecpmnetwork.com/ba7ceb35501edf7bae9f9a9e268cb6ca/invoke.js"
const WORDLIST_URL =
	"https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en"

let cachedWords: string[] | null = null

async function fetchBlockedWords(): Promise<string[]> {
	if (cachedWords) return cachedWords
	try {
		const res = await fetch(WORDLIST_URL)
		const text = await res.text()
		cachedWords = text
			.split("\n")
			.map((w) => w.trim().toLowerCase())
			.filter((w) => w.length > 0 && !w.startsWith("#"))
		return cachedWords
	} catch {
		return []
	}
}

/**
 * Adsterra Native Ad with client-side content filtering.
 *
 * Loads invoke.js dynamically after the container is mounted, then watches
 * for ad content via MutationObserver. If the ad text contains any blocked
 * words (fetched from the LDNOOBW list on GitHub), the container is hidden.
 */
export function NativeAd({ className }: { className?: string }): JSX.Element {
	const containerRef = useRef<HTMLDivElement>(null)
	const wordsRef = useRef<string[]>(cachedWords ?? [])

	// Fetch word list once per session, store in ref
	useEffect(() => {
		if (wordsRef.current.length === 0) {
			fetchBlockedWords().then((words) => {
				wordsRef.current = words
			})
		}
	}, [])

	useEffect(() => {
		const container = containerRef.current
		if (!container) return

		// Watch for ad content injected by invoke.js
		const observer = new MutationObserver(() => {
			const blockedWords = wordsRef.current
			if (blockedWords.length === 0) return
			const text = container.textContent ?? ""
			const lower = text.toLowerCase()
			if (blockedWords.some((word) => lower.includes(word))) {
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
