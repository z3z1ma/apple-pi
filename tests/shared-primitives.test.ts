import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
	const ralph = {
		defaultAction: "status",
		actions: ["inspect", "start", "step", "run", "status", "stop"],
		stringOptions: ["root", "ledger_root"],
		unknownOption: (rawName: string) => `Unknown Ralph option: --${rawName}`,
	};
	const review = {
		defaultAction: "run",
		actions: ["run", "preview", "status", "stop"],
		stringOptions: ["root", "profile", "background", "from", "to", "commit"],
		unknownOption: (rawName: string) => `Unknown review option: --${rawName}`,
	};

	it("parses --root the same way for Ralph and Review", () => {
		expect(parseArgv("--root /tmp", ralph)).toEqual({
			action: "status",
			positional: [],
			options: { root: "/tmp" },
		});
		expect(parseArgv("--root /tmp", review)).toEqual({
			action: "run",
			positional: [],
			options: { root: "/tmp" },
		});
		expect(parseArgv("--root /workspace run task.md", ralph)).toEqual({
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
		expect(() => parseArgv("run --root=", ralph)).toThrow("--root requires a value");
		expect(() => parseArgv("preview --background=", review)).toThrow("--background requires a value");
		expect(() => parseArgv("status --unknown x", ralph)).toThrow("Unknown Ralph option: --unknown");
	});
});

describe("exclusive leases", () => {
	const messages = {
		unreadable: (path: string) => `unreadable ${path}`,
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

	it("fails closed on an unreadable file lock", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "apple-pi-ralph-lease-agent-"));
		const project = mkdtempSync(join(tmpdir(), "apple-pi-ralph-lease-project-"));
		roots.push(agentDir, project);
		process.env.PI_CODING_AGENT_DIR = agentDir;
		const release = acquireExclusiveLease("ralph", project, "seed", messages);
		const locksDir = join(agentDir, "ralph", "locks");
		const lockFile = readdirSync(locksDir).find((name) => name.endsWith(".lock"));
		expect(lockFile).toBeDefined();
		release();
		writeFileSync(join(locksDir, lockFile!), "{", { mode: 0o600 });
		expect(() =>
			acquireExclusiveLease("ralph", project, "run-d", {
				unreadable: (path) => `Ralph resource lease is unreadable: ${path}`,
				owned: (owner) => `owned by ${owner.runId}`,
				failed: "failed",
			}),
		).toThrow(/unreadable/);
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
			setFallbackSubagent: (value: string | undefined) => {
				applied.fallbackSubagent = value;
			},
		};

		applyCompleteSettings(loadSettings(first), appliers);
		expect(applied).toMatchObject({ maxConcurrent: 9, widgetMode: "all" });
		applySettings({ persistAgentSessions: false }, appliers);
		expect(applied.persistAgentSessions).toBe(false);
		applyCompleteSettings(loadSettings(second), appliers);
		expect(applied).toMatchObject({
			maxConcurrent: 4,
			widgetMode: "background",
			persistAgentSessions: true,
			fallbackSubagent: undefined,
		});
	});
});
