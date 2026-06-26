import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cssPath = join(
	dirname(fileURLToPath(import.meta.url)),
	"desktop-chrome.css",
);

function normalizeSelector(selector: string): string {
	return selector.replace(/\s+/g, " ").trim();
}

function declarationsForSelector(
	css: string,
	selector: string,
): Record<string, string> {
	for (const match of css.matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
		const selectors = match[1].split(",").map(normalizeSelector);
		if (!selectors.includes(normalizeSelector(selector))) continue;

		return Object.fromEntries(
			match[2]
				.split(";")
				.map((value) => value.trim())
				.filter(Boolean)
				.map((declaration) => {
					const separatorIndex = declaration.indexOf(":");
					return [
						declaration.slice(0, separatorIndex).trim(),
						declaration.slice(separatorIndex + 1).replace(/\s+/g, " ").trim(),
					];
				}),
		);
	}

	return {};
}

describe("desktop chrome CSS", () => {
	test("Windows dark mode uses dark chrome background tokens", async () => {
		const css = await readFile(cssPath, "utf8");
		const lightDeclarations = declarationsForSelector(
			css,
			':root[data-platform="win32"]',
		);
		const darkDeclarations = declarationsForSelector(
			css,
			':root[data-platform="win32"].dark',
		);

		expect(lightDeclarations).toEqual({
			"--devo-titlebar-height": "40px",
			"--devo-windows-focus-chrome-bg": "#ecf5f9",
			"--devo-windows-unfocused-chrome-bg": "#f2f4f5",
		});
		expect(darkDeclarations).toEqual({
			"--devo-windows-focus-chrome-bg":
				"color-mix( in srgb, var(--background) 92%, var(--foreground) 8% )",
			"--devo-windows-unfocused-chrome-bg":
				"color-mix( in srgb, var(--background) 96%, var(--foreground) 4% )",
		});
	});

	test("macOS glass sidebar inset extends to the right and bottom window edges", async () => {
		const css = await readFile(cssPath, "utf8");
		const selectors = [
			':root[data-platform="darwin"].electron-transparent [data-slot="sidebar-inset"]',
			':root[data-platform="darwin"].electron-vibrancy [data-slot="sidebar-inset"]',
		];

		expect(
			selectors.map((selector) => declarationsForSelector(css, selector)),
		).toEqual([
			{
				"border-bottom-right-radius": "0",
				"border-top-right-radius": "0",
				"margin-bottom": "0",
				"margin-right": "0",
			},
			{
				"border-bottom-right-radius": "0",
				"border-top-right-radius": "0",
				"margin-bottom": "0",
				"margin-right": "0",
			},
		]);
	});

	test("macOS glass content area does not reveal rounded right-edge gaps", async () => {
		const css = await readFile(cssPath, "utf8");
		const selectors = [
			':root[data-platform="darwin"].electron-transparent [data-slot="content-area"]',
			':root[data-platform="darwin"].electron-vibrancy [data-slot="content-area"]',
		];

		expect(
			selectors.map((selector) => declarationsForSelector(css, selector)),
		).toEqual([
			{
				"border-bottom-right-radius": "0",
				"border-top-right-radius": "0",
			},
			{
				"border-bottom-right-radius": "0",
				"border-top-right-radius": "0",
			},
		]);
	});

	test("macOS transcript fill preserves the left corner rounding", async () => {
		const css = await readFile(cssPath, "utf8");
		const [sidebarInsetDeclarations, contentAreaDeclarations] = [
			':root[data-platform="darwin"] [data-slot="sidebar-inset"][data-transcript-titlebar-fill="true"]',
			':root[data-platform="darwin"] [data-slot="content-area"][data-transcript-titlebar-fill="true"]',
		].map((selector) => declarationsForSelector(css, selector));

		expect(sidebarInsetDeclarations["border-top-left-radius"]).toBeUndefined();
		expect(contentAreaDeclarations).toEqual({
			"border-top-right-radius": "0",
		});
	});

	test("macOS transcript header remains draggable while controls remain clickable", async () => {
		const css = await readFile(cssPath, "utf8");
		const selectors = [
			':root[data-platform="darwin"] [data-slot="content-area"][data-transcript-titlebar-fill="true"] [data-slot="session-panel-header"]',
			':root[data-platform="darwin"] [data-slot="content-area"][data-transcript-titlebar-fill="true"] [data-slot="session-panel-header"] button',
			':root[data-platform="darwin"] [data-slot="content-area"][data-transcript-titlebar-fill="true"] [data-slot="session-panel-header"] input',
		];

		expect(
			selectors.map((selector) => declarationsForSelector(css, selector)),
		).toEqual([
			{
				"-webkit-app-region": "drag",
			},
			{
				"-webkit-app-region": "no-drag",
			},
			{
				"-webkit-app-region": "no-drag",
			},
		]);
	});
});
