import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ agentDir: "" }));

vi.mock("@earendil-works/pi-coding-agent", () => ({
	getAgentDir: () => mock.agentDir,
}));

import {
	buildSidecarUsageRecord,
	recordSidecarUsage,
	SIDECAR_USAGE_MAX_BYTES,
	SIDECAR_USAGE_RECORD_KEYS,
	safeSidecarUsageSessionId,
	sidecarUsageRelativePath,
	startSidecarUsageTracker,
	usageFieldsFromUnknown,
	withSidecarUsageContext,
} from "../src/sidecar-usage.js";

describe("sidecar usage records", () => {
	let root: string;
	let agentDir: string;

	beforeEach(() => {
		root = `${tmpdir()}/sidecar-usage-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		agentDir = join(root, "agent");
		mkdirSync(agentDir, { recursive: true });
		mock.agentDir = agentDir;
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	function readJsonLines(path: string): Record<string, unknown>[] {
		return readFileSync(path, "utf-8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as Record<string, unknown>);
	}

	it("does not write when no session is bound", () => {
		recordSidecarUsage({
			agent: "sentinel",
			trigger: "turn_end",
			status: "stop",
			provider: "anthropic",
			model: "claude-opus-5",
		});
		expect(existsSync(join(agentDir, "sidecar-usage"))).toBe(false);
	});

	it("writes a session-scoped allowlisted record", () => {
		withSidecarUsageContext({ sessionId: "session-123" }, () => {
			recordSidecarUsage({
				agent: "sentinel",
				trigger: "turn_end",
				status: "stop",
				provider: "anthropic",
				model: "claude-opus-5",
				input: 10,
				cacheRead: 20,
				cacheWrite: 1,
				output: 5,
				cost: 0.02,
				durationMs: 12,
				threshold: 68,
				...({
					prompt: "secret transcript",
					advice: "do not persist this",
				} as object),
			});
		});

		const path = join(agentDir, sidecarUsageRelativePath("session-123"));
		const [row] = readJsonLines(path);
		expect(Object.keys(row).sort()).toEqual([...SIDECAR_USAGE_RECORD_KEYS].sort());
		expect(row).toMatchObject({
			sessionId: "session-123",
			agent: "sentinel",
			trigger: "turn_end",
			status: "stop",
			provider: "anthropic",
			model: "claude-opus-5",
			input: 10,
			cacheRead: 20,
			cacheWrite: 1,
			output: 5,
			cost: 0.02,
			durationMs: 12,
			threshold: 68,
		});
		expect(row).not.toHaveProperty("prompt");
		expect(row).not.toHaveProperty("advice");
		expect(JSON.stringify(row)).not.toContain("secret");
	});

	it("falls back to the unscoped file without a usable session id", () => {
		withSidecarUsageContext({}, () => {
			recordSidecarUsage({ agent: "observer", trigger: "observeAfterTokens", status: "ok" });
		});
		expect(existsSync(join(agentDir, sidecarUsageRelativePath(undefined)))).toBe(true);
	});

	it("swallows write failures", () => {
		mock.agentDir = join(agentDir, "blocked");
		writeFileSync(mock.agentDir, "not-a-directory");
		expect(() =>
			withSidecarUsageContext({ sessionId: "session-123" }, () => {
				recordSidecarUsage({ agent: "dropper", trigger: "observationsPoolTargetTokens", status: "error" });
			}),
		).not.toThrow();
	});

	it("records a zero-counter finish when no assistant message arrived", () => {
		withSidecarUsageContext({ sessionId: "session-empty", threshold: 10_000 }, () => {
			const tracker = startSidecarUsageTracker({
				agent: "observer",
				trigger: "observeAfterTokens",
				provider: "openai-codex",
				model: "gpt-5.6-luna",
			});
			tracker.finish("aborted");
		});
		const [row] = readJsonLines(join(agentDir, sidecarUsageRelativePath("session-empty")));
		expect(row).toMatchObject({
			agent: "observer",
			trigger: "observeAfterTokens",
			status: "aborted",
			input: 0,
			cacheRead: 0,
			cacheWrite: 0,
			output: 0,
			cost: 0,
			threshold: 10_000,
		});
	});

	it("records each assistant message and skips finish after a real call", () => {
		withSidecarUsageContext({ sessionId: "session-calls" }, () => {
			const tracker = startSidecarUsageTracker({
				agent: "sentinel",
				trigger: "turn_end",
				provider: "xai",
				model: "grok-4.6",
			});
			tracker.observeAssistant({
				role: "assistant",
				stopReason: "stop",
				usage: { input: 3, output: 1, cacheRead: 8, cacheWrite: 0, cost: { total: 0.1 } },
			});
			tracker.observeEvent({
				type: "message_end",
				message: {
					role: "assistant",
					stopReason: "error",
					usage: { input: 4, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
				},
			});
			tracker.observeEvent({
				type: "message_start",
				message: {
					role: "assistant",
					stopReason: "stop",
					usage: { input: 99, output: 99, cacheRead: 99, cacheWrite: 0, cost: { total: 9 } },
				},
			});
			tracker.finish("ok");
		});
		const rows = readJsonLines(join(agentDir, sidecarUsageRelativePath("session-calls")));
		expect(rows).toHaveLength(2);
		expect(rows.map((row) => row.status)).toEqual(["stop", "error"]);
		expect(rows[0]).toMatchObject({ input: 3, cacheRead: 8, output: 1, cost: 0.1 });
	});

	it("aggregates into the baseline table columns", () => {
		const records = [
			buildSidecarUsageRecord({
				agent: "sentinel",
				trigger: "turn_end",
				status: "stop",
				provider: "anthropic",
				model: "claude-opus-5",
				input: 100,
				cacheRead: 50,
				output: 10,
				cost: 1.5,
			}),
			buildSidecarUsageRecord({
				agent: "observer",
				trigger: "observeAfterTokens",
				status: "stop",
				provider: "openai-codex",
				model: "gpt-5.6-luna",
				input: 20,
				cacheRead: 5,
				output: 2,
				cost: 0.01,
			}),
			buildSidecarUsageRecord({
				agent: "sentinel",
				trigger: "turn_end_replay",
				status: "length",
				provider: "anthropic",
				model: "claude-opus-5",
				input: 80,
				cacheRead: 10,
				output: 0,
				cost: 0.5,
			}),
		];
		const table = new Map<string, { calls: number; input: number; cacheRead: number; output: number; cost: number }>();
		for (const record of records) {
			const key = `${record.provider}/${record.model}`;
			const row = table.get(key) ?? { calls: 0, input: 0, cacheRead: 0, output: 0, cost: 0 };
			row.calls += 1;
			row.input += record.input;
			row.cacheRead += record.cacheRead;
			row.output += record.output;
			row.cost += record.cost;
			table.set(key, row);
		}
		expect(Object.fromEntries(table)).toEqual({
			"anthropic/claude-opus-5": { calls: 2, input: 180, cacheRead: 60, output: 10, cost: 2 },
			"openai-codex/gpt-5.6-luna": { calls: 1, input: 20, cacheRead: 5, output: 2, cost: 0.01 },
		});
	});

	it("sanitizes session ids and extracts usage.cost.total", () => {
		expect(safeSidecarUsageSessionId(" session/../id:value ")).toBe("session_.._id_value");
		expect(sidecarUsageRelativePath("---")).toBe(join("sidecar-usage", "unscoped.ndjson"));
		expect(usageFieldsFromUnknown({ input: "3", cacheRead: 1, output: 2, cost: { total: 0.4 } })).toEqual({
			input: 3,
			cacheRead: 1,
			cacheWrite: 0,
			output: 2,
			cost: 0.4,
		});
		expect(SIDECAR_USAGE_MAX_BYTES).toBeGreaterThan(0);
	});
});
