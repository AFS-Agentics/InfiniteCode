import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Button } from "@devo/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@devo/ui/components/tooltip";
import { MinusIcon, RotateCcwIcon, TerminalIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { isElectron } from "../services/backend";

interface DesktopTerminalPanelProps {
	open: boolean;
	directory: string | null | undefined;
	onOpenChange: (open: boolean) => void;
}

const DEFAULT_TERMINAL_HEIGHT = 280;
const MIN_TERMINAL_HEIGHT = 180;
const MAX_TERMINAL_HEIGHT = 520;

const DARK_TERMINAL_THEME = {
	background: "#050505",
	foreground: "#e5e7eb",
	cursor: "#f9fafb",
	selectionBackground: "#374151",
	black: "#111827",
	blue: "#60a5fa",
	brightBlue: "#93c5fd",
	brightGreen: "#86efac",
	brightRed: "#fca5a5",
	cyan: "#67e8f9",
	green: "#22c55e",
	red: "#ef4444",
	yellow: "#facc15",
};

const LIGHT_TERMINAL_THEME = {
	background: "#ffffff",
	foreground: "#111827",
	cursor: "#111827",
	selectionBackground: "#dbeafe",
	black: "#111827",
	blue: "#2563eb",
	brightBlue: "#3b82f6",
	brightGreen: "#16a34a",
	brightRed: "#ef4444",
	cyan: "#0891b2",
	green: "#16a34a",
	red: "#dc2626",
	yellow: "#ca8a04",
};

function shellName(shell: string | null): string {
	if (!shell) return "terminal";
	const normalized = shell.replaceAll("\\", "/");
	return normalized.slice(normalized.lastIndexOf("/") + 1) || "terminal";
}

function getTerminalTheme() {
	return document.documentElement.classList.contains("dark")
		? DARK_TERMINAL_THEME
		: LIGHT_TERMINAL_THEME;
}

function getTerminalBridge() {
	if (!isElectron || !("terminal" in window.devo)) return null;
	return window.devo.terminal;
}

export function DesktopTerminalPanel({
	open,
	directory,
	onOpenChange,
}: DesktopTerminalPanelProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const sessionIdRef = useRef<string | null>(null);
	const [sessionShell, setSessionShell] = useState<string | null>(null);
	const [height, setHeight] = useState(DEFAULT_TERMINAL_HEIGHT);
	const [status, setStatus] = useState<
		"idle" | "starting" | "running" | "exited" | "error"
	>("idle");

	const resizeTerminal = useCallback(() => {
		const terminalBridge = getTerminalBridge();
		const terminal = terminalRef.current;
		const fitAddon = fitAddonRef.current;
		const sessionId = sessionIdRef.current;
		if (!terminalBridge || !terminal || !fitAddon) return;

		fitAddon.fit();
		if (sessionId) {
			terminalBridge.resize(sessionId, terminal.cols, terminal.rows);
		}
	}, []);

	const closeSession = useCallback(() => {
		const terminalBridge = getTerminalBridge();
		if (!terminalBridge) return;
		const sessionId = sessionIdRef.current;
		if (sessionId) {
			terminalBridge.close(sessionId);
			sessionIdRef.current = null;
		}
		terminalRef.current?.clear();
		setSessionShell(null);
		setStatus("idle");
	}, []);

	const startSession = useCallback(async () => {
		const terminalBridge = getTerminalBridge();
		if (!terminalBridge || !terminalRef.current || sessionIdRef.current) return;
		setStatus("starting");
		try {
			const session = await terminalBridge.create({
				cwd: directory ?? undefined,
				cols: terminalRef.current.cols,
				rows: terminalRef.current.rows,
			});
			sessionIdRef.current = session.id;
			setSessionShell(session.shell);
			setStatus("running");
		} catch (error) {
			setStatus("error");
			terminalRef.current.write(
				`\r\nFailed to start terminal: ${String(error)}\r\n`,
			);
		}
	}, [directory]);

	useEffect(() => {
		const terminalBridge = getTerminalBridge();
		if (
			!open ||
			!terminalBridge ||
			terminalRef.current ||
			!containerRef.current
		)
			return;

		const terminal = new Terminal({
			cursorBlink: true,
			convertEol: true,
			fontFamily:
				'"IBM Plex Mono", "SFMono-Regular", Menlo, Monaco, Consolas, monospace',
			fontSize: 13,
			lineHeight: 1.35,
			scrollback: 5000,
			theme: getTerminalTheme(),
		});
		const fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.open(containerRef.current);
		terminalRef.current = terminal;
		fitAddonRef.current = fitAddon;
		const themeObserver = new MutationObserver(() => {
			terminal.options.theme = getTerminalTheme();
		});
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class"],
		});

		const dataDisposable = terminal.onData((data) => {
			const sessionId = sessionIdRef.current;
			if (sessionId) terminalBridge.write(sessionId, data);
		});
		const unsubscribeData = terminalBridge.onData(({ id, data }) => {
			if (id === sessionIdRef.current) terminal.write(data);
		});
		const unsubscribeExit = terminalBridge.onExit(({ id, exitCode }) => {
			if (id !== sessionIdRef.current) return;
			sessionIdRef.current = null;
			setStatus("exited");
			terminal.write(`\r\n[process exited with code ${exitCode}]\r\n`);
		});

		requestAnimationFrame(() => {
			terminal.options.theme = getTerminalTheme();
			resizeTerminal();
			void startSession();
			terminal.focus();
		});

		return () => {
			dataDisposable.dispose();
			unsubscribeData();
			unsubscribeExit();
			themeObserver.disconnect();
			const sessionId = sessionIdRef.current;
			if (sessionId) terminalBridge.close(sessionId);
			sessionIdRef.current = null;
			terminal.dispose();
			terminalRef.current = null;
			fitAddonRef.current = null;
		};
	}, [open, resizeTerminal, startSession]);

	useEffect(() => {
		if (!open || !terminalRef.current || height <= 0) return;
		requestAnimationFrame(() => {
			resizeTerminal();
			terminalRef.current?.focus();
		});
	}, [open, height, resizeTerminal]);

	useEffect(() => {
		if (!open) return;
		window.addEventListener("resize", resizeTerminal);
		return () => window.removeEventListener("resize", resizeTerminal);
	}, [open, resizeTerminal]);

	const handleResizePointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			event.preventDefault();
			const startY = event.clientY;
			const startHeight = height;
			const handlePointerMove = (moveEvent: PointerEvent) => {
				const nextHeight = Math.min(
					MAX_TERMINAL_HEIGHT,
					Math.max(
						MIN_TERMINAL_HEIGHT,
						startHeight + startY - moveEvent.clientY,
					),
				);
				setHeight(nextHeight);
			};
			const handlePointerUp = () => {
				window.removeEventListener("pointermove", handlePointerMove);
				window.removeEventListener("pointerup", handlePointerUp);
			};

			window.addEventListener("pointermove", handlePointerMove);
			window.addEventListener("pointerup", handlePointerUp);
		},
		[height],
	);

	if (!getTerminalBridge()) return null;

	return (
		<section
			data-slot="desktop-terminal-panel"
			data-state={open ? "open" : "closed"}
			className="shrink-0 overflow-hidden border-t border-border bg-background transition-[height] duration-150"
			style={{ height: open ? height : 0 }}
			aria-hidden={!open}
		>
			<div
				className="h-1 cursor-ns-resize bg-transparent hover:bg-primary/20"
				onPointerDown={handleResizePointerDown}
			/>
			<div className="flex h-10 items-center justify-between border-b border-border/70 px-3">
				<div className="flex min-w-0 items-center gap-2">
					<div className="flex h-7 min-w-0 items-center gap-2 rounded-md bg-muted px-2.5 text-sm">
						<TerminalIcon
							className="size-3.5 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
						<span className="truncate font-medium">
							{shellName(sessionShell)}
						</span>
					</div>
					{status !== "running" && (
						<span className="text-xs text-muted-foreground">
							{status === "starting"
								? "Starting..."
								: status === "error"
									? "Failed"
									: status === "exited"
										? "Exited"
										: ""}
						</span>
					)}
				</div>
				<div className="flex items-center gap-1">
					<Tooltip>
						<TooltipTrigger
							aria-label="Restart terminal"
							render={
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="size-7"
									onClick={() => {
										closeSession();
										void startSession();
									}}
								/>
							}
						>
							<RotateCcwIcon className="size-3.5" aria-hidden="true" />
						</TooltipTrigger>
						<TooltipContent>Restart terminal</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger
							aria-label="Hide terminal"
							render={
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="size-7"
									onClick={() => onOpenChange(false)}
								/>
							}
						>
							<MinusIcon className="size-3.5" aria-hidden="true" />
						</TooltipTrigger>
						<TooltipContent>Hide terminal (Cmd+J)</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger
							aria-label="Close terminal"
							render={
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="size-7"
									onClick={() => {
										closeSession();
										onOpenChange(false);
									}}
								/>
							}
						>
							<XIcon className="size-3.5" aria-hidden="true" />
						</TooltipTrigger>
						<TooltipContent>Close terminal</TooltipContent>
					</Tooltip>
				</div>
			</div>
			<div
				ref={containerRef}
				className="h-[calc(100%-44px)] overflow-hidden px-3 py-2 [&_.xterm]:h-full [&_.xterm-scrollable-element]:!bg-transparent [&_.xterm-viewport]:bg-background"
			/>
		</section>
	);
}
