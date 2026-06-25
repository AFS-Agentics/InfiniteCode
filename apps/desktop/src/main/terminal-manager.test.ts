import { describe, expect, test } from "bun:test";
import {
	DesktopTerminalManager,
	type TerminalCreateProcessOptions,
	type TerminalProcess,
} from "./terminal-manager";

class FakeTerminalProcess implements TerminalProcess {
	readonly writes: string[] = [];
	readonly resizes: { cols: number; rows: number }[] = [];
	readonly kills: string[] = [];
	private dataHandlers: ((data: string) => void)[] = [];
	private exitHandlers: ((event: {
		exitCode: number;
		signal?: number;
	}) => void)[] = [];

	write(data: string): void {
		this.writes.push(data);
	}

	resize(cols: number, rows: number): void {
		this.resizes.push({ cols, rows });
	}

	kill(signal?: string): void {
		this.kills.push(signal ?? "SIGTERM");
	}

	onData(callback: (data: string) => void): void {
		this.dataHandlers.push(callback);
	}

	onExit(
		callback: (event: { exitCode: number; signal?: number }) => void,
	): void {
		this.exitHandlers.push(callback);
	}

	emitData(data: string): void {
		for (const handler of this.dataHandlers) {
			handler(data);
		}
	}

	emitExit(event: { exitCode: number; signal?: number }): void {
		for (const handler of this.exitHandlers) {
			handler(event);
		}
	}
}

describe("DesktopTerminalManager", () => {
	test("creates a terminal session and forwards output to subscribers", async () => {
		const createOptions: TerminalCreateProcessOptions[] = [];
		const process = new FakeTerminalProcess();
		const received: { id: string; data: string }[] = [];
		const manager = new DesktopTerminalManager({
			createProcess: (options) => {
				createOptions.push(options);
				return process;
			},
			defaultCwd: "/Users/tester",
			env: {
				PATH: "/usr/bin",
				SHELL: "/bin/zsh",
				ZSH_TMUX_AUTOSTARTED: "true",
				ZSH_TMUX_AUTOSTART: "false",
			},
			platform: "darwin",
			idFactory: () => "terminal-1",
		});

		manager.onData((id, data) => received.push({ id, data }));
		const session = await manager.create({
			cwd: "/repo/devo",
			cols: 100,
			rows: 30,
		});

		expect(session).toEqual({
			id: "terminal-1",
			cwd: "/repo/devo",
			shell: "/bin/zsh",
			cols: 100,
			rows: 30,
		});
		expect(createOptions).toEqual([
			{
				shell: "/bin/zsh",
				args: ["-l"],
				cwd: "/repo/devo",
				env: {
					DISABLE_AUTO_UPDATE: "true",
					PATH: "/usr/bin",
					SHELL: "/bin/zsh",
					TERM: "xterm-256color",
					COLORTERM: "truecolor",
				},
				cols: 100,
				rows: 30,
			},
		]);

		process.emitData("hello\r\n");
		expect(received).toEqual([{ id: "terminal-1", data: "hello\r\n" }]);
	});

	test("writes, resizes, and removes sessions when they close", async () => {
		const process = new FakeTerminalProcess();
		const exited: { id: string; exitCode: number; signal?: number }[] = [];
		const manager = new DesktopTerminalManager({
			createProcess: () => process,
			defaultCwd: "/Users/tester",
			env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
			platform: "win32",
			idFactory: () => "terminal-2",
		});

		manager.onExit((id, event) => exited.push({ id, ...event }));
		await manager.create({ cols: 80, rows: 24 });
		manager.write("terminal-2", "pwd\r");
		manager.resize("terminal-2", 120, 40);

		expect(process.writes).toEqual(["pwd\r"]);
		expect(process.resizes).toEqual([{ cols: 120, rows: 40 }]);

		process.emitExit({ exitCode: 0 });
		expect(exited).toEqual([{ id: "terminal-2", exitCode: 0 }]);
		expect(manager.get("terminal-2")).toBeNull();
	});

	test("kills all live terminal processes during shutdown", async () => {
		const createdProcesses = [
			new FakeTerminalProcess(),
			new FakeTerminalProcess(),
		];
		const processQueue = [...createdProcesses];
		const manager = new DesktopTerminalManager({
			createProcess: () => {
				const process = processQueue.shift();
				if (!process) throw new Error("expected a queued terminal process");
				return process;
			},
			defaultCwd: "/Users/tester",
			env: {},
			platform: "linux",
			idFactory: (() => {
				let next = 0;
				return () => `terminal-${++next}`;
			})(),
		});

		await manager.create({});
		await manager.create({});
		manager.closeAll();

		expect(createdProcesses.map((process) => process.kills)).toEqual([
			["SIGTERM"],
			["SIGTERM"],
		]);
	});
});
