import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, vi } from "vitest";
import { type Command, lineReader } from "../src/protocol.js";

/**
 * A temporary agent directory for one test file, with session state enabled and pointed at it. tmux is
 * isolated too: an empty socket directory and no inherited pane, so the runtime never reads the operator's
 * servers. A test that needs tmux starts scratch servers and points `TMUX_TMPDIR` at its own directory.
 */
export function tempStateDir() {
	const agentDir = mkdtempSync(join(tmpdir(), "aps-"));
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("PI_SESSION_STATE_DISABLED", "");
	vi.stubEnv("TMUX_TMPDIR", join(agentDir, "tmux"));
	vi.stubEnv("TMUX", "");
	vi.stubEnv("TMUX_PANE", "");
	const stateDir = join(agentDir, "state");
	return {
		agentDir,
		stateDir,
		dbPath: join(stateDir, "apple-pi.db"),
		socketPath: join(stateDir, "apple-pi.sock"),
		pidPath: join(stateDir, "apple-pi-runtime.pid"),
	};
}

/** Read the database the way a view does: a fresh read-only connection per query. */
export function query<T = Record<string, unknown>>(dbPath: string, sql: string, ...params: (string | number)[]): T[] {
	if (!existsSync(dbPath)) return [];
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		return db.prepare(sql).all(...params) as T[];
	} finally {
		db.close();
	}
}

/**
 * End a faux session the way Pi does. `dispose` alone emits no `session_shutdown`, so the bridge would stay
 * connected and start a new runtime once the test stops the old one.
 */
export async function close(run: {
	session: { extensionRunner: { emit(event: unknown): Promise<unknown> } };
	dispose(): void;
}) {
	await run.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
	run.dispose();
}

/** Start the runtime the way a bridge does, and wait until it accepts connections. */
export async function startRuntime(socketPath: string) {
	const main = new URL("../src/runtime-main.ts", import.meta.url).pathname;
	const register = new URL("../src/register.mjs", import.meta.url).href;
	spawn(process.execPath, ["--import", register, main], { detached: true, stdio: "ignore", env: process.env }).unref();
	await vi.waitFor(() => expect(existsSync(socketPath)).toBe(true), { timeout: 10000 });
}

/** A process to stand for a session's Pi process, with its start time as `ps` reports it. */
export function standInProcess(): { child: ChildProcess; pid: number; startedAt: number } {
	const child = spawn("sleep", ["600"], { stdio: "ignore" });
	const pid = child.pid!;
	const startedAt = Date.parse(execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).trim());
	return { child, pid, startedAt };
}

/** A bridge speaking the socket protocol directly, so a test can drop it or silence it at will. */
export async function fakeBridge(
	socketPath: string,
	sessionId: string,
	pid: number,
	startedAt: number,
	hello: { session?: Record<string, unknown>; facts?: Record<string, unknown>; run?: string } = {},
) {
	const socket: Socket = createConnection(socketPath);
	await new Promise((resolve) => socket.once("connect", resolve));
	const send = (message: unknown) => socket.write(`${JSON.stringify(message)}\n`);
	send({
		type: "hello",
		session: { id: sessionId, kind: "root", cwd: "/tmp", ...hello.session },
		process: { pid, startedAt },
		run: hello.run ?? "idle",
		facts: hello.facts ?? {},
	});
	return { socket, send };
}

/** Give a socket stand-in a scripted reply to correlated turns; lifecycle commands stay under the test's control. */
export function replyToTurns(link: Awaited<ReturnType<typeof fakeBridge>>, text: string): void {
	link.socket.on(
		"data",
		lineReader((line) => {
			const message = JSON.parse(line) as { type: string; commandId: string; command?: Command };
			if (message.type === "command" && message.command?.kind === "run_turn")
				link.send({
					type: "command_progress",
					commandId: message.commandId,
					stage: "applied",
					result: { status: "completed", text, operations: [], changes: [] },
				});
		}),
	);
}

export function runtimePid(pidPath: string): number | undefined {
	if (!existsSync(pidPath)) return undefined;
	const pid = Number.parseInt(readFileSync(pidPath, "utf8"), 10);
	return Number.isFinite(pid) ? pid : undefined;
}

/** Stop the runtime this test file started, by the pid it recorded, and remove the directory. */
export async function stopRuntime(state: { agentDir: string; pidPath: string }) {
	const pid = runtimePid(state.pidPath);
	if (pid) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {}
		await vi.waitFor(
			() => {
				try {
					process.kill(pid, 0);
				} catch {
					return;
				}
				throw new Error("runtime still running");
			},
			{ timeout: 5000 },
		);
	}
	rmSync(state.agentDir, { recursive: true, force: true });
}

type Receipt = { stage: string; reason?: string };
let commandCounter = 0;

/** Send one command as a client would, and collect its receipts until it is applied or failed. */
export async function sendCommand(
	socketPath: string,
	sessionId: string,
	command: Command,
	options: { commandId?: string; generation?: number } = {},
) {
	const commandId = options.commandId ?? `cmd-${++commandCounter}`;
	const socket = createConnection(socketPath);
	await new Promise((resolve) => socket.once("connect", resolve));
	const receipts: Receipt[] = [];
	const done = new Promise<void>((resolve) => {
		let buffer = "";
		socket.on("data", (chunk) => {
			buffer += chunk.toString();
			for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
				const receipt = JSON.parse(buffer.slice(0, end));
				buffer = buffer.slice(end + 1);
				receipts.push({ stage: receipt.stage, ...(receipt.reason ? { reason: receipt.reason } : {}) });
				if (receipt.stage === "applied" || receipt.stage === "failed" || receipt.reason) resolve();
			}
		});
	});
	socket.write(
		`${JSON.stringify({ type: "command", commandId, sessionId, command, ...(options.generation ? { generation: options.generation } : {}) })}\n`,
	);
	await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 5000))]);
	socket.destroy();
	return receipts;
}
