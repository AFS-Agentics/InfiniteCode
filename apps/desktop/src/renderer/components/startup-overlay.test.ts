import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"

const startupOverlaySource = readFileSync(new URL("./startup-overlay.tsx", import.meta.url), "utf8")
const indexHtmlSource = readFileSync(new URL("../index.html", import.meta.url), "utf8")
const indexCssSource = readFileSync(new URL("../index.css", import.meta.url), "utf8")

describe("startup overlay background", () => {
	test("uses the app background across the full React startup overlay", () => {
		expect({
			hasStartupSlot: startupOverlaySource.includes('data-slot="startup-overlay"'),
			hasBackgroundClass: startupOverlaySource.includes("bg-background text-foreground"),
			keepsFullScreenOverlay: startupOverlaySource.includes("fixed inset-0"),
		}).toEqual({
			hasStartupSlot: true,
			hasBackgroundClass: true,
			keepsFullScreenOverlay: true,
		})
	})

	test("uses a concrete pre-React splash background token", () => {
		expect({
			definesBackground: indexHtmlSource.includes("--infinitecode-startup-background: #181818"),
			definesLightBackground: indexHtmlSource.includes("--infinitecode-startup-background: #ffffff"),
			appliesToHtml: indexHtmlSource.includes("html {"),
			appliesToBody: indexHtmlSource.includes("body {"),
			appliesToSplash: indexHtmlSource.includes(
				"background: var(--infinitecode-startup-background)",
			),
			usesTransparentSplash: indexHtmlSource.includes("background: transparent"),
		}).toEqual({
			definesBackground: true,
			definesLightBackground: true,
			appliesToHtml: true,
			appliesToBody: true,
			appliesToSplash: true,
			usesTransparentSplash: false,
		})
	})

	test("keeps glass startup overlay background consistent with the content area", () => {
		expect({
			transparentSelector: indexCssSource.includes(
				':root.electron-transparent [data-slot="startup-overlay"]',
			),
			vibrancySelector: indexCssSource.includes(
				':root.electron-vibrancy [data-slot="startup-overlay"]',
			),
			usesGlassBody: indexCssSource.includes("var(--background) var(--glass-body)"),
		}).toEqual({
			transparentSelector: true,
			vibrancySelector: true,
			usesGlassBody: true,
		})
	})
})
