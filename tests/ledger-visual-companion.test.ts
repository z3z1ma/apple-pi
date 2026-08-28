import { type ChildProcessWithoutNullStreams, execFileSync, spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	linkSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const skillDir = resolve("skills/task-shaping");
const scripts = join(skillDir, "scripts");
const serverScript = join(scripts, "server.cjs");
const require = createRequire(import.meta.url);
const protocol = require(serverScript) as {
	computeAcceptKey(clientKey: string): string;
	encodeFrame(opcode: number, payload: Buffer): Buffer;
	decodeFrame(buffer: Buffer): { opcode: number; payload: Buffer; bytesConsumed: number } | null;
	browserLauncherForPlatform(
		url: string,
		options?: { platform?: NodeJS.Platform; osRelease?: string; env?: NodeJS.ProcessEnv },
	): { bin: string; args: string[] } | null;
	OPCODES: { TEXT: number; CLOSE: number; PING: number; PONG: number };
	MAX_FRAME_PAYLOAD_BYTES: number;
	MAX_EVENT_PAYLOAD_BYTES: number;
	MAX_EVENTS_FILE_BYTES: number;
	MAX_ACCEPTED_EVENTS: number;
	MAX_LOG_BYTES: number;
	MAX_WEBSOCKET_CLIENTS: number;
	WEBSOCKET_IDLE_TIMEOUT_MS: number;
};

interface StartedServer {
	port: number;
	url: string;
	session_dir: string;
	screen_dir: string;
	state_dir: string;
	idle_timeout_ms: number;
}

interface DirectServer {
	child: ChildProcessWithoutNullStreams;
	info: StartedServer;
	output(): string;
}

const runtimeDirs: string[] = [];
const tempDirs: string[] = [];
const childProcesses: ChildProcessWithoutNullStreams[] = [];

function run(script: string, args: string[], cwd?: string): string {
	return execFileSync("bash", [join(scripts, script), ...args], { cwd, encoding: "utf8" }).trim();
}

function allRelativeFiles(root: string, current = root): string[] {
	const paths: string[] = [];
	for (const entry of readdirSync(current, { withFileTypes: true })) {
		const path = join(current, entry.name);
		if (entry.isDirectory()) paths.push(...allRelativeFiles(root, path));
		else paths.push(path.slice(root.length + 1));
	}
	return paths;
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
	}
}

async function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs = 3000): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	await Promise.race([
		new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`process ${child.pid} did not exit within ${timeoutMs}ms`)), timeoutMs),
		),
	]);
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
	if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
	await waitForExit(child);
}

async function startDirectServer(root: string, overrides: NodeJS.ProcessEnv = {}): Promise<DirectServer> {
	const sessionDir = overrides.LEDGER_VISUAL_DIR ?? join(root, "session");
	const contentDir = overrides.LEDGER_VISUAL_CONTENT_DIR ?? join(sessionDir, "content");
	const stateDir = overrides.LEDGER_VISUAL_STATE_DIR ?? join(sessionDir, "state");
	mkdirSync(contentDir, { recursive: true });
	mkdirSync(stateDir, { recursive: true });
	const serverId = "direct-test-server-id-0000000000000001";
	let output = "";
	const child = spawn(process.execPath, [serverScript, `--ledger-visual-server-id=${serverId}`], {
		env: {
			...process.env,
			LEDGER_VISUAL_DIR: sessionDir,
			LEDGER_VISUAL_CONTENT_DIR: contentDir,
			LEDGER_VISUAL_STATE_DIR: stateDir,
			LEDGER_VISUAL_PORT_FILE: join(stateDir, "last-port"),
			LEDGER_VISUAL_TOKEN_FILE: join(stateDir, "token"),
			LEDGER_VISUAL_HOST: "127.0.0.1",
			LEDGER_VISUAL_URL_HOST: "127.0.0.1",
			...overrides,
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	childProcesses.push(child);

	return await new Promise<DirectServer>((resolveStart, rejectStart) => {
		const timeout = setTimeout(() => rejectStart(new Error(`server did not start:\n${output}`)), 5000);
		const inspect = (chunk: Buffer) => {
			output += chunk.toString();
			for (const line of output.split("\n")) {
				if (!line.includes('"type":"server-started"')) continue;
				clearTimeout(timeout);
				resolveStart({ child, info: JSON.parse(line) as StartedServer, output: () => output });
				return;
			}
		};
		child.stdout.on("data", inspect);
		child.stderr.on("data", inspect);
		child.once("exit", (code, signal) => {
			clearTimeout(timeout);
			rejectStart(new Error(`server exited before startup (${code ?? signal}):\n${output}`));
		});
	});
}

function sessionCookie(response: Response): string {
	const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
	if (!cookie) throw new Error("server did not set a session cookie");
	return cookie;
}

function maskedFrame(opcode: number, payload: Buffer): Buffer {
	const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
	if (payload.length >= 126) throw new Error("test helper only supports short frames");
	const data = Buffer.alloc(payload.length);
	for (let index = 0; index < payload.length; index++) data[index] = payload[index] ^ mask[index % 4];
	return Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | payload.length]), mask, data]);
}

async function openRawWebSocket(started: StartedServer): Promise<Socket> {
	const token = new URL(started.url).searchParams.get("key") ?? "";
	return await new Promise<Socket>((resolveSocket, rejectSocket) => {
		const socket = createConnection({ host: "127.0.0.1", port: started.port, allowHalfOpen: true });
		let response = "";
		const timeout = setTimeout(() => {
			socket.destroy();
			rejectSocket(new Error("raw WebSocket handshake timed out"));
		}, 1000);
		socket.on("error", rejectSocket);
		socket.on("data", (chunk) => {
			response += chunk.toString("latin1");
			if (!response.includes("\r\n\r\n")) return;
			clearTimeout(timeout);
			if (!response.includes("101 Switching Protocols")) {
				socket.destroy();
				rejectSocket(new Error(`raw WebSocket handshake failed: ${response}`));
				return;
			}
			resolveSocket(socket);
		});
		socket.on("connect", () => {
			socket.write(
				[
					`GET /?key=${token} HTTP/1.1`,
					`Host: 127.0.0.1:${started.port}`,
					"Upgrade: websocket",
					"Connection: Upgrade",
					"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
					"Sec-WebSocket-Version: 13",
					"",
					"",
				].join("\r\n"),
			);
		});
	});
}

async function rawWebSocketHandshake(
	started: StartedServer,
	options: { key?: string; origin?: string } = {},
): Promise<string> {
	const token = options.key ?? new URL(started.url).searchParams.get("key") ?? "";
	return await new Promise<string>((resolveHandshake, rejectHandshake) => {
		const socket = createConnection({ host: "127.0.0.1", port: started.port });
		let response = "";
		const finish = () => {
			socket.destroy();
			resolveHandshake(response);
		};
		socket.setTimeout(1000, finish);
		socket.on("error", rejectHandshake);
		socket.on("data", (chunk) => {
			response += chunk.toString("latin1");
			if (response.includes("\r\n\r\n")) finish();
		});
		socket.on("close", () => resolveHandshake(response));
		socket.on("connect", () => {
			const lines = [
				`GET /?key=${token} HTTP/1.1`,
				`Host: localhost:${started.port}`,
				"Upgrade: websocket",
				"Connection: Upgrade",
				"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
				"Sec-WebSocket-Version: 13",
			];
			if (options.origin) lines.push(`Origin: ${options.origin}`);
			socket.write(`${lines.join("\r\n")}\r\n\r\n`);
		});
	});
}

afterEach(async () => {
	for (const child of childProcesses.splice(0)) {
		try {
			await stopChild(child);
		} catch {}
	}
	for (const runtime of runtimeDirs.splice(0)) {
		if (existsSync(runtime)) {
			try {
				run("stop-server.sh", [runtime]);
			} catch {}
		}
	}
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Ledger visual companion", () => {
	it("keeps capability state ephemeral while serving task-owned visual evidence", async () => {
		const root = mkdtempSync(join(tmpdir(), "apple-pi-ledger-visual-test-"));
		tempDirs.push(root);
		const task = join(root, ".ledger", "202608210100-demo");
		mkdirSync(join(task, "evidence"), { recursive: true });
		writeFileSync(join(task, "task.md"), "Status: active\n\n# Demo\n");

		const started = JSON.parse(run("start-server.sh", ["--task-dir", task])) as StartedServer;
		const runtime = started.session_dir;
		runtimeDirs.push(runtime);

		expect(runtime).toBe(dirname(started.state_dir));
		expect(started.screen_dir).toContain(`${task}/evidence/.storage/visual-companion/`);
		expect(started.state_dir).toMatch(/^\/tmp\/ledger-visual-/);
		expect(allRelativeFiles(task)).not.toContain("evidence/.storage/visual-companion/.last-token");
		expect(allRelativeFiles(task)).not.toContain("evidence/.storage/visual-companion/server-info");
		expect(JSON.parse(run("stop-server.sh", ["--status", runtime]))).toEqual({ status: "running" });

		const forbidden = await fetch(`http://localhost:${started.port}/`);
		expect(forbidden.status).toBe(403);
		expect(forbidden.headers.get("referrer-policy")).toBe("no-referrer");

		const bootstrap = await fetch(started.url);
		expect(bootstrap.status).toBe(200);
		const cookie = sessionCookie(bootstrap);
		const capability = new URL(started.url).searchParams.get("key") ?? "";
		expect(await bootstrap.clone().text()).not.toContain(capability);

		writeFileSync(join(started.screen_dir, "layout option.html"), "<h2>Ledger layout choice</h2>\n");
		await waitFor(() => readFileSync(join(started.state_dir, "server.log"), "utf8").includes("screen-added"));
		const screen = await fetch(`http://localhost:${started.port}/`, { headers: { cookie } });
		const html = await screen.text();
		expect(screen.status).toBe(200);
		expect(html).toContain("Ledger layout choice");
		expect(html).toContain("apple-pi Ledger visual companion");

		const stopped = JSON.parse(run("stop-server.sh", [runtime])) as { status: string };
		runtimeDirs.pop();
		expect(stopped.status).toBe("stopped");
		expect(existsSync(runtime)).toBe(false);
		expect(readFileSync(join(started.screen_dir, "layout option.html"), "utf8")).toContain("Ledger layout choice");
	});

	it("serves only authenticated regular files inside the content directory", async () => {
		const root = mkdtempSync(join(tmpdir(), "apple-pi-ledger-visual-files-"));
		tempDirs.push(root);
		const direct = await startDirectServer(root);
		const { info } = direct;
		const bootstrap = await fetch(info.url);
		const cookie = sessionCookie(bootstrap);
		const outside = join(root, "outside.txt");
		writeFileSync(outside, "outside secret\n");
		writeFileSync(join(info.screen_dir, "inside.json"), '{"ok":true}\n');
		writeFileSync(join(info.screen_dir, ".hidden"), "hidden\n");
		symlinkSync(outside, join(info.screen_dir, "link.txt"));
		linkSync(outside, join(info.screen_dir, "hard.txt"));

		const inside = await fetch(`http://localhost:${info.port}/files/inside.json`, { headers: { cookie } });
		expect(inside.status).toBe(200);
		expect(inside.headers.get("content-type")).toBe("application/json");
		expect(await inside.text()).toContain('"ok":true');

		for (const target of [
			"/files/",
			"/files/.hidden",
			"/files/link.txt",
			"/files/hard.txt",
			"/files/../outside.txt",
			"/files/%2e%2e/outside.txt",
		]) {
			const response = await fetch(`http://localhost:${info.port}${target}`, { headers: { cookie } });
			expect(response.status, target).toBe(404);
		}
		expect(direct.child.exitCode).toBeNull();
	});

	it("authenticates WebSocket origin and records choice events", async () => {
		const root = mkdtempSync(join(tmpdir(), "apple-pi-ledger-visual-ws-"));
		tempDirs.push(root);
		const direct = await startDirectServer(root);
		const { info } = direct;
		const token = new URL(info.url).searchParams.get("key") ?? "";

		const accepted = await rawWebSocketHandshake(info, { origin: `http://localhost:${info.port}` });
		expect(accepted).toContain("101 Switching Protocols");
		expect(accepted).toContain(`Sec-WebSocket-Accept: ${protocol.computeAcceptKey("dGhlIHNhbXBsZSBub25jZQ==")}`);
		expect(await rawWebSocketHandshake(info, { origin: "http://evil.invalid" })).not.toContain(
			"101 Switching Protocols",
		);
		expect(await rawWebSocketHandshake(info, { key: `${token}wrong` })).not.toContain("101 Switching Protocols");

		const websocket = new WebSocket(`ws://localhost:${info.port}/?key=${token}`);
		await new Promise<void>((resolveOpen, rejectOpen) => {
			websocket.addEventListener("open", () => resolveOpen(), { once: true });
			websocket.addEventListener("error", () => rejectOpen(new Error("WebSocket failed to open")), {
				once: true,
			});
		});
		websocket.send(JSON.stringify({ type: "choice", choice: "layout-a" }));
		websocket.send(JSON.stringify({ type: "choice", value: "layout-b" }));
		const eventsFile = join(info.state_dir, "events");
		await waitFor(() => existsSync(eventsFile) && readFileSync(eventsFile, "utf8").split("\n").length >= 3);
		const initialEvents = readFileSync(eventsFile, "utf8");
		expect(initialEvents).toContain('"choice":"layout-a"');
		expect(initialEvents).toContain('"choice":"layout-b"');

		websocket.send(JSON.stringify({ type: "choice", choice: "x".repeat(protocol.MAX_EVENT_PAYLOAD_BYTES + 1) }));
		for (let index = 0; index < protocol.MAX_ACCEPTED_EVENTS + 5; index++) {
			websocket.send(JSON.stringify({ type: "choice", choice: `bounded-${index}` }));
		}
		await waitFor(() => direct.output().includes('"type":"event-limit-reached"'), 5000);
		const boundedEvents = readFileSync(eventsFile, "utf8");
		expect(Buffer.byteLength(boundedEvents)).toBeLessThanOrEqual(protocol.MAX_EVENTS_FILE_BYTES);
		expect(boundedEvents.trim().split("\n")).toHaveLength(protocol.MAX_ACCEPTED_EVENTS);
		expect(Buffer.byteLength(direct.output())).toBeLessThanOrEqual(protocol.MAX_LOG_BYTES + 1024);
		websocket.close();
	});

	it("limits concurrent WebSockets and reaps idle connections", async () => {
		const capRoot = mkdtempSync(join(tmpdir(), "apple-pi-ledger-visual-ws-cap-"));
		const idleRoot = mkdtempSync(join(tmpdir(), "apple-pi-ledger-visual-ws-idle-"));
		tempDirs.push(capRoot, idleRoot);
		const capped = await startDirectServer(capRoot);
		const token = new URL(capped.info.url).searchParams.get("key") ?? "";
		const clients = Array.from(
			{ length: protocol.MAX_WEBSOCKET_CLIENTS },
			() => new WebSocket(`ws://127.0.0.1:${capped.info.port}/?key=${token}`),
		);
		await Promise.all(
			clients.map(
				(client) =>
					new Promise<void>((resolveOpen, rejectOpen) => {
						client.addEventListener("open", () => resolveOpen(), { once: true });
						client.addEventListener("error", () => rejectOpen(new Error("capped client failed to open")), {
							once: true,
						});
					}),
			),
		);
		const excess = new WebSocket(`ws://127.0.0.1:${capped.info.port}/?key=${token}`);
		await new Promise<void>((resolveRejected, rejectRejected) => {
			excess.addEventListener("open", () => rejectRejected(new Error("excess WebSocket unexpectedly opened")), {
				once: true,
			});
			excess.addEventListener("error", () => resolveRejected(), { once: true });
			excess.addEventListener("close", () => resolveRejected(), { once: true });
		});
		for (const client of clients) client.close();

		const idle = await startDirectServer(idleRoot, { LEDGER_VISUAL_WS_IDLE_TIMEOUT_MS: "80" });
		const idleToken = new URL(idle.info.url).searchParams.get("key") ?? "";
		const idleClient = new WebSocket(`ws://127.0.0.1:${idle.info.port}/?key=${idleToken}`);
		await new Promise<void>((resolveOpen, rejectOpen) => {
			idleClient.addEventListener("open", () => resolveOpen(), { once: true });
			idleClient.addEventListener("error", () => rejectOpen(new Error("idle client failed to open")), {
				once: true,
			});
		});
		await new Promise<void>((resolveClose) =>
			idleClient.addEventListener("close", () => resolveClose(), { once: true }),
		);
	});

	it("keeps malformed half-open WebSockets inside the connection cap", async () => {
		const root = mkdtempSync(join(tmpdir(), "apple-pi-ledger-visual-ws-malformed-"));
		tempDirs.push(root);
		const direct = await startDirectServer(root);
		const peers = await Promise.all(
			Array.from({ length: protocol.MAX_WEBSOCKET_CLIENTS }, () => openRawWebSocket(direct.info)),
		);
		for (const peer of peers) peer.write(protocol.encodeFrame(protocol.OPCODES.TEXT, Buffer.from("unmasked")));
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
		const excess = await rawWebSocketHandshake(direct.info);
		expect(excess).not.toContain("101 Switching Protocols");
		for (const peer of peers) peer.destroy();
	});

	it("implements bounded masked WebSocket frame parsing", () => {
		const payload = Buffer.from("ping");
		const decoded = protocol.decodeFrame(maskedFrame(protocol.OPCODES.PING, payload));
		expect(decoded?.opcode).toBe(protocol.OPCODES.PING);
		expect(decoded?.payload.equals(payload)).toBe(true);
		expect(protocol.decodeFrame(maskedFrame(protocol.OPCODES.TEXT, payload).subarray(0, 3))).toBeNull();
		expect(() => protocol.decodeFrame(protocol.encodeFrame(protocol.OPCODES.TEXT, payload))).toThrow(
			"Client frames must be masked",
		);
		const fragmented = maskedFrame(protocol.OPCODES.TEXT, payload);
		fragmented[0] &= 0x7f;
		expect(() => protocol.decodeFrame(fragmented)).toThrow("Fragmented WebSocket messages are not supported");
		expect(() => protocol.decodeFrame(maskedFrame(protocol.OPCODES.CLOSE, Buffer.from([0])))).toThrow(
			"close frame payload must be empty or include a status code",
		);
		const oversizedControl = Buffer.alloc(4);
		oversizedControl[0] = 0x80 | protocol.OPCODES.PING;
		oversizedControl[1] = 0x80 | 126;
		oversizedControl.writeUInt16BE(126, 2);
		expect(() => protocol.decodeFrame(oversizedControl)).toThrow("control frame payload exceeds 125 bytes");
		const oversized = Buffer.alloc(10);
		oversized[0] = 0x81;
		oversized[1] = 0xff;
		oversized.writeBigUInt64BE(BigInt(protocol.MAX_FRAME_PAYLOAD_BYTES + 1), 2);
		expect(() => protocol.decodeFrame(oversized)).toThrow("exceeds maximum");
	});

	it("selects platform browser launchers without invoking a shell", () => {
		const url = "http://localhost:5000/?key=abc;touch%20/tmp/nope";
		expect(protocol.browserLauncherForPlatform(url, { platform: "darwin", osRelease: "", env: {} })).toEqual({
			bin: "open",
			args: [url],
		});
		expect(protocol.browserLauncherForPlatform(url, { platform: "win32", osRelease: "", env: {} })).toEqual({
			bin: "rundll32.exe",
			args: ["url.dll,FileProtocolHandler", url],
		});
		expect(
			protocol.browserLauncherForPlatform(url, {
				platform: "linux",
				osRelease: "5.15.0-microsoft-standard-WSL2",
				env: {},
			}),
		).toEqual({ bin: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] });
		expect(
			protocol.browserLauncherForPlatform(url, {
				platform: "linux",
				osRelease: "generic",
				env: { DISPLAY: ":0" },
			}),
		).toEqual({ bin: "xdg-open", args: [url] });
		expect(protocol.browserLauncherForPlatform(url, { platform: "linux", osRelease: "generic", env: {} })).toBeNull();
	});

	it("removes ephemeral runtime after owner death, identity mismatch, and idle timeout", async () => {
		const ownerRoot = mkdtempSync("/tmp/ledger-visual-owner-");
		const mismatchRoot = mkdtempSync("/tmp/ledger-visual-owner-mismatch-");
		const idleRoot = mkdtempSync("/tmp/ledger-visual-idle-");
		tempDirs.push(ownerRoot, mismatchRoot, idleRoot);
		const owner = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		childProcesses.push(owner);
		if (!owner.pid) throw new Error("owner process did not start");
		const ownerIdentity = execFileSync("ps", ["-o", "lstart=", "-p", String(owner.pid)], {
			encoding: "utf8",
		}).trim();
		const owned = await startDirectServer(ownerRoot, {
			LEDGER_VISUAL_DIR: ownerRoot,
			LEDGER_VISUAL_OWNER_PID: String(owner.pid),
			LEDGER_VISUAL_OWNER_ID: ownerIdentity,
			LEDGER_VISUAL_LIFECYCLE_CHECK_MS: "20",
			LEDGER_VISUAL_IDLE_TIMEOUT_MS: "10000",
		});
		owner.kill("SIGTERM");
		await waitForExit(owner);
		await waitForExit(owned.child);
		expect(existsSync(ownerRoot)).toBe(false);

		const mismatched = await startDirectServer(mismatchRoot, {
			LEDGER_VISUAL_DIR: mismatchRoot,
			LEDGER_VISUAL_OWNER_PID: String(process.pid),
			LEDGER_VISUAL_OWNER_ID: "not-the-current-process-identity",
			LEDGER_VISUAL_LIFECYCLE_CHECK_MS: "20",
			LEDGER_VISUAL_IDLE_TIMEOUT_MS: "10000",
		});
		await waitForExit(mismatched.child);
		expect(existsSync(mismatchRoot)).toBe(false);

		const idle = await startDirectServer(idleRoot, {
			LEDGER_VISUAL_DIR: idleRoot,
			LEDGER_VISUAL_OWNER_PID: "",
			LEDGER_VISUAL_LIFECYCLE_CHECK_MS: "20",
			LEDGER_VISUAL_IDLE_TIMEOUT_MS: "80",
		});
		await waitForExit(idle.child);
		expect(existsSync(idleRoot)).toBe(false);
	});

	it("refuses stale PID metadata without signaling an unrelated process", () => {
		const root = mkdtempSync("/tmp/ledger-visual-stale-");
		tempDirs.push(root);
		const state = join(root, "state");
		mkdirSync(state, { recursive: true });
		writeFileSync(join(state, "server.pid"), `${process.pid}\n`);
		writeFileSync(join(state, "server-instance-id"), `${"f".repeat(32)}\n`);
		const status = spawnSync("bash", [join(scripts, "stop-server.sh"), "--status", root], { encoding: "utf8" });
		expect(status.status).toBe(1);
		expect(status.stdout).toContain('"status": "stale"');
		const stopped = JSON.parse(run("stop-server.sh", [root])) as { status: string };
		expect(stopped.status).toBe("stale_pid");
		expect(process.kill(process.pid, 0)).toBe(true);
		expect(existsSync(root)).toBe(false);
	});

	it("fails closed before touching an escaped runtime path", () => {
		const prefix = mkdtempSync("/tmp/ledger-visual-escape-");
		const victim = mkdtempSync("/tmp/apple-pi-ledger-visual-victim-");
		tempDirs.push(prefix, victim);
		const state = join(victim, "state");
		mkdirSync(state);
		writeFileSync(join(victim, "keep.txt"), "keep\n");
		writeFileSync(join(state, "server-info"), "pair\n");
		symlinkSync(join(victim, "keep.txt"), join(state, "server-stopped"));
		const escaped = `${prefix}/../${basename(victim)}`;
		const stopped = spawnSync("bash", [join(scripts, "stop-server.sh"), escaped], { encoding: "utf8" });
		expect(stopped.status).toBe(1);
		expect(stopped.stdout).toContain("session_dir must be an existing direct");
		expect(readFileSync(join(victim, "keep.txt"), "utf8")).toBe("keep\n");
		expect(readFileSync(join(state, "server-info"), "utf8")).toBe("pair\n");
	});

	it("rejects plaintext non-loopback bind and display hosts", () => {
		const bind = spawnSync("bash", [join(scripts, "start-server.sh"), "--host", "0.0.0.0"], {
			encoding: "utf8",
		});
		expect(bind.status).toBe(1);
		expect(bind.stdout).toContain("--host must be loopback");
		for (const host of ["localhost", "example.com"]) {
			const display = spawnSync("bash", [join(scripts, "start-server.sh"), "--url-host", host], {
				encoding: "utf8",
			});
			expect(display.status, host).toBe(1);
			expect(display.stdout).toContain("--url-host must be a loopback endpoint");
		}
		const hostnameBind = spawnSync("bash", [join(scripts, "start-server.sh"), "--host", "localhost"], {
			encoding: "utf8",
		});
		expect(hostnameBind.status).toBe(1);
	});

	it("normalizes bracketed IPv6 loopback for binding and URL output", () => {
		const started = JSON.parse(run("start-server.sh", ["--host", "[::1]", "--url-host", "[::1]"])) as StartedServer;
		runtimeDirs.push(started.session_dir);
		expect(started.url).toMatch(/^http:\/\/\[::1\]:\d+\/\?key=/);
		expect(JSON.parse(run("stop-server.sh", ["--status", started.session_dir]))).toEqual({ status: "running" });
	});

	it("reuses the authenticated URL when a server restarts from the same state", async () => {
		const root = mkdtempSync(join(tmpdir(), "apple-pi-ledger-visual-restart-"));
		tempDirs.push(root);
		const first = await startDirectServer(root);
		await stopChild(first.child);
		const second = await startDirectServer(root);
		expect(second.info.port).toBe(first.info.port);
		expect(second.info.url).toBe(first.info.url);
		const response = await fetch(second.info.url);
		expect(response.status).toBe(200);
	});

	it("resolves helper commands from the loaded skill location and arbitrary cwd", () => {
		const guide = readFileSync(join(skillDir, "visual-companion.md"), "utf8");
		expect(guide).toContain('SKILL_DIR="$(cd "$(dirname "$SKILL_MD")" && pwd -P)"');
		expect(guide).toContain('"$SKILL_DIR/scripts/start-server.sh"');
		expect(guide).toContain('"$SKILL_DIR/scripts/stop-server.sh" "$session_dir"');
		expect(guide).toContain('"$SKILL_DIR/scripts/stop-server.sh" --status "$session_dir"');
		expect(guide).toContain("Never bind the companion to `0.0.0.0`");
		const root = mkdtempSync(join(tmpdir(), "apple-pi-ledger-visual-cwd-"));
		tempDirs.push(root);
		const task = join(root, ".ledger", "202608210200-cwd");
		const cwd = join(root, "unrelated", "working", "directory");
		mkdirSync(task, { recursive: true });
		mkdirSync(cwd, { recursive: true });
		writeFileSync(join(task, "task.md"), "Status: active\n\n# Cwd\n");
		const started = JSON.parse(run("start-server.sh", ["--task-dir", task], cwd)) as StartedServer;
		runtimeDirs.push(started.session_dir);
		expect(started.screen_dir).toContain(task);
	});
});
