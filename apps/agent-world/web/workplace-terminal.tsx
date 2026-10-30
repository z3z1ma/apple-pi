import type { Ghostty, ITheme, Terminal } from "ghostty-web";
import wasmUrl from "ghostty-web/ghostty-vt.wasm?url";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TerminalEvent, TerminalSession } from "../src/terminal.js";
import { Icon } from "./workplace-icon.js";
import { usePaneResize } from "./workplace-resize.js";
import "./workplace-terminal.css";

type Exit = Extract<TerminalEvent, { type: "exit" }>;
interface SessionView {
	id: string;
	ordinal: number;
	root: string;
	phase: "starting" | "running" | "exited" | "failed";
	session?: TerminalSession;
	exit?: Exit;
	error?: string;
}
let engine: Promise<Ghostty> | undefined;
const terminalTheme = {
	background: "#1b1d21",
	foreground: "#e9e5ed",
	cursor: "#e9e5ed",
	red: "#ff7b72",
	green: "#7ee787",
	yellow: "#e3b341",
	blue: "#79c0ff",
	magenta: "#d2a8ff",
	cyan: "#76e3ea",
	white: "#e9e5ed",
	black: "#444c56",
} satisfies ITheme;

function TerminalView({
	id,
	root,
	visible,
	onStatus,
}: {
	id: string;
	root: string;
	visible: boolean;
	onStatus: (id: string, patch: Partial<SessionView>) => void;
}) {
	const host = useRef<HTMLDivElement>(null);
	const shown = useRef(visible);
	shown.current = visible;
	const layout = useRef<() => void>(() => {});
	useEffect(() => {
		const element = host.current!;
		const api = window.agentWorld.terminal;
		let disposed = false,
			started = false,
			connected = false;
		let exitResult: Exit | undefined;
		let terminal: Terminal | undefined;
		let cleanup = () => {};
		const failed = (error: unknown) => {
			if (!disposed && !exitResult)
				onStatus(id, {
					...(!started ? { phase: "failed" as const } : {}),
					error: error instanceof Error ? error.message : String(error),
				});
		};
		void import("ghostty-web")
			.then(async ({ Ghostty, Terminal, FitAddon }) => {
				engine ??= Ghostty.load(wasmUrl);
				const ghostty = await engine;
				if (disposed) return;
				const term = new Terminal({
					ghostty,
					fontSize: 13,
					fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
					theme: terminalTheme,
					cursorBlink: false,
				});
				terminal = term;
				const fit = new FitAddon();
				term.loadAddon(fit);
				term.open(element);
				const off = api.onEvent((event) => {
					if (event.id !== id || disposed) return;
					if (event.type === "data") {
						if (!exitResult) connected = true;
						term.write(event.data);
					} else {
						connected = false;
						exitResult = event;
						onStatus(id, { phase: "exited", exit: event, error: undefined });
					}
				});
				const input = term.onData((data) => {
					if (connected)
						void api
							.write({ id, data })
							.then((result) => {
								if (!result.ok) failed(result.reason);
							})
							.catch(failed);
				});
				const resize = term.onResize((size) => {
					if (connected && shown.current && size.cols > 0 && size.rows > 0)
						void api
							.resize({ id, ...size })
							.then((result) => {
								if (!result.ok) failed(result.reason);
							})
							.catch(failed);
				});
				const fitVisible = () => {
					const bounds = element.getBoundingClientRect();
					if (!shown.current || bounds.width <= 0 || bounds.height <= 0) return;
					const size = fit.proposeDimensions();
					if (!size || size.cols <= 0 || size.rows <= 0) return;
					fit.fit();
					if (started) return;
					started = true;
					void api
						.create({ id, cwd: root, cols: term.cols, rows: term.rows })
						.then((result) => {
							if (disposed) {
								void api.close({ id });
								return;
							}
							if (!result.ok) {
								onStatus(id, { phase: "failed", error: result.reason });
								return;
							}
							connected = !exitResult;
							onStatus(id, { session: result.session, phase: exitResult ? "exited" : "running", exit: exitResult });
							if (shown.current) {
								fit.fit();
								term.focus();
							}
						})
						.catch(failed);
				};
				layout.current = () => {
					fitVisible();
					if (shown.current) term.focus();
				};
				const observer = new ResizeObserver(fitVisible);
				observer.observe(element);
				cleanup = () => {
					observer.disconnect();
					off();
					input.dispose();
					resize.dispose();
				};
				fitVisible();
			})
			.catch(failed);
		return () => {
			disposed = true;
			layout.current = () => {};
			cleanup();
			terminal?.dispose();
			if (started) void api.close({ id }).catch(console.error);
		};
	}, [id, root, onStatus]);
	useEffect(() => {
		if (visible) layout.current();
	}, [visible]);
	return (
		<div ref={host} className="wp-terminal-host" style={{ background: terminalTheme.background }} hidden={!visible} />
	);
}

export function WorkplaceTerminal({
	root,
	active,
	onLiveCountChange,
}: {
	root: string;
	active: boolean;
	onLiveCountChange?: (count: number) => void;
}) {
	const [open, setOpen] = useState(false);
	const height = usePaneResize({
		label: "Terminal height",
		variable: "--wp-terminal-height",
		axis: "y",
		direction: -1,
		min: 96,
		max: (): number => {
			const body = height.pane.current;
			const dock = body?.parentElement;
			const editor = dock?.parentElement;
			const chrome = (dock?.offsetHeight ?? 0) - (body?.offsetHeight ?? 0);
			const tabs = editor?.querySelector(".wp-code-tabs")?.getBoundingClientRect().height ?? 0;
			return (editor?.clientHeight ?? 0) - chrome - tabs - 160;
		},
		enabled: open,
	});
	const [sessions, setSessions] = useState<SessionView[]>([]);
	const [selected, setSelected] = useState<string>();
	const ordinal = useRef(0);
	const update = useCallback(
		(id: string, patch: Partial<SessionView>) =>
			setSessions((current) => current.map((session) => (session.id === id ? { ...session, ...patch } : session))),
		[],
	);
	const live = sessions.filter((session) => session.phase === "starting" || session.phase === "running").length;
	useEffect(() => {
		onLiveCountChange?.(live);
	}, [live, onLiveCountChange]);
	useEffect(
		() => () => {
			onLiveCountChange?.(0);
		},
		[onLiveCountChange],
	);
	const current = sessions.find((session) => session.id === selected);
	const add = () => {
		const id = crypto.randomUUID();
		setSessions((list) => [...list, { id, ordinal: ++ordinal.current, root, phase: "starting" }]);
		setSelected(id);
		setOpen(true);
	};
	const close = async (session: SessionView) => {
		const result = await window.agentWorld.terminal.close({ id: session.id });
		if (!result.ok) {
			update(session.id, { error: result.reason });
			return;
		}
		setSessions((list) => list.filter((item) => item.id !== session.id));
		if (selected === session.id) setSelected(sessions.find((item) => item.id !== session.id)?.id);
	};
	return (
		<section style={height.style} className={`wp-terminal${open ? " is-open" : ""}`} aria-label="Integrated terminal">
			{height.separator}
			<header>
				<button
					type="button"
					className="wp-icon-button"
					aria-label={open ? "Hide terminal" : "Show terminal"}
					title={open ? "Hide terminal" : "Show terminal"}
					onClick={() => setOpen(!open)}
				>
					<Icon name="terminal" />
				</button>
				<span>Terminal</span>
				<div role="tablist" aria-label="Terminals">
					{sessions.map((session) => (
						<button
							key={session.id}
							type="button"
							role="tab"
							aria-selected={session.id === selected}
							aria-label={`Terminal ${session.ordinal}: ${session.session?.cwd ?? session.root}`}
							title={session.session?.cwd ?? session.root}
							onClick={() => {
								setSelected(session.id);
								setOpen(true);
							}}
						>
							{session.ordinal} · {(session.session?.cwd ?? session.root).split("/").filter(Boolean).at(-1) || "/"}
							{session.phase === "exited" ? " (exited)" : ""}
						</button>
					))}
				</div>
				<button
					type="button"
					className="wp-icon-button"
					aria-label="New terminal"
					title={root ? `New terminal in ${root}` : "Choose a repository first"}
					disabled={!root}
					onClick={add}
				>
					<Icon name="plus" />
				</button>
				{current && (
					<button
						type="button"
						className="wp-icon-button"
						aria-label={`Close terminal ${current.ordinal}`}
						title="Close terminal and end its shell"
						onClick={() => void close(current).catch((error) => update(current.id, { error: String(error) }))}
					>
						<Icon name="trash" />
					</button>
				)}
			</header>
			<div ref={height.ref} className="wp-terminal-body" hidden={!open}>
				{!sessions.length && <p>Open a terminal in the selected repository. Hiding this panel keeps shells running.</p>}
				{sessions.map((session) => (
					<TerminalView
						key={session.id}
						id={session.id}
						root={session.root}
						visible={active && open && selected === session.id}
						onStatus={update}
					/>
				))}
				{current && (
					<div className="wp-terminal-status" role="status">
						{current.error ??
							(current.phase === "exited"
								? `Exited with code ${current.exit?.exitCode}${current.exit?.signal ? ` (signal ${current.exit.signal})` : ""}`
								: current.phase === "starting"
									? "Starting terminal..."
									: current.session?.cwd)}
					</div>
				)}
			</div>
		</section>
	);
}
