import { homedir } from "node:os";
import { waitForEnv } from "./shell-env";

export interface TerminalSessionInfo {
	id: string;
	cwd: string;
	shell: string;
	cols: number;
	rows: number;
}

export interface TerminalCreateOptions {
	cwd?: string;
	cols?: number;
	rows?: number;
}

export interface TerminalCreateProcessOptions {
	shell: string;
	args: string[];
	cwd: string;
	env: Record<string, string>;
	cols: number;
	rows: number;
}

export interface TerminalProcess {
	write(data: string): void;
	resize(cols: number, rows: number): void;
	kill(signal?: string): void;
	onData(callback: (data: string) => void): void;
	onExit(
		callback: (event: { exitCode: number; signal?: number }) => void,
	): void;
}

type TerminalProcessFactory = (
	options: TerminalCreateProcessOptions,
) => TerminalProcess | Promise<TerminalProcess>;

interface DesktopTerminalManagerOptions {
	createProcess?: TerminalProcessFactory;
	defaultCwd?: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	platform?: NodeJS.Platform;
	idFactory?: () => string;
}

interface TerminalSession {
	info: TerminalSessionInfo;
	process: TerminalProcess;
}

function createTerminalId(): string {
	return `terminal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeEnv(
	env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Record<string, string> {
	const normalized: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined) normalized[key] = value;
	}
	return normalized;
}

function resolveShell(
	platform: NodeJS.Platform,
	env: Record<string, string>,
): string {
	if (platform === "win32") {
		return env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
	}
	if (env.SHELL) return env.SHELL;
	if (platform === "darwin") return "/bin/zsh";
	return "/bin/bash";
}

function shellArgs(platform: NodeJS.Platform): string[] {
	return platform === "win32" ? [] : ["-l"];
}

async function createNodePtyProcess(
	options: TerminalCreateProcessOptions,
): Promise<TerminalProcess> {
	const pty = await import("node-pty");
	const process = pty.spawn(options.shell, options.args, {
		name: "xterm-256color",
		cols: options.cols,
		rows: options.rows,
		cwd: options.cwd,
		env: options.env,
	});

	return {
		write: (data) => process.write(data),
		resize: (cols, rows) => process.resize(cols, rows),
		kill: (signal) => process.kill(signal),
		onData: (callback) => {
			process.onData(callback);
		},
		onExit: (callback) => {
			process.onExit(callback);
		},
	};
}

export class DesktopTerminalManager {
	private readonly createProcess: TerminalProcessFactory;
	private readonly defaultCwd: string;
	private readonly env: NodeJS.ProcessEnv | Record<string, string | undefined>;
	private readonly platform: NodeJS.Platform;
	private readonly idFactory: () => string;
	private readonly sessions = new Map<string, TerminalSession>();
	private readonly dataListeners = new Set<
		(id: string, data: string) => void
	>();
	private readonly exitListeners = new Set<
		(id: string, event: { exitCode: number; signal?: number }) => void
	>();

	constructor(options: DesktopTerminalManagerOptions = {}) {
		this.createProcess = options.createProcess ?? createNodePtyProcess;
		this.defaultCwd = options.defaultCwd ?? homedir();
		this.env = options.env ?? process.env;
		this.platform = options.platform ?? process.platform;
		this.idFactory = options.idFactory ?? createTerminalId;
	}

	onData(listener: (id: string, data: string) => void): () => void {
		this.dataListeners.add(listener);
		return () => this.dataListeners.delete(listener);
	}

	onExit(
		listener: (
			id: string,
			event: { exitCode: number; signal?: number },
		) => void,
	): () => void {
		this.exitListeners.add(listener);
		return () => this.exitListeners.delete(listener);
	}

	async create(options: TerminalCreateOptions): Promise<TerminalSessionInfo> {
		await waitForEnv();
		const env: Record<string, string> = {
			...normalizeEnv(this.env),
			DISABLE_AUTO_UPDATE: "true",
			TERM: "xterm-256color",
			COLORTERM: "truecolor",
		};
		delete env.ZSH_TMUX_AUTOSTARTED;
		delete env.ZSH_TMUX_AUTOSTART;
		const cols = options.cols ?? 80;
		const rows = options.rows ?? 24;
		const cwd = options.cwd || this.defaultCwd;
		const shell = resolveShell(this.platform, env);
		const id = this.idFactory();
		const terminalProcess = await this.createProcess({
			shell,
			args: shellArgs(this.platform),
			cwd,
			env,
			cols,
			rows,
		});
		const info = { id, cwd, shell, cols, rows };

		terminalProcess.onData((data) => {
			for (const listener of this.dataListeners) {
				listener(id, data);
			}
		});
		terminalProcess.onExit((event) => {
			this.sessions.delete(id);
			for (const listener of this.exitListeners) {
				listener(id, event);
			}
		});

		this.sessions.set(id, { info, process: terminalProcess });
		return info;
	}

	get(id: string): TerminalSessionInfo | null {
		return this.sessions.get(id)?.info ?? null;
	}

	write(id: string, data: string): void {
		this.sessions.get(id)?.process.write(data);
	}

	resize(id: string, cols: number, rows: number): void {
		const session = this.sessions.get(id);
		if (!session) return;
		session.info = { ...session.info, cols, rows };
		session.process.resize(cols, rows);
	}

	close(id: string): void {
		const session = this.sessions.get(id);
		if (!session) return;
		this.sessions.delete(id);
		session.process.kill();
	}

	closeAll(): void {
		for (const id of [...this.sessions.keys()]) {
			this.close(id);
		}
	}
}

export const desktopTerminalManager = new DesktopTerminalManager();
