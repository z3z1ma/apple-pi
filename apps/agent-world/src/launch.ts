// Starts Agent World from a Pi session: installs Electron under Pi's agent directory on first use (it is not a
// dependency of apple-pi), then runs the built app detached, so it outlives the session that opened it.
import { spawn } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentDir } from "../../../components/session-state/src/paths.js";

export const ELECTRON_VERSION = "44.9.0";

const MAIN = fileURLToPath(new URL("../dist/electron/main.js", import.meta.url));
const STEP_TIMEOUT_MS = 10 * 60_000;
/** How long a started app is watched for an early exit before it counts as open. */
const START_WATCH_MS = 2000;
const OUTPUT_KEPT = 4000;

/** One directory per Electron version, so a new pin installs beside the old one instead of over it. */
export function electronDir(): string {
	return join(agentDir(), "agent-world", `electron-${ELECTRON_VERSION}`);
}

/** The Electron binary, once installed and downloaded. */
export function installedElectron(dir = electronDir()): string | undefined {
	const pathFile = join(dir, "node_modules", "electron", "path.txt");
	if (!existsSync(pathFile)) return undefined;
	const binary = join(dir, "node_modules", "electron", "dist", readFileSync(pathFile, "utf8").trim());
	return existsSync(binary) ? binary : undefined;
}

/** A step of the first-run install, as the status line shows it. */
export type InstallStep =
	| { stage: "installing" }
	| { stage: "downloading"; percent: number | null }
	| { stage: "unpacking" };

/** Why an install failed, in words for the operator; `network` when a connection could not be made. */
export class InstallError extends Error {
	readonly network: boolean;
	readonly output: string;
	constructor(reason: string, output: string, network: boolean) {
		super(reason);
		this.network = network;
		this.output = output;
	}
}

const NETWORK = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|fetch failed|network/i;

/** The line of a tool's output that best says what went wrong. */
function detailOf(output: string): string {
	const lines = output
		.split("\n")
		.map((line) => line.replace(/^npm (error|ERR!)\s*/, "").trim())
		.filter((line) => line && !/^(at |A complete log|Log files|[{}]|code [A-Z]+$|errno|syscall)/.test(line));
	const detail = lines.find((line) => NETWORK.test(line)) ?? lines.find((line) => /error/i.test(line)) ?? lines.at(-1);
	return !detail ? "" : detail.length > 200 ? `${detail.slice(0, 199)}...` : detail;
}

type Step = "npm" | "download" | "unpack";

/** Turn a failed step's output into an `InstallError` that says why. */
function failure(step: Step, output: string, spawnError?: NodeJS.ErrnoException): InstallError {
	if (spawnError?.code === "ENOENT" && step === "npm")
		return new InstallError("npm was not found on your PATH (Agent World installs Electron with npm)", output, false);
	if (spawnError) return new InstallError(spawnError.message, output, false);
	const detail = detailOf(output);
	if (NETWORK.test(output)) {
		const where = step === "npm" ? "the npm registry" : "GitHub, where Electron is downloaded from";
		return new InstallError(`no network connection: could not reach ${where} (${detail})`, output, true);
	}
	if (/^timed out$/m.test(output)) return new InstallError(`the ${step} step took over ten minutes`, output, true);
	const what = step === "npm" ? "npm install failed" : step === "download" ? "the download failed" : "unpacking failed";
	return new InstallError(detail ? `${what}: ${detail}` : what, output, false);
}

/** Run one step, passing each stdout line to `onLine`; rejects with an `InstallError` when it fails. */
function runStep(
	step: Step,
	command: string,
	args: string[],
	cwd: string,
	onLine: (line: string) => void = () => {},
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let output = "";
		let pending = "";
		const keep = (text: string) => {
			output = (output + text).slice(-OUTPUT_KEPT);
		};
		child.stdout.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			keep(text);
			pending += text;
			for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n")) {
				onLine(pending.slice(0, end));
				pending = pending.slice(end + 1);
			}
		});
		child.stderr.on("data", (chunk: Buffer) => keep(chunk.toString()));
		const timer = setTimeout(() => {
			keep("\ntimed out\n");
			child.kill("SIGKILL");
		}, STEP_TIMEOUT_MS);
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(failure(step, output, error));
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) resolve();
			else reject(failure(step, output));
		});
	});
}

// Downloads Electron's zip into its cache with `@electron/get`, as the package's install.js does, but printing
// progress (install.js draws a progress bar only on a terminal). install.js then finds the zip cached and unpacks it.
const DOWNLOAD = `
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const [dir, version] = process.argv.slice(1);
const electron = join(dir, "node_modules", "electron");
const require = createRequire(join(electron, "package.json"));
const { downloadArtifact } = await import(pathToFileURL(require.resolve("@electron/get")).href);
let last = -1;
await downloadArtifact({
	version,
	artifactName: "electron",
	platform: process.platform,
	arch: process.arch,
	checksums: JSON.parse(readFileSync(join(electron, "checksums.json"), "utf8")),
	downloadOptions: {
		quiet: true,
		getProgressCallback({ percent }) {
			const now = Math.floor(percent * 100);
			if (now !== last) console.log("progress " + (last = now));
		},
	},
});
`;

const pidAlive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
};

/** Remove the staging directories of installs whose process died midway. */
function removeStaleStaging(dir: string) {
	const parent = dirname(dir);
	const prefix = `${basename(dir)}.installing-`;
	for (const entry of readdirSync(parent)) {
		if (!entry.startsWith(prefix)) continue;
		const pid = Number.parseInt(entry.slice(prefix.length), 10);
		if (!Number.isFinite(pid) || !pidAlive(pid)) rmSync(join(parent, entry), { recursive: true, force: true });
	}
}

/**
 * Install Electron with npm, then download its binary with progress and unpack it with the package's own installer,
 * run explicitly (npm may skip install scripts). Everything happens in a staging directory beside `dir` that is
 * renamed into place only once it holds the binary, so a failed or interrupted install never leaves a half-installed
 * `dir` behind, and the next `/world` simply starts again.
 */
export async function installElectron(
	dir = electronDir(),
	onStep: (step: InstallStep) => void = () => {},
): Promise<string> {
	const ready = installedElectron(dir);
	if (ready) return ready;
	mkdirSync(dirname(dir), { recursive: true });
	removeStaleStaging(dir);
	const staging = `${dir}.installing-${process.pid}-${Date.now()}`;
	try {
		mkdirSync(staging);
		writeFileSync(join(staging, "package.json"), '{ "private": true }\n');
		onStep({ stage: "installing" });
		await runStep(
			"npm",
			"npm",
			["install", "--prefix", staging, "--ignore-scripts", "--no-audit", "--no-fund", `electron@${ELECTRON_VERSION}`],
			staging,
		);
		onStep({ stage: "downloading", percent: null });
		await runStep(
			"download",
			process.execPath,
			["--input-type=module", "-e", DOWNLOAD, staging, ELECTRON_VERSION],
			staging,
			(line) => {
				const match = /^progress (\d+)$/.exec(line.trim());
				if (match) onStep({ stage: "downloading", percent: Number(match[1]) });
			},
		);
		onStep({ stage: "unpacking" });
		await runStep("unpack", process.execPath, [join(staging, "node_modules", "electron", "install.js")], staging);
		if (!installedElectron(staging))
			throw new InstallError("Electron's installer finished but left no Electron binary", "", false);
		// Another session may have finished the same install first; then keep its copy. A directory without a binary
		// (left by an earlier version of this code that stopped midway) is replaced.
		if (!installedElectron(dir)) {
			rmSync(dir, { recursive: true, force: true });
			renameSync(staging, dir);
		}
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
	const binary = installedElectron(dir);
	if (!binary) throw new InstallError(`Electron ${ELECTRON_VERSION} did not install into ${dir}`, "", false);
	return binary;
}

export type StartResult = { ok: true } | { ok: false; reason: string };

/** The app's stderr from its latest start, kept to say why a start failed. */
export function startLog(): string {
	return join(agentDir(), "agent-world", "electron.log");
}

/**
 * Start the app detached. A second start hands over to the running one, which focuses its window, and quits.
 * Resolves once the app has run for `watchMs`, or with the reason when it quits at once with an error.
 */
export function startAgentWorld(electron: string, watchMs = START_WATCH_MS): Promise<StartResult> {
	const env = { ...process.env };
	delete env.ELECTRON_RUN_AS_NODE;
	const log = startLog();
	mkdirSync(dirname(log), { recursive: true });
	const fd = openSync(log, "w");
	return new Promise((resolve) => {
		let timer: NodeJS.Timeout | undefined;
		const settle = (result: StartResult) => {
			if (!timer) return;
			clearTimeout(timer);
			timer = undefined;
			resolve(result);
		};
		timer = setTimeout(() => settle({ ok: true }), watchMs);
		try {
			const child = spawn(electron, [MAIN], { detached: true, stdio: ["ignore", "ignore", fd], env });
			child.on("error", (error) => settle({ ok: false, reason: error.message }));
			child.on("exit", (code, signal) => {
				if (code === 0) return settle({ ok: true });
				const tail = readFileSync(log, "utf8").trim().split("\n").slice(-3).join(" ").slice(0, 300);
				settle({ ok: false, reason: `it quit at start (${signal ?? `exit ${code}`})${tail ? `: ${tail}` : ""}` });
			});
			child.unref();
		} catch (error) {
			settle({ ok: false, reason: (error as Error).message });
		} finally {
			closeSync(fd);
		}
	});
}
