// The start-up check (`npm run check:world-start`): starts the built app with the installed Electron, or the one
// named by AGENT_WORLD_ELECTRON, waits for the world to draw, captures the window through AGENT_WORLD_CAPTURE, and
// fails unless the capture shows a rendered world: not blank, not one colour, not mostly the window's background.
//
// It runs everything in a scratch agent directory with its own session-state runtime and one stand-in coordinator
// session, so it never touches the operator's runtime, sessions, or a running Agent World. Electron's window shows
// on screen for a few seconds. Not part of `npm test`: it needs Electron installed and a display.
//
//   node --import ./components/session-state/src/register.mjs apps/agent-world/scripts/startup-check.ts [out.png]
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const repo = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const appDir = join(repo, "apps", "agent-world");
const START_TIMEOUT_MS = 60_000;
/** The window's background colour (`backgroundColor` in src/electron/main.ts), which an empty window shows. */
const BACKGROUND = [0x14, 0x0e, 0x18];

function fail(message: string): never {
	throw new Error(message);
}

/** The byte a PNG filter predicts from the bytes left (a), above (b), and above-left (c). */
function predicted(filter: number, a: number, b: number, c: number): number {
	if (filter === 1) return a;
	if (filter === 2) return b;
	if (filter === 3) return (a + b) >> 1;
	if (filter !== 4) return 0;
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Undo the per-line filters of a PNG's inflated image data. */
function unfilter(raw: Buffer, width: number, height: number, channels: number): Buffer {
	const stride = width * channels;
	const pixels = Buffer.alloc(height * stride);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const line = y * (stride + 1) + 1;
		const out = y * stride;
		for (let x = 0; x < stride; x++) {
			const a = x >= channels ? pixels[out + x - channels] : 0;
			const b = y > 0 ? pixels[out - stride + x] : 0;
			const c = x >= channels && y > 0 ? pixels[out - stride + x - channels] : 0;
			pixels[out + x] = (raw[line + x] + predicted(filter, a, b, c)) & 0xff;
		}
	}
	return pixels;
}

/** Decode an 8-bit RGBA or RGB, non-interlaced PNG (what Electron's `toPNG` writes) into its pixels. */
export function decodePng(png: Buffer): { width: number; height: number; channels: number; pixels: Buffer } {
	if (png.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
	let offset = 8;
	let width = 0;
	let height = 0;
	let channels = 0;
	const data: Buffer[] = [];
	while (offset < png.length) {
		const length = png.readUInt32BE(offset);
		const type = png.toString("ascii", offset + 4, offset + 8);
		const body = png.subarray(offset + 8, offset + 8 + length);
		if (type === "IHDR") {
			width = body.readUInt32BE(0);
			height = body.readUInt32BE(4);
			const [depth, colour, , , interlace] = body.subarray(8, 13);
			channels = colour === 6 ? 4 : colour === 2 ? 3 : 0;
			if (depth !== 8 || !channels || interlace) throw new Error(`unsupported PNG (depth ${depth}, colour ${colour})`);
		} else if (type === "IDAT") data.push(body);
		else if (type === "IEND") break;
		offset += 12 + length;
	}
	const pixels = unfilter(inflateSync(Buffer.concat(data)), width, height, channels);
	return { width, height, channels, pixels };
}

/** How varied a capture is: distinct colours (4 bits a channel), the commonest one's share, the background's share. */
export function colourStats(image: ReturnType<typeof decodePng>) {
	const counts = new Map<number, number>();
	let background = 0;
	const total = image.width * image.height;
	for (let i = 0; i < total; i++) {
		const at = i * image.channels;
		const [r, g, b] = [image.pixels[at], image.pixels[at + 1], image.pixels[at + 2]];
		const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
		counts.set(key, (counts.get(key) ?? 0) + 1);
		if (Math.abs(r - BACKGROUND[0]) + Math.abs(g - BACKGROUND[1]) + Math.abs(b - BACKGROUND[2]) <= 6) background++;
	}
	return { colours: counts.size, commonest: Math.max(...counts.values()) / total, background: background / total };
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function main() {
	const out = resolve(process.argv[2] ?? join(tmpdir(), `agent-world-start-${Date.now()}.png`));
	const main = join(appDir, "dist", "electron", "main.js");
	if (!existsSync(main)) fail(`${main} is missing; run npm run build:world first.`);

	const scratch = mkdtempSync(join(tmpdir(), "aw-start-"));
	const env: NodeJS.ProcessEnv = {
		...process.env,
		PI_CODING_AGENT_DIR: scratch,
		PI_SESSION_STATE_DISABLED: "",
		TMUX_TMPDIR: join(scratch, "tmux"),
		TMUX: "",
		TMUX_PANE: "",
	};
	// launch.ts reads the agent directory when called, so it finds Electron before the scratch directory is set.
	const { installedElectron } = await import("../src/launch.js");
	const electron = process.env.AGENT_WORLD_ELECTRON || installedElectron();
	if (!electron || !existsSync(electron))
		fail(`no Electron at ${electron ?? "the install /world makes"}; run /world once or set AGENT_WORLD_ELECTRON.`);
	process.env.PI_CODING_AGENT_DIR = scratch;
	const { statePaths } = await import("../../../components/session-state/src/paths.js");
	const state = statePaths();

	const children: ChildProcess[] = [];
	let beat: NodeJS.Timeout | undefined;
	let socket: Socket | undefined;
	const cleanUp = () => {
		clearInterval(beat);
		socket?.destroy();
		for (const child of children) child.kill();
		try {
			const pid = Number.parseInt(readFileSync(state.pid, "utf8"), 10);
			if (pid) process.kill(pid, "SIGTERM");
		} catch {}
		rmSync(scratch, { recursive: true, force: true });
	};
	try {
		// A runtime of its own, started as a bridge starts one, and a stand-in coordinator so the world has a hall.
		const runtime = join(repo, "components", "session-state", "src", "runtime-main.ts");
		const register = join(repo, "components", "session-state", "src", "register.mjs");
		spawn(process.execPath, ["--import", register, runtime], { detached: true, stdio: "ignore", env }).unref();
		for (const until = Date.now() + 10_000; !existsSync(state.socket); await sleep(100))
			if (Date.now() > until) fail("the session-state runtime did not start.");
		const stand = spawn("sleep", ["300"], { stdio: "ignore" });
		children.push(stand);
		const startedAt = Date.parse(
			execFileSync("ps", ["-o", "lstart=", "-p", String(stand.pid)], { encoding: "utf8" }).trim(),
		);
		const link = createConnection(state.socket);
		socket = link;
		await new Promise((done) => link.once("connect", done));
		const hello = {
			type: "hello",
			session: { id: "startup-check-coordinator", kind: "root", cwd: scratch, name: "Start-up check" },
			process: { pid: stand.pid, startedAt },
			run: "idle",
			facts: {
				config: {
					name: "Start-up check",
					flags: ["coordinator"],
					activeTools: [],
					extensions: [],
					skills: [],
					mcpServers: [],
				},
			},
		};
		link.write(`${JSON.stringify(hello)}\n`);
		beat = setInterval(() => link.write(`${JSON.stringify({ type: "heartbeat" })}\n`), 1000);

		const appEnv: NodeJS.ProcessEnv = { ...env, AGENT_WORLD_CAPTURE: out };
		delete appEnv.ELECTRON_RUN_AS_NODE;
		const started = Date.now();
		const app = spawn(electron, [main], { env: appEnv, stdio: ["ignore", "pipe", "pipe"] });
		children.push(app);
		let log = "";
		app.stdout?.on("data", (chunk) => {
			log += chunk;
		});
		app.stderr?.on("data", (chunk) => {
			log += chunk;
		});
		const code = await new Promise<number | null>((done) => {
			const timer = setTimeout(() => {
				app.kill();
				done(null);
			}, START_TIMEOUT_MS);
			app.on("exit", (exit) => {
				clearTimeout(timer);
				done(exit);
			});
		});
		const seconds = ((Date.now() - started) / 1000).toFixed(1);
		const drew = /agent-world capture: (.*)/.exec(log)?.[1] ?? "no capture line";
		if (code === null) fail(`the app did not quit within ${START_TIMEOUT_MS / 1000} s.\n${log.slice(-2000)}`);
		if (!existsSync(out)) fail(`the app exited (${code}) without writing ${out}.\n${log.slice(-2000)}`);
		const image = decodePng(readFileSync(out));
		const stats = colourStats(image);
		const summary =
			`${image.width}x${image.height}, ${stats.colours} colours, commonest ${(stats.commonest * 100).toFixed(1)}%, ` +
			`background ${(stats.background * 100).toFixed(1)}%; ${drew}; ${seconds} s from start to capture`;
		if (!drew.startsWith("place ")) fail(`no place drew (${summary}). Capture: ${out}`);
		if (image.width < 400 || image.height < 300) fail(`the capture is too small (${summary}). Capture: ${out}`);
		if (stats.colours < 200 || stats.commonest > 0.5 || stats.background > 0.3)
			fail(`the capture does not look like a rendered world (${summary}). Capture: ${out}`);
		console.log(`start-up check passed: ${summary}.\nCapture: ${out}`);
	} finally {
		cleanUp();
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	await main().catch((error: Error) => {
		console.error(`start-up check failed: ${error.message}`);
		process.exitCode = 1;
	});
