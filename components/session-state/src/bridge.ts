import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { statePaths } from "./paths.js";
import { type BridgeMessage, HEARTBEAT_MS, type Hello, type RunState } from "./protocol.js";

const RUNTIME_MAIN = fileURLToPath(new URL("./runtime-main.ts", import.meta.url));
const REGISTER = new URL("./register.mjs", import.meta.url).href;
const RETRY_MS = 250;

/**
 * Start a runtime detached from this session; it keeps running after the session ends. Its output goes to
 * the runtime log, and a failed start is reported through `warn` (exit 0 only means another runtime runs).
 */
function spawnRuntime(warn: (message: string) => void): void {
	const paths = statePaths();
	let log: number;
	try {
		mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
		log = openSync(paths.log, "a", 0o600);
	} catch (error) {
		warn(`Session state: cannot use ${paths.dir}: ${(error as Error).message}`);
		return;
	}
	const child = spawn(process.execPath, ["--import", REGISTER, RUNTIME_MAIN], {
		detached: true,
		stdio: ["ignore", log, log],
		env: process.env,
	});
	closeSync(log);
	child.on("error", (error) => warn(`Session state: cannot start the runtime: ${error.message}`));
	child.on("exit", (code) => {
		if (code) warn(`Session state: the runtime exited with code ${code}; see ${paths.log}`);
	});
	child.unref();
}

/**
 * One session's link to the runtime. It keeps the session's current state and sends it whole on every
 * (re)connect, so nothing depends on messages sent while the runtime was away.
 */
class StateLink {
	private socket?: Socket;
	private connected = false;
	private closed = false;
	private spawned = false;
	private heartbeat?: NodeJS.Timeout;
	private retry?: NodeJS.Timeout;
	private hello: Hello;
	private readonly warn: (message: string) => void;

	constructor(hello: Hello, warn: (message: string) => void) {
		this.hello = hello;
		this.warn = warn;
		this.connect();
	}

	run(run: RunState): void {
		if (this.hello.run === run) return;
		this.hello.run = run;
		this.send({ type: "run", run });
	}

	/**
	 * End the link. With a reason, the session ended and the runtime records it. Without one (a reload, or a new
	 * bridge instance taking over), the process lives on and the next bridge resumes the same incarnation.
	 */
	close(reason?: string): void {
		if (this.closed) return;
		if (reason) this.send({ type: "shutdown", reason });
		this.closed = true;
		clearInterval(this.heartbeat);
		clearTimeout(this.retry);
		this.socket?.end();
	}

	private connect(): void {
		if (this.closed) return;
		const socket = createConnection(statePaths().socket);
		this.socket = socket;
		socket.on("connect", () => {
			this.connected = true;
			this.send(this.hello);
			this.heartbeat = setInterval(() => this.send({ type: "heartbeat" }), HEARTBEAT_MS);
			this.heartbeat.unref();
		});
		socket.on("error", () => {});
		socket.on("close", () => {
			this.connected = false;
			clearInterval(this.heartbeat);
			if (this.closed) return;
			if (!this.spawned) {
				this.spawned = true;
				spawnRuntime(this.warn);
			}
			this.retry = setTimeout(() => this.connect(), RETRY_MS);
			this.retry.unref();
		});
		socket.unref();
	}

	private send(message: BridgeMessage): void {
		if (this.connected && this.socket) this.socket.write(`${JSON.stringify(message)}\n`);
	}
}

function helloFor(ctx: ExtensionContext): Hello {
	const sessions = ctx.sessionManager;
	return {
		type: "hello",
		session: {
			id: sessions.getSessionId(),
			kind: "root",
			file: sessions.getSessionFile(),
			cwd: ctx.cwd,
			name: sessions.getSessionName(),
		},
		process: { pid: process.pid, startedAt: Math.round(Date.now() - process.uptime() * 1000) },
		run: ctx.isIdle() ? "idle" : "thinking",
	};
}

export default function sessionStateBridge(pi: ExtensionAPI): void {
	if (process.env.PI_SESSION_STATE_DISABLED === "1") return;
	let link: StateLink | undefined;

	pi.on("session_start", (_event, ctx) => {
		link?.close();
		let warned = false;
		const warn = (message: string) => {
			if (warned) return;
			warned = true;
			if (ctx.hasUI) ctx.ui.notify(message, "warning");
			else process.stderr.write(`${message}\n`);
		};
		link = new StateLink(helloFor(ctx), warn);
	});
	pi.on("session_shutdown", (event) => {
		link?.close(event.reason === "reload" ? undefined : event.reason);
		link = undefined;
	});
	pi.on("agent_start", () => link?.run("thinking"));
	pi.on("message_start", (event) => {
		if (event.message.role === "assistant") link?.run("thinking");
	});
	pi.on("message_update", (event) => {
		const type = event.assistantMessageEvent?.type;
		if (type === "text_start" || type === "text_delta") link?.run("writing_reply");
	});
	pi.on("tool_execution_start", (event) => {
		if (!event.parentToolCallId) link?.run("running_tool");
	});
	pi.on("tool_execution_end", (event) => {
		if (!event.parentToolCallId) link?.run("thinking");
	});
	pi.on("session_before_compact", () => link?.run("compacting"));
	pi.on("session_compact", (_event, ctx) => link?.run(ctx.isIdle() ? "idle" : "thinking"));
	pi.on("session_compact_failed", (_event, ctx) => link?.run(ctx.isIdle() ? "idle" : "thinking"));
	pi.on("agent_settled", () => link?.run("idle"));
}
