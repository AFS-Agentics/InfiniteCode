import fs from "node:fs"
import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import type { Plugin } from "vite"
import { viteStaticCopy } from "vite-plugin-static-copy"
import { protocolTypesPlugin } from "./scripts/protocol-types"

const sdkClientAlias = path.resolve(__dirname, "packages/infinitecode-ai-sdk/src/v2/client.ts")

/**
 * Copies the drizzle migrations directory into the main process output.
 *
 * viteStaticCopy does not reliably fire during electron-vite's dev rebuilds,
 * so we use a plain Rollup writeBundle hook instead.
 */
function copyDrizzleMigrations(): Plugin {
	const src = path.resolve(__dirname, "drizzle")
	return {
		name: "copy-drizzle-migrations",
		writeBundle(options) {
			const dest = path.join(options.dir!, "drizzle")
			if (fs.existsSync(src)) {
				fs.cpSync(src, dest, { recursive: true })
			}
		},
	}
}

export default defineConfig({
	main: {
		plugins: [
			protocolTypesPlugin({ desktopDir: __dirname }),
			externalizeDepsPlugin({
				exclude: ["@infinitecode-ai/plugin", "@infinitecode-ai/sdk", "@infinitecode/configconv", "drizzle-orm"],
			}),
			copyDrizzleMigrations(),
		],
		resolve: {
			alias: {
				"@infinitecode-ai/sdk/v2/client": sdkClientAlias,
			},
		},
		build: {
			rollupOptions: {
				input: { index: path.resolve(__dirname, "src/main/index.ts") },
			},
		},
	},
	preload: {
		// No externalizeDepsPlugin — sandboxed preloads must bundle all deps.
		// Output CJS because Electron sandboxed preloads cannot use ESM.
		resolve: {
			alias: {
				"@infinitecode-ai/sdk/v2/client": sdkClientAlias,
			},
		},
		build: {
			rollupOptions: {
				input: { index: path.resolve(__dirname, "src/preload/index.ts") },
				output: {
					format: "cjs",
				},
			},
		},
	},
	renderer: {
		root: path.resolve(__dirname, "src/renderer"),
		plugins: [
			protocolTypesPlugin({ desktopDir: __dirname }),
			// Derive the renderer's /logo.png from the canonical brand lockup at
			// build time. public/logo.png is the dev canonical (kept in sync at
			// PR review); viteStaticCopy's writeBundle hook rewrites
			// out/renderer/logo.png from brand/lockup.png so the packaged asar
			// ships the canonical regardless of what public/ contains.
			viteStaticCopy({
				targets: [
					{
						src: path.resolve(__dirname, "resources/brand/lockup.png"),
						dest: "",
						rename: "logo.png",
					},
				],
			}),
			react(),
			tailwindcss(),
		],
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "src/renderer"),
				"@infinitecode/ui": path.resolve(__dirname, "packages/ui/src"),
				"@infinitecode-ai/sdk/v2/client": sdkClientAlias,
			},
		},
		worker: {
			format: "es",
		},
		server: {
			port: 1420,
			strictPort: true,
		},
		build: {
			rollupOptions: {
				input: { index: path.resolve(__dirname, "src/renderer/index.html") },
			},
		},
	},
})
