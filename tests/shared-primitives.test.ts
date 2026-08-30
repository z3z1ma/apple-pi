import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseArgv } from "../components/shared/src/argv.js";
import { acquireExclusiveLease, activeExclusiveLease } from "../components/shared/src/exclusive-lease.js";
import { applyCompleteSettings, applySettings, loadSettings } from "../components/subagents/src/settings.js";

const roots: string[] = [];
const priorAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
	if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("shared argv", () => {
	const statusCommand = {
		defaultAction: "status",
		actions: ["inspect", "start", "step", "run", "status", "stop"],
		stringOptions: ["root", "ledger_root"],
		unknownOption: (rawName: string) => `Unknown option: --${rawName}`,
	};
	const review = {
		defaultAction: "run",
		actions: ["run", "preview", "status", "stop"],
		stringOptions: ["root", "profile", "background", "from", "to", "commit"],
		unknownOption: (rawName: string) => `Unknown review option: --${rawName}`,
	};

	it("parses --root the same way across command fixtures", () => {
		expect(parseArgv("--root /tmp", statusCommand)).toEqual({
			action: "status",
			positional: [],
			options: { root: "/tmp" },
		});
		expect(parseArgv("--root /tmp", review)).toEqual({
			action: "run",
			positional: [],
			options: { root: "/tmp" },
		});
		expect(parseArgv("--root /workspace run task.md", statusCommand)).toEqual({
			action: "run",
			positional: ["task.md"],
			options: { root: "/workspace" },
		});
		expect(parseArgv("--root /workspace workspace", review)).toEqual({
			action: "run",
			positional: ["workspace"],
			options: { root: "/workspace" },
		});
	});

	it("rejects empty option values and unknown flags", () => {
		expect(() => parseArgv("run --root=", statusCommand)).toThrow("--root requires a value");
		expect(() => parseArgv("preview --background=", review)).toThrow("--background requires a value");
		expect(() => parseArgv("status --unknown x", statusCommand)).toThrow("Unknown option: --unknown");
	});
});

describe("exclusive leases", () => {
	const messages = {
		owned: (owner: { runId: string }) => `owned by ${owner.runId}`,
		failed: "failed",
	};

	it("holds one exclusive file lock per project", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "apple-pi-lease-agent-"));
		const project = mkdtempSync(join(tmpdir(), "apple-pi-lease-project-"));
		roots.push(agentDir, project);
		process.env.PI_CODING_AGENT_DIR = agentDir;

		const release = acquireExclusiveLease("reviews", project, "run-a", messages);
		expect(activeExclusiveLease("reviews", project)?.runId).toBe("run-a");
		expect(() => acquireExclusiveLease("reviews", project, "run-b", messages)).toThrow(/owned by run-a/);
		release();
		expect(activeExclusiveLease("reviews", project)).toBeUndefined();
		const recovered = acquireExclusiveLease("reviews", project, "run-c", messages);
		expect(activeExclusiveLease("reviews", project)?.runId).toBe("run-c");
		recovered();
	});

	it("ignores malformed stale owner metadata when the OS lease is free", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "apple-ralph-lease-agent-"));
		const project = mkdtempSync(join(tmpdir(), "apple-ralph-lease-project-"));
		roots.push(agentDir, project);
		process.env.PI_CODING_AGENT_DIR = agentDir;
		const release = acquireExclusiveLease("ralph", project, "seed", messages);
		const locksDir = join(agentDir, "ralph", "locks");
		const ownerFile = readdirSync(locksDir).find((name) => name.endsWith(".owner"));
		expect(ownerFile).toBeDefined();
		release();
		writeFileSync(join(locksDir, ownerFile!), "{", { mode: 0o600 });
		const recovered = acquireExclusiveLease("ralph", project, "run-d", messages);
		expect(activeExclusiveLease("ralph", project)?.runId).toBe("run-d");
		recovered();
	});

	it("recovers an operating-system lease after a competing process dies", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "apple-review-lease-agent-"));
		const project = mkdtempSync(join(tmpdir(), "apple-review-lease-project-"));
		roots.push(agentDir, project);
		process.env.PI_CODING_AGENT_DIR = agentDir;
		const seed = acquireExclusiveLease("reviews", project, "seed", messages);
		seed();
		const locksDir = join(agentDir, "reviews", "locks");
		const databasePath = join(locksDir, readdirSync(locksDir).find((name) => name.endsWith(".sqlite"))!);
		const ownerPath = databasePath.replace(/\.sqlite$/, ".owner");
		const child = spawn(
			process.execPath,
			[
				"-e",
				`const { DatabaseSync } = require("node:sqlite");
const { writeFileSync } = require("node:fs");
const database = new DatabaseSync(process.env.LEASE_DB);
database.exec("BEGIN IMMEDIATE;");
writeFileSync(process.env.LEASE_OWNER, JSON.stringify({ pid: process.pid, runId: "child", projectRoot: process.env.PROJECT_ROOT, acquiredAt: new Date().toISOString() }));
process.stdout.write("ready\\n");
setInterval(() => {}, 1000);`,
			],
			{
				env: { ...process.env, LEASE_DB: databasePath, LEASE_OWNER: ownerPath, PROJECT_ROOT: project },
				stdio: ["ignore", "pipe", "inherit"],
			},
		);
		await once(child.stdout!, "data");
		expect(() => acquireExclusiveLease("reviews", project, "parent", messages)).toThrow(/owned by child/);
		child.kill("SIGKILL");
		await once(child, "exit");
		const recovered = acquireExclusiveLease("reviews", project, "parent", messages);
		expect(activeExclusiveLease("reviews", project)?.runId).toBe("parent");
		recovered();
	});
});

describe("subagent settings rebinding", () => {
	it("resets an override that the next project omitted", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "apple-pi-settings-agent-"));
		const first = mkdtempSync(join(tmpdir(), "apple-pi-settings-a-"));
		const second = mkdtempSync(join(tmpdir(), "apple-pi-settings-b-"));
		roots.push(agentDir, first, second);
		process.env.PI_CODING_AGENT_DIR = agentDir;
		mkdirSync(join(first, ".pi"), { recursive: true });
		writeFileSync(join(first, ".pi", "subagents.json"), JSON.stringify({ maxConcurrent: 9, widgetMode: "all" }));

		const applied: Record<string, unknown> = {};
		const appliers = {
			setMaxConcurrent: (value: number) => {
				applied.maxConcurrent = value;
			},
			setDefaultMaxTurns: (value: number) => {
				applied.defaultMaxTurns = value;
			},
			setGraceTurns: (value: number) => {
				applied.graceTurns = value;
			},
			setDefaultJoinMode: (value: string) => {
				applied.defaultJoinMode = value;
			},
			setStrictAgentFiles: (value: boolean) => {
				applied.strictAgentFiles = value;
			},
			setDisableDefaultAgents: (value: boolean) => {
				applied.disableDefaultAgents = value;
			},
			setFleetView: (value: boolean) => {
				applied.fleetView = value;
			},
			setPersistAgentSessions: (value: boolean) => {
				applied.persistAgentSessions = value;
			},
			setWidgetMode: (value: string) => {
				applied.widgetMode = value;
			},
			setMaxSubagentDepth: (value: number) => {
				applied.maxSubagentDepth = value;
			},
		};

		applyCompleteSettings(loadSettings({ cwd: first, projectTrusted: true }), appliers);
		expect(applied).toMatchObject({ maxConcurrent: 9, widgetMode: "all" });
		applySettings({ persistAgentSessions: false }, appliers);
		expect(applied.persistAgentSessions).toBe(false);
		applyCompleteSettings(loadSettings({ cwd: second, projectTrusted: true }), appliers);
		expect(applied).toMatchObject({
			maxConcurrent: 4,
			widgetMode: "background",
			persistAgentSessions: true,
		});
	});
});
