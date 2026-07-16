import type { JSX } from "react"

/**
 * Adsterra Native Ad (container-based, blends into content).
 *
 * Relies on the invoke.js script loaded in index.html which auto-discovers
 * this container by ID and fills it with native ad content.
 *
 * Note: only ONE container with this ID can be on the page at a time.
 */
export function NativeAd({ className }: { className?: string }): JSX.Element {
	return (
		<div
			id="container-ba7ceb35501edf7bae9f9a9e268cb6ca"
			className={className}
		/>
	)
}
