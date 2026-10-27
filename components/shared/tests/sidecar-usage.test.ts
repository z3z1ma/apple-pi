import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ agentDir: "" }));

vi.mock("@earendil-works/pi-coding-agent", () => ({
	getAgentDir: () => mock.agentDir,
}));

import {
	recordSidecarUsage,
	SIDECAR_USAGE_MAX_BYTES,
	SIDECAR_USAGE_RECORD_KEYS,
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
			agent: "pair",
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
				agent: "pair",
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
				reviewId: "rev-7",
				batchItems: 4,
				batchTokens: 1_200,
				activeWaitMs: 45_000,
				attention: "routine",
				...({
					prompt: "secret transcript",
					advice: "do not persist this",
				} as object),
			});
		});

		const path = join(agentDir, "sidecar-usage", "session-123.ndjson");
		const [row] = readJsonLines(path);
		expect(Object.keys(row).sort()).toEqual([...SIDECAR_USAGE_RECORD_KEYS].sort());
		expect(row).toMatchObject({
			sessionId: "session-123",
			agent: "pair",
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
			reviewId: "rev-7",
			batchItems: 4,
			batchTokens: 1_200,
			activeWaitMs: 45_000,
			attention: "routine",
		});
		expect(row).not.toHaveProperty("prompt");
		expect(row).not.toHaveProperty("advice");
		expect(JSON.stringify(row)).not.toContain("secret");
	});

	it("falls back to the unscoped file without a usable session id", () => {
		withSidecarUsageContext({}, () => {
			recordSidecarUsage({ agent: "pair", trigger: "notebook_maintenance", status: "ok" });
		});
		expect(existsSync(join(agentDir, "sidecar-usage", "unscoped.ndjson"))).toBe(true);
	});

	it("swallows write failures", () => {
		mock.agentDir = join(agentDir, "blocked");
		writeFileSync(mock.agentDir, "not-a-directory");
		expect(() =>
			withSidecarUsageContext({ sessionId: "session-123" }, () => {
				recordSidecarUsage({ agent: "pair", trigger: "orientation", status: "error" });
			}),
		).not.toThrow();
	});

	it("records a zero-counter finish when no assistant message arrived", () => {
		withSidecarUsageContext({ sessionId: "session-empty", threshold: 10_000 }, () => {
			const tracker = startSidecarUsageTracker({
				agent: "pair",
				trigger: "notebook_maintenance",
				provider: "openai-codex",
				model: "gpt-5.6-luna",
			});
			tracker.finish("aborted");
		});
		const [row] = readJsonLines(join(agentDir, "sidecar-usage", "session-empty.ndjson"));
		expect(row).toMatchObject({
			agent: "pair",
			trigger: "notebook_maintenance",
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
				agent: "pair",
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
		const rows = readJsonLines(join(agentDir, "sidecar-usage", "session-calls.ndjson"));
		expect(rows).toHaveLength(2);
		expect(rows.map((row) => row.status)).toEqual(["stop", "error"]);
		expect(rows[0]).toMatchObject({ input: 3, cacheRead: 8, output: 1, cost: 0.1 });
	});

	it("writes unusual IDs to safe filenames and unusable IDs to the shared unscoped file", () => {
		for (const [sessionId, filename] of [
			[" session/../id:value ", "session_.._id_value.ndjson"],
			["---", "unscoped.ndjson"],
		] as const) {
			withSidecarUsageContext({ sessionId }, () => {
				recordSidecarUsage({ agent: "pair", trigger: "turn_end", status: "stop" });
			});
			expect(readJsonLines(join(agentDir, "sidecar-usage", filename))).toEqual([
				expect.objectContaining({ sessionId, agent: "pair", status: "stop" }),
			]);
		}
	});

	it("keeps the previous session usage bytes in the owned rotation file when starting a fresh log", () => {
		const file = join(agentDir, "sidecar-usage", "session-rotation.ndjson");
		mkdirSync(join(agentDir, "sidecar-usage"));
		const previous = Buffer.alloc(SIDECAR_USAGE_MAX_BYTES, "x");
		writeFileSync(file, previous);
		withSidecarUsageContext({ sessionId: "session-rotation" }, () => {
			recordSidecarUsage({ agent: "pair", trigger: "turn_end", status: "stop" });
		});
		expect(readFileSync(`${file}.1`).equals(previous)).toBe(true);
		expect(readJsonLines(file)).toEqual([
			expect.objectContaining({ sessionId: "session-rotation", agent: "pair", status: "stop" }),
		]);
	});

	it("extracts numeric counters and usage.cost.total", () => {
		expect(usageFieldsFromUnknown({ input: "3", cacheRead: 1, output: 2, cost: { total: 0.4 } })).toEqual({
			input: 3,
			cacheRead: 1,
			cacheWrite: 0,
			output: 2,
			cost: 0.4,
		});
	});
});
