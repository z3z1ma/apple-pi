import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ agentDir: "" }));

vi.mock("@earendil-works/pi-coding-agent", () => ({
	getAgentDir: () => mock.agentDir,
}));

import { DEFAULTS, loadConfig, readEnvConfig } from "../src/config.js";
import { Runtime } from "../src/runtime.js";

function writeJson(path: string, value: unknown) {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, JSON.stringify(value), "utf-8");
}

describe("pair programmer notebook config", () => {
	let root: string;
	let cwd: string;
	let agentDir: string;

	beforeEach(() => {
		root = `${tmpdir()}/pair-notebook-config-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		cwd = join(root, "project");
		agentDir = join(root, "agent");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		mock.agentDir = agentDir;
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("uses pair programmer notebook defaults", () => {
		expect(loadConfig(cwd, false, {})).toMatchObject({ notebookAfterTokens: 20000, passive: false });
	});

	it("loads project pair programmer settings only when trusted", () => {
		writeJson(join(cwd, ".pi", "settings.json"), { pair: { notebookAfterTokens: 100 } });
		expect(loadConfig(cwd, false, {})).toMatchObject({ notebookAfterTokens: DEFAULTS.notebookAfterTokens });
		expect(loadConfig(cwd, true, {})).toMatchObject({ notebookAfterTokens: 100 });
	});

	it("does not reuse an untrusted config after trust changes", () => {
		writeJson(join(cwd, ".pi", "settings.json"), { pair: { notebookAfterTokens: 100 } });
		const runtime = new Runtime();
		expect(runtime.ensureConfig(cwd, false).notebookAfterTokens).toBe(DEFAULTS.notebookAfterTokens);
		expect(runtime.ensureConfig(cwd, true).notebookAfterTokens).toBe(100);
	});

	it("merges global, trusted project, and env pair programmer settings in order", () => {
		writeJson(join(agentDir, "settings.json"), {
			pair: { notebookAfterTokens: 10, notebookSourceMaxTokens: 2000, passive: false },
		});
		writeJson(join(cwd, ".pi", "settings.json"), {
			pair: { notebookAfterTokens: 100 },
		});
		expect(loadConfig(cwd, true, { PI_PAIR_NOTEBOOK_PASSIVE: "true" })).toEqual({
			notebookAfterTokens: 100,
			notebookSourceMaxTokens: 2000,
			passive: true,
		});
	});

	it("ignores invalid pair programmer values", () => {
		writeJson(join(cwd, ".pi", "settings.json"), {
			pair: { notebookAfterTokens: -1, notebookSourceMaxTokens: 0, passive: "yes" },
		});
		expect(loadConfig(cwd, true, {})).toEqual(DEFAULTS);
	});

	it("parses passive env override", () => {
		expect(readEnvConfig({ PI_PAIR_NOTEBOOK_PASSIVE: "on" })).toEqual({ passive: true });
		expect(readEnvConfig({ PI_PAIR_NOTEBOOK_PASSIVE: "0" })).toEqual({ passive: false });
		expect(readEnvConfig({ PI_PAIR_NOTEBOOK_PASSIVE: "maybe" })).toEqual({});
	});
});
