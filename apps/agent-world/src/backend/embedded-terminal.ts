import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { type IPty, spawn } from "@lydell/node-pty";
import {
	isTerminalClose,
	isTerminalCreate,
	isTerminalResize,
	isTerminalWrite,
	type TerminalApi,
	type TerminalEvent,
} from "../terminal.js";

export function openEmbeddedTerminals(): TerminalApi & { closeAll(): void; dispose(): void } {
	const sessions = new Map<string, { pty: IPty; exited: boolean; unsubscribe(): void }>();
	const listeners = new Set<(event: TerminalEvent) => void>();
	const emit = (event: TerminalEvent) => {
		for (const listener of listeners) listener(event);
	};
	const failure = (error: unknown): { ok: false; reason: string } => ({
		ok: false,
		reason: error instanceof Error ? error.message : String(error),
	});
	const close = (id: string) => {
		const session = sessions.get(id);
		if (!session) return;
		if (!session.exited) session.pty.kill();
		session.unsubscribe();
		sessions.delete(id);
	};
	const closeAll = () => {
		for (const id of sessions.keys()) close(id);
	};
	return {
		async create(request) {
			if (!isTerminalCreate(request))
				return { ok: false, reason: "A terminal identity, directory and positive terminal dimensions are required." };
			if (sessions.has(request.id)) return { ok: false, reason: "That terminal already exists." };
			try {
				if (!isAbsolute(request.cwd)) throw new Error("Choose an absolute directory for the terminal.");
				const cwd = realpathSync(request.cwd);
				if (!statSync(cwd).isDirectory()) throw new Error("The terminal directory is not a directory.");
				const shell = process.env.SHELL || "/bin/sh";
				const env: NodeJS.ProcessEnv = {
					...process.env,
					TERM: "xterm-256color",
					COLORTERM: "truecolor",
					TERM_PROGRAM: "apple-pi",
				};
				for (const key of ["TMUX", "TMUX_PANE", "TERM_SESSION_ID", "TERM_PROGRAM_VERSION"]) delete env[key];
				const pty = spawn(shell, ["-l", "-i"], {
					cwd,
					cols: request.cols,
					rows: request.rows,
					name: "xterm-256color",
					env,
				});
				const session = {
					pty,
					exited: false,
					unsubscribe: () => {
						data.dispose();
						exit.dispose();
					},
				};
				const data = pty.onData((text) => emit({ type: "data", id: request.id, data: text }));
				const exit = pty.onExit((result) => {
					session.exited = true;
					emit({ type: "exit", id: request.id, ...result });
				});
				sessions.set(request.id, session);
				return { ok: true, session: { id: request.id, cwd, shell } };
			} catch (error) {
				return failure(error);
			}
		},
		async write(request) {
			if (!isTerminalWrite(request)) return { ok: false, reason: "A terminal identity and text input are required." };
			const session = sessions.get(request.id);
			if (!session || session.exited) return { ok: false, reason: "That terminal is no longer running." };
			try {
				session.pty.write(request.data);
				return { ok: true };
			} catch (error) {
				return failure(error);
			}
		},
		async resize(request) {
			if (!isTerminalResize(request)) return { ok: false, reason: "Positive terminal dimensions are required." };
			const session = sessions.get(request.id);
			if (!session || session.exited) return { ok: false, reason: "That terminal is no longer running." };
			try {
				session.pty.resize(request.cols, request.rows);
				return { ok: true };
			} catch (error) {
				return failure(error);
			}
		},
		async close(request) {
			if (!isTerminalClose(request)) return { ok: false, reason: "A terminal identity is required." };
			close(request.id);
			return { ok: true };
		},
		onEvent(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		closeAll,
		dispose() {
			closeAll();
			listeners.clear();
		},
	};
}
