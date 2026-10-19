// Starts Agent World from a Pi session: installs Electron under Pi's agent directory on first use (it is not a
// dependency of apple-pi), then runs the built app detached, so it outlives the session that opened it.
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { agentDir } from "../../../components/session-state/src/paths.js";

export const ELECTRON_VERSION = "44.9.0";

const MAIN = fileURLToPath(new URL("../dist/electron/main.js", import.meta.url));
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const run = promisify(execFile);

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

/**
 * Install Electron with npm, then download its binary with the package's own installer, run explicitly: npm may skip
 * install scripts.
 */
export async function installElectron(dir = electronDir()): Promise<string> {
	mkdirSync(dir, { recursive: true });
	if (!existsSync(join(dir, "package.json"))) writeFileSync(join(dir, "package.json"), '{ "private": true }\n');
	const options = { cwd: dir, timeout: INSTALL_TIMEOUT_MS };
	await run(
		"npm",
		["install", "--prefix", dir, "--ignore-scripts", "--no-audit", "--no-fund", `electron@${ELECTRON_VERSION}`],
		options,
	);
	await run(process.execPath, [join(dir, "node_modules", "electron", "install.js")], options);
	const binary = installedElectron(dir);
	if (!binary) throw new Error(`Electron ${ELECTRON_VERSION} did not install into ${dir}`);
	return binary;
}

/** Start the app detached. A second start hands over to the running one, which focuses its window. */
export function startAgentWorld(electron: string): void {
	const env = { ...process.env };
	delete env.ELECTRON_RUN_AS_NODE;
	spawn(electron, [MAIN], { detached: true, stdio: "ignore", env }).unref();
}
