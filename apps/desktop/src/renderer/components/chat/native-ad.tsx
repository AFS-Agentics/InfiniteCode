import { useEffect, useRef, type JSX } from "react"

const CONTAINER_ID = "container-ba7ceb35501edf7bae9f9a9e268cb6ca"
const INVOKE_URL =
	"https://pl30395772.effectivecpmnetwork.com/ba7ceb35501edf7bae9f9a9e268cb6ca/invoke.js"
const WORDLIST_URL =
	"https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en"

/** Extra words the LDNOOBW list misses */
const EXTRA_WORDS = ["hot", "sexy", "beauty", "beautiful", "cam", "live sex", "dating"]

let cachedWords: string[] | null = null
let wordLoadCallbacks: Array<() => void> = []

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
		// Notify all waiting instances
		wordLoadCallbacks.forEach((cb) => cb())
		wordLoadCallbacks = []
		return cachedWords
	} catch {
		cachedWords = EXTRA_WORDS
		wordLoadCallbacks.forEach((cb) => cb())
		wordLoadCallbacks = []
		return cachedWords
	}
}

function checkContainer(container: HTMLElement, words: string[]): boolean {
	const text = container.textContent ?? ""
	const lower = text.toLowerCase()
	return words.some((word) => lower.includes(word))
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
	const checkedRef = useRef(false)

	useEffect(() => {
		const container = containerRef.current
		if (!container) return

		// Load invoke.js into document body before the container
		const script = document.createElement("script")
		script.src = INVOKE_URL
		script.async = true
		script.setAttribute("data-cfasync", "false")
		container.parentNode?.insertBefore(script, container)

		// Try checking immediately (if words already cached)
		const tryCheck = () => {
			if (checkedRef.current) return
			const words = wordsRef.current
			if (words.length === 0) return false
			if (checkContainer(container, words)) {
				container.style.display = "none"
				checkedRef.current = true
				observer.disconnect()
			}
			checkedRef.current = true
			return true
		}

		// Watch for ad content injected into the container
		const observer = new MutationObserver(() => {
			if (tryCheck()) {
				observer.disconnect()
			}
		})

		observer.observe(container, { childList: true, subtree: true, characterData: true })

		// If words aren't loaded yet, register callback for when they arrive
		if (wordsRef.current.length === 0) {
			fetchBlockedWords()
			wordLoadCallbacks.push(() => {
				wordsRef.current = cachedWords!
				tryCheck()
			})
		}

		return () => {
			observer.disconnect()
			script.remove()
		}
	}, [])

	return <div ref={containerRef} id={CONTAINER_ID} className={className} />
}
