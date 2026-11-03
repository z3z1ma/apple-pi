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
import { hostPackageEnv } from "../../../components/session-state/src/client.js";
import { agentDir } from "../../../components/session-state/src/paths.js";

export const ELECTRON_VERSION = "44.9.0";

export function appDir(): string {
	const dir = join(agentDir(), "agent-workplace");
	const old = join(agentDir(), "agent-world");
	if (!existsSync(dir) && existsSync(old)) renameSync(old, dir);
	return dir;
}

const START = fileURLToPath(new URL("./electron/start.mjs", import.meta.url));
const LOADED = "agent-workplace: loaded";
const STEP_TIMEOUT_MS = 10 * 60_000;
const START_POLL_MS = 100;
const OUTPUT_KEPT = 4000;

export function electronDir(): string {
	return join(appDir(), `electron-${ELECTRON_VERSION}`);
}

export function installedElectron(dir = electronDir()): string | undefined {
	const pathFile = join(dir, "node_modules", "electron", "path.txt");
	if (!existsSync(pathFile)) return undefined;
	const binary = join(dir, "node_modules", "electron", "dist", readFileSync(pathFile, "utf8").trim());
	return existsSync(binary) ? binary : undefined;
}

export type InstallStep =
	| { stage: "installing" }
	| { stage: "downloading"; percent: number | null }
	| { stage: "unpacking" };

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

function detailOf(output: string): string {
	const lines = output
		.split("\n")
		.map((line) => line.replace(/^npm (error|ERR!)\s*/, "").trim())
		.filter((line) => line && !/^(at |A complete log|Log files|[{}]|code [A-Z]+$|errno|syscall)/.test(line));
	const detail = lines.find((line) => NETWORK.test(line)) ?? lines.find((line) => /error/i.test(line)) ?? lines.at(-1);
	return !detail ? "" : detail.length > 200 ? `${detail.slice(0, 199)}...` : detail;
}

type Step = "npm" | "download" | "unpack";

function failure(step: Step, output: string, spawnError?: NodeJS.ErrnoException): InstallError {
	if (spawnError?.code === "ENOENT" && step === "npm")
		return new InstallError(
			"npm was not found on your PATH (Agent Workplace installs Electron with npm)",
			output,
			false,
		);
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

function removeStaleStaging(dir: string) {
	const parent = dirname(dir);
	const prefix = `${basename(dir)}.installing-`;
	for (const entry of readdirSync(parent)) {
		if (!entry.startsWith(prefix)) continue;
		const pid = Number.parseInt(entry.slice(prefix.length), 10);
		if (!Number.isFinite(pid) || !pidAlive(pid)) rmSync(join(parent, entry), { recursive: true, force: true });
	}
}

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

export function startLog(): string {
	return join(appDir(), "electron.log");
}

export function startAgentWorkplace(electron: string): Promise<StartResult> {
	const env = hostPackageEnv();
	delete env.ELECTRON_RUN_AS_NODE;
	const log = startLog();
	mkdirSync(dirname(log), { recursive: true });
	const fd = openSync(log, "w");
	return new Promise((resolve) => {
		let timer: NodeJS.Timeout | undefined;
		const settle = (result: StartResult) => {
			if (!timer) return;
			clearInterval(timer);
			timer = undefined;
			resolve(result);
		};
		timer = setInterval(() => {
			if (readFileSync(log, "utf8").includes(LOADED)) settle({ ok: true });
		}, START_POLL_MS);
		try {
			const child = spawn(electron, [START], { detached: true, stdio: ["ignore", "ignore", fd], env });
			child.on("error", (error) => settle({ ok: false, reason: error.message }));
			child.on("exit", (code, signal) => {
				if (code === 0) return settle({ ok: true });
				const lines = readFileSync(log, "utf8").trim().split("\n");
				const failed = lines.find((line) => line.startsWith("agent-workplace: failed to load"));
				const tail = (failed ?? lines.slice(-3).join(" ")).slice(0, 300);
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
