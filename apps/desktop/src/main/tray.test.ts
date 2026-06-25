import path from "node:path"
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

const createdImagePaths: string[] = []
const resizedImages: Array<{ height: number; width: number }> = []
const templateImageFlags: boolean[] = []
const trayInstances: FakeElectronTray[] = []

class FakeNativeImage {
	constructor(readonly imagePath: string) {}

	isEmpty(): boolean {
		return false
	}

	resize(options: { height: number; width: number }): FakeNativeImage {
		resizedImages.push(options)
		return this
	}

	setTemplateImage(flag: boolean): void {
		templateImageFlags.push(flag)
	}
}

class FakeElectronTray {
	readonly icon: FakeNativeImage
	tooltip = ""
	title = ""
	contextMenu: unknown = null
	destroyed = false

	constructor(icon: FakeNativeImage) {
		this.icon = icon
		trayInstances.push(this)
	}

	setToolTip(tooltip: string): void {
		this.tooltip = tooltip
	}

	setContextMenu(contextMenu: unknown): void {
		this.contextMenu = contextMenu
	}

	setTitle(title: string): void {
		this.title = title
	}

	destroy(): void {
		this.destroyed = true
	}
}

mock.module("electron", () => ({
	app: { isPackaged: false },
	BrowserWindow: class {},
	Menu: { buildFromTemplate: (template: unknown) => template },
	Notification: class {},
	nativeImage: {
		createFromPath: (imagePath: string) => {
			createdImagePaths.push(imagePath)
			return new FakeNativeImage(imagePath)
		},
	},
	Tray: FakeElectronTray,
}))

mock.module("./devo-manager", () => ({
	getAcpTransport: () => undefined,
	getServerUrl: () => null,
}))

mock.module("./notification-watcher", () => ({
	getPendingCount: () => 0,
	getSessionStates: () => new Map(),
	onStateChanged: () => () => {},
}))

class FakeTray {
	readonly events: string[] = []

	on(event: string, _listener: () => void): this {
		this.events.push(event)
		return this
	}
}

beforeEach(() => {
	createdImagePaths.length = 0
	resizedImages.length = 0
	templateImageFlags.length = 0
	trayInstances.length = 0
})

afterEach(async () => {
	const { destroyTray } = await import("./tray")
	destroyTray()
})

describe("installTrayIconInteractions", () => {
	test("does not focus the desktop window when the tray icon itself is clicked", async () => {
		const { installTrayIconInteractions } = await import("./tray")
		const tray = new FakeTray()
		let showWindowCalls = 0

		installTrayIconInteractions(tray, {
			showWindow: () => {
				showWindowCalls += 1
			},
		})

		expect(tray.events).not.toContain("click")
		expect(showWindowCalls).toBe(0)
	})
})

describe("createTray", () => {
	const testOnMac = process.platform === "darwin" ? test : test.skip

	test("uses the desktop tray icon on Windows", async () => {
		const { createTrayIcon } = await import("./tray")

		createTrayIcon(path.join(process.cwd(), "resources"), "win32")

		expect(createdImagePaths.map((imagePath) => path.basename(imagePath))).toEqual(["iconTray.png"])
		expect(resizedImages).toEqual([{ height: 18, width: 18 }])
		expect(templateImageFlags).toEqual([])
	})

	testOnMac("uses the full-color tray icon on macOS", async () => {
		const { createTray } = await import("./tray")

		createTray(() => undefined)

		expect(createdImagePaths.map((imagePath) => path.basename(imagePath))).toEqual(["iconTray.png"])
		expect(resizedImages).toEqual([{ height: 18, width: 18 }])
		expect(templateImageFlags).toEqual([])
		expect(trayInstances).toHaveLength(1)
	})
})
