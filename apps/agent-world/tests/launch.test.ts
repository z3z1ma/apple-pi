import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import agentWorld from "../../../extensions/agent-world.js";
import { ELECTRON_VERSION } from "../src/launch.js";

// Seam 3: the `/world` command with a fake `npm` on PATH. The fake installs a stand-in Electron package whose
// `@electron/get` reports progress (or fails as if offline) and whose install.js writes a stand-in Electron binary;
// nothing is downloaded.
const root = mkdtempSync(join(tmpdir(), "aw-launch-"));
const bin = join(root, "bin");
const fixture = join(root, "fixture");
const agent = join(root, "agent");
const electronLog = join(root, "electron-args.txt");
const worldDir = join(agent, "agent-world");

const FAKE_NPM_OK = `#!/bin/sh
while [ $# -gt 0 ]; do [ "$1" = "--prefix" ] && prefix="$2"; shift; done
/bin/cp -R "${fixture}/node_modules" "$prefix/"
`;
// As npm 11 reports a registry it cannot resolve; it has already begun writing node_modules.
const FAKE_NPM_OFFLINE = `#!/bin/sh
while [ $# -gt 0 ]; do [ "$1" = "--prefix" ] && prefix="$2"; shift; done
/bin/mkdir -p "$prefix/node_modules/.staging"
echo "npm error code ENOTFOUND" >&2
echo "npm error syscall getaddrinfo" >&2
echo "npm error errno ENOTFOUND" >&2
echo "npm error network request to https://registry.npmjs.org/electron failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org" >&2
echo "npm error network This is a problem related to network connectivity." >&2
exit 1
`;

function writeFixture() {
	const electron = join(fixture, "node_modules", "electron");
	const get = join(fixture, "node_modules", "@electron", "get");
	mkdirSync(electron, { recursive: true });
	mkdirSync(get, { recursive: true });
	writeFileSync(join(electron, "package.json"), JSON.stringify({ name: "electron", version: ELECTRON_VERSION }));
	writeFileSync(join(electron, "checksums.json"), "{}");
	writeFileSync(
		join(electron, "install.js"),
		`const fs = require("fs"), path = require("path");
const dist = path.join(__dirname, "dist");
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, "fake-electron"), process.env.FAKE_ELECTRON_SCRIPT);
fs.chmodSync(path.join(dist, "fake-electron"), 0o755);
fs.writeFileSync(path.join(__dirname, "path.txt"), "fake-electron");
`,
	);
	writeFileSync(
		join(get, "package.json"),
		JSON.stringify({ name: "@electron/get", type: "module", exports: "./index.js" }),
	);
	writeFileSync(
		join(get, "index.js"),
		`export async function downloadArtifact({ downloadOptions }) {
	if (process.env.FAKE_DOWNLOAD === "offline") throw new TypeError("fetch failed: getaddrinfo ENOTFOUND github.com");
	for (const percent of [0, 0.25, 0.5, 1]) downloadOptions.getProgressCallback({ percent });
	return "/cache/electron.zip";
}
`,
	);
}

const ELECTRON_OK = `#!/bin/sh\necho "$@" > "${electronLog}"\n`;
const ELECTRON_CRASH = `#!/bin/sh\necho "dyld: Library not loaded: @rpath/Electron Framework" >&2\nexit 1\n`;

function fakeNpm(script: string) {
	writeFileSync(join(bin, "npm"), script);
	chmodSync(join(bin, "npm"), 0o755);
}

type Handler = (args: string, ctx: unknown) => Promise<void>;
let world: Handler;
const notices: { message: string; level: string }[] = [];
const statuses: (string | undefined)[] = [];
const ctx = {
	ui: {
		notify: (message: string, level = "info") => notices.push({ message, level }),
		setStatus: (key: string, text: string | undefined) => {
			expect(key).toBe("agent-world");
			statuses.push(text);
		},
	},
};

beforeAll(() => {
	mkdirSync(bin, { recursive: true });
	writeFixture();
	const commands = new Map<string, { handler: Handler }>();
	agentWorld({
		registerCommand: (name: string, spec: { handler: Handler }) => commands.set(name, spec),
	} as unknown as ExtensionAPI);
	world = commands.get("world")!.handler;
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
	vi.stubEnv("PI_CODING_AGENT_DIR", agent);
	vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
	vi.stubEnv("FAKE_ELECTRON_SCRIPT", ELECTRON_OK);
	vi.stubEnv("FAKE_DOWNLOAD", "");
	notices.length = 0;
	statuses.length = 0;
	rmSync(electronLog, { force: true });
});

const leftovers = () =>
	existsSync(worldDir) ? readdirSync(worldDir).filter((name) => name.startsWith("electron-")) : [];

test("with the network off, /world says why the install failed and how to retry, and leaves nothing half-installed", async () => {
	fakeNpm(FAKE_NPM_OFFLINE);
	await world("", ctx);
	expect(notices.map((n) => n.message)[0]).toMatch(/^Installing Electron 44\.9\.0 for Agent World \(first use only/);
	const error = notices.find((n) => n.level === "error")?.message;
	expect(error).toMatch(/could not install Electron: no network connection: could not reach the npm registry/);
	expect(error).toMatch(/ENOTFOUND registry\.npmjs\.org/);
	expect(error).toMatch(/check your connection, then run \/world again to retry\.$/);
	expect(statuses).toEqual([`Agent World: installing Electron ${ELECTRON_VERSION} with npm...`, undefined]);
	expect(leftovers()).toEqual([]);
	expect(existsSync(electronLog)).toBe(false);
}, 20000);

test("a download that cannot reach GitHub fails the same way", async () => {
	fakeNpm(FAKE_NPM_OK);
	vi.stubEnv("FAKE_DOWNLOAD", "offline");
	await world("", ctx);
	const error = notices.find((n) => n.level === "error")?.message;
	expect(error).toMatch(/no network connection: could not reach GitHub, where Electron is downloaded from/);
	expect(error).toMatch(/run \/world again to retry\.$/);
	expect(statuses.at(-1)).toBeUndefined();
	expect(leftovers()).toEqual([]);
}, 20000);

test("the retry shows each install step in the status line, then opens the world", async () => {
	fakeNpm(FAKE_NPM_OK);
	await world("", ctx);
	expect(notices.filter((n) => n.level === "error")).toEqual([]);
	expect(statuses).toEqual([
		`Agent World: installing Electron ${ELECTRON_VERSION} with npm...`,
		`Agent World: downloading Electron ${ELECTRON_VERSION}...`,
		`Agent World: downloading Electron ${ELECTRON_VERSION}... 0%`,
		`Agent World: downloading Electron ${ELECTRON_VERSION}... 25%`,
		`Agent World: downloading Electron ${ELECTRON_VERSION}... 50%`,
		`Agent World: downloading Electron ${ELECTRON_VERSION}... 100%`,
		"Agent World: unpacking Electron...",
		"Agent World: opening...",
		undefined,
	]);
	expect(notices.map((n) => n.message).slice(-2)).toEqual(["Electron is installed.", "Opening Agent World."]);
	expect(readFileSync(electronLog, "utf8").trim()).toMatch(/apps\/agent-world\/dist\/electron\/main\.js$/);
	expect(leftovers()).toEqual([`electron-${ELECTRON_VERSION}`]);
}, 20000);

test("once installed, /world opens at once; an app that quits at start says why", async () => {
	fakeNpm("#!/bin/sh\nexit 3\n"); // never called
	await world("", ctx);
	expect(notices.map((n) => n.message)).toEqual(["Opening Agent World."]);
	expect(statuses).toEqual(["Agent World: opening...", undefined]);

	notices.length = 0;
	const binary = join(worldDir, `electron-${ELECTRON_VERSION}`, "node_modules", "electron", "dist", "fake-electron");
	writeFileSync(binary, ELECTRON_CRASH);
	await world("", ctx);
	expect(notices).toEqual([
		{
			message:
				"Agent World did not open: it quit at start (exit 1): dyld: Library not loaded: @rpath/Electron Framework. " +
				"Run /world again to retry.",
			level: "error",
		},
	]);
}, 20000);
