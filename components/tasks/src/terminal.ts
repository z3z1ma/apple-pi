import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { closeSync } from "node:fs";
import { createRequire } from "node:module";
import type { Readable, Writable } from "node:stream";
import tty from "node:tty";
import { fileURLToPath } from "node:url";

/** The part of a child process the shell tools use; a terminal-backed process provides the same. */
export interface ShellProcess {
	readonly pid?: number;
	readonly stdin: Writable | null;
	readonly stdout: Readable | null;
	readonly stderr: Readable | null;
	once(event: "error", listener: (error: Error) => void): this;
	once(event: "exit" | "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
	unref(): void;
}

export interface TerminalSize {
	cols: number;
	rows: number;
}

/** Columns the transcript indents command output by. */
const TRANSCRIPT_INDENT = 4;

/** Pi's terminal less the transcript indent, so command output fits where it is shown. */
export function terminalSize(): TerminalSize {
	const { columns, rows } = process.stdout;
	if (!process.stdout.isTTY || !columns || !rows) return { cols: 80, rows: 24 };
	return { cols: Math.max(1, columns - TRANSCRIPT_INDENT), rows };
}

interface PtyPair {
	master: number;
	slave: number;
}

interface NativePty {
	open(cols: number, rows: number): PtyPair;
}

let nativePty: NativePty | Error | undefined;

function loadNativePty(): NativePty {
	if (nativePty === undefined) {
		try {
			if (process.platform === "win32") throw new Error("pseudo-terminals for commands are not supported on Windows");
			// The package's own spawn gives the child a controlling terminal; opening pairs keeps Node's spawn.
			const loaded = createRequire(import.meta.url)("@lydell/node-pty/requireBinary.js").requireBinary("pty.node");
			if (typeof loaded?.open !== "function") throw new Error("@lydell/node-pty has no open()");
			nativePty = loaded as NativePty;
		} catch (error) {
			nativePty = error instanceof Error ? error : new Error(String(error));
		}
	}
	if (nativePty instanceof Error) throw nativePty;
	return nativePty;
}

export interface Terminal extends PtyPair {
	size: TerminalSize;
}

/**
 * Opens the pseudo-terminal a command writes stdout and stderr to, or throws when none can be opened.
 * One terminal for both keeps their order, as in the operator's terminal.
 */
export function openTerminal(): Terminal {
	const size = terminalSize();
	return { ...loadNativePty().open(size.cols, size.rows), size };
}

export function closeTerminal(terminal: Terminal): void {
	closeSync(terminal.master);
	closeSync(terminal.slave);
}

export function terminalEnvironment(env: NodeJS.ProcessEnv, size: TerminalSize): NodeJS.ProcessEnv {
	return {
		...env,
		TERM: "xterm-256color",
		COLUMNS: String(size.cols),
		LINES: String(size.rows),
		// A pager waits for keys that never come.
		PAGER: "cat",
		GIT_PAGER: "cat",
		BASH_ENV: COLOR_WRAPPERS,
		PI_TERMINAL_PREVIOUS_BASH_ENV: env.BASH_ENV ?? "",
	};
}

const COLOR_WRAPPERS = fileURLToPath(new URL("./terminal-bash-env.sh", import.meta.url));

/** Pi's own wait after a shell exits for output a lingering descendant still writes (`waitForChildProcess`). */
const EXIT_OUTPUT_GRACE_MS = 100;

/**
 * A child whose stdout and stderr share a pseudo-terminal, read as `stdout`. The parent's copy of the
 * terminal's child end is closed here; `close` fires once the child exited and the terminal reached
 * the end of its output, or fell quiet: a descendant left running in the background (`cmd &`) keeps
 * the terminal open and must not hold the command.
 */
export class TerminalProcess extends EventEmitter implements ShellProcess {
	readonly stdout: tty.ReadStream;
	readonly stderr = null;
	private outputOpen = true;
	private exit?: { code: number | null; signal: NodeJS.Signals | null };
	private exitGrace?: NodeJS.Timeout;

	constructor(
		private readonly child: ChildProcess,
		terminal: Terminal,
	) {
		super();
		closeSync(terminal.slave);
		this.stdout = new tty.ReadStream(terminal.master);
		// Linux reports the end of a pseudo-terminal's output as EIO once every writer has closed it.
		this.stdout.on("error", () => this.stdout.destroy());
		this.stdout.once("end", () => this.stdout.destroy());
		this.stdout.once("close", () => {
			this.outputOpen = false;
			clearTimeout(this.exitGrace);
			this.closeWhenDone();
		});
		child.once("error", (error) => this.emit("error", error));
		child.once("exit", (code, signal) => this.emit("exit", code, signal));
		child.once("close", (code, signal) => {
			this.exit = { code, signal };
			if (this.outputOpen) {
				this.stdout.on("data", () => this.endOutputWhenQuiet());
				this.endOutputWhenQuiet();
			}
			this.closeWhenDone();
		});
	}

	get pid(): number | undefined {
		return this.child.pid;
	}

	get stdin(): Writable | null {
		return this.child.stdin;
	}

	unref(): void {
		this.child.unref();
		this.stdout.unref();
	}

	private endOutputWhenQuiet(): void {
		clearTimeout(this.exitGrace);
		this.exitGrace = setTimeout(() => this.stdout.destroy(), EXIT_OUTPUT_GRACE_MS);
	}

	private closeWhenDone(): void {
		if (this.outputOpen || !this.exit) return;
		this.emit("close", this.exit.code, this.exit.signal);
	}
}
