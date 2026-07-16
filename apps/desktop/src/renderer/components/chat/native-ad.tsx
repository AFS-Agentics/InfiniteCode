import { useEffect, useRef, type JSX } from "react"

const CONTAINER_ID = "container-ba7ceb35501edf7bae9f9a9e268cb6ca"
const INVOKE_URL =
	"https://pl30395772.effectivecpmnetwork.com/ba7ceb35501edf7bae9f9a9e268cb6ca/invoke.js"
const WORDLIST_URL =
	"https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en"

/** Extra words the LDNOOBW list misses — e.g. "hot" catches "hottest" */
const EXTRA_WORDS = ["hot", "sexy", "beauty", "beautiful", "cam", "live sex", "dating"]

let cachedWords: string[] | null = null

async function fetchBlockedWords(): Promise<string[]> {
	if (cachedWords) return cachedWords
	try {
		const res = await fetch(WORDLIST_URL)
		const text = await res.text()
		const base = text
			.split("\n")
			.map((w) => w.trim().toLowerCase())
			.filter((w) => w.length > 0 && !w.startsWith("#"))
		cachedWords = [...new Set([...base, ...EXTRA_WORDS])]
		return cachedWords
	} catch {
		return EXTRA_WORDS
	}
}

/**
 * Adsterra Native Ad with client-side content filtering.
 *
 * The invoke.js script is loaded in the document body (before the container)
 * so it can find the container by ID and inject content properly.
 */
export function NativeAd({ className }: { className?: string }): JSX.Element {
	const containerRef = useRef<HTMLDivElement>(null)
	const wordsRef = useRef<string[]>(cachedWords ?? [])

	// Fetch word list once per session
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

		// Load invoke.js into document body before the container
		const script = document.createElement("script")
		script.src = INVOKE_URL
		script.async = true
		script.setAttribute("data-cfasync", "false")
		container.parentNode?.insertBefore(script, container)

		// Watch for ad content injected into the container
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

		return () => {
			observer.disconnect()
			script.remove()
		}
	}, [])

	return <div ref={containerRef} id={CONTAINER_ID} className={className} />
}
