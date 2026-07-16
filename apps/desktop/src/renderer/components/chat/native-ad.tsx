/**
 * Adsterra Native Ad component.
 *
 * Renders the container div that the Adsterra invoke.js script discovers
 * and fills with a native widget. The invoke.js script is loaded once
 * in index.html via a <script> tag.
 *
 * Placement tips:
 * - Above the input card → feels like a native banner before composing
 * - In the message feed   → feels like a native in-feed ad while scrolling
 */
export function NativeAd({ className }: { className?: string }) {
	return (
		<div
			id="container-ba7ceb35501edf7bae9f9a9e268cb6ca"
			className={className}
		/>
	)
}
