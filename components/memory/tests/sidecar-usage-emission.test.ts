import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ agentDir: "" }));

vi.mock("@earendil-works/pi-coding-agent", () => ({
	getAgentDir: () => mock.agentDir,
}));

import { sidecarUsageRelativePath, withSidecarUsageContext } from "../../shared/src/sidecar-usage.js";
import { runDropper } from "../src/agents/dropper/agent.js";
import { runObserver } from "../src/agents/observer/agent.js";
import { runReflector } from "../src/agents/reflector/agent.js";
import { observation, reflection } from "./fixtures/session.js";

function fakeAgentLoop(events: any[]): any {
	return (() => ({
		async *[Symbol.asyncIterator]() {
			for (const event of events) yield event;
		},
		result: async () => ({}),
	})) as any;
}

function assistantEnd(stopReason: string, usage?: Record<string, unknown>): any {
	return {
		type: "message_end",
		message: {
			role: "assistant",
			stopReason,
			usage: usage ?? { input: 7, output: 2, cacheRead: 3, cacheWrite: 1, cost: { total: 0.05 } },
		},
	};
}

describe("memory sidecar usage emission", () => {
	let root: string;
	let agentDir: string;

	beforeEach(() => {
		root = `${tmpdir()}/om-sidecar-usage-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		agentDir = join(root, "agent");
		mkdirSync(agentDir, { recursive: true });
		mock.agentDir = agentDir;
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	function readRows(sessionId: string): Record<string, unknown>[] {
		const path = join(agentDir, sidecarUsageRelativePath(sessionId));
		return readFileSync(path, "utf-8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as Record<string, unknown>);
	}

	it("does not write from an unbound observer run", async () => {
		await runObserver({
			model: { provider: "openai-codex", id: "gpt-5.6-luna" } as any,
			apiKey: "test",
			priorReflections: [],
			priorObservations: [],
			chunk: "[Source entry id: entry-a]\nUser asked for a memory update.",
			allowedSourceEntryIds: ["entry-a"],
			agentLoop: fakeAgentLoop([assistantEnd("stop")]),
		});
		expect(existsSync(join(agentDir, "sidecar-usage"))).toBe(false);
	});

	it("records observer, reflector, and dropper calls with stage triggers", async () => {
		const model = { provider: "openai-codex", id: "gpt-5.6-luna" } as any;
		await withSidecarUsageContext({ sessionId: "om-session", threshold: 10_000 }, async () => {
			await runObserver({
				model,
				apiKey: "test",
				priorReflections: [],
				priorObservations: [],
				chunk: "[Source entry id: entry-a]\nUser asked for a memory update.",
				allowedSourceEntryIds: ["entry-a"],
				agentLoop: fakeAgentLoop([assistantEnd("stop")]),
			});
			await runReflector({
				model,
				apiKey: "test",
				reflections: [],
				observations: [observation("aaaaaaaaaaaa")],
				agentLoop: fakeAgentLoop([assistantEnd("stop")]),
			});
			await runDropper({
				model,
				apiKey: "test",
				reflections: [reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"])],
				observations: [observation("aaaaaaaaaaaa"), observation("bbbbbbbbbbbb")],
				targetTokens: 1,
				agentLoop: fakeAgentLoop([assistantEnd("stop")]),
			});
		});

		const rows = readRows("om-session");
		expect(rows.map((row) => row.agent)).toEqual(["observer", "reflector", "dropper"]);
		expect(rows.map((row) => row.trigger)).toEqual([
			"observeAfterTokens",
			"reflectAfterTokens",
			"observationsPoolTargetTokens",
		]);
		expect(rows.every((row) => row.threshold === 10_000)).toBe(true);
		expect(rows[0]).toMatchObject({
			provider: "openai-codex",
			model: "gpt-5.6-luna",
			input: 7,
			cacheRead: 3,
			cacheWrite: 1,
			output: 2,
			cost: 0.05,
			status: "stop",
		});
		expect(JSON.stringify(rows)).not.toContain("User asked");
		expect(JSON.stringify(rows)).not.toContain("aaaaaaaaaaaa");
	});

	it("records a zero-counter observer failure without assistant usage", async () => {
		await withSidecarUsageContext({ sessionId: "om-empty" }, async () => {
			await expect(
				runObserver({
					model: { provider: "openai-codex", id: "gpt-5.6-luna" } as any,
					apiKey: "test",
					priorReflections: [],
					priorObservations: [],
					chunk: "[Source entry id: entry-a]\nUser asked for a memory update.",
					allowedSourceEntryIds: ["entry-a"],
					agentLoop: fakeAgentLoop([
						{ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "timeout" } },
					]),
				}),
			).rejects.toThrow(/observer stream ended/);
		});
		const [row] = readRows("om-empty");
		expect(row).toMatchObject({
			agent: "observer",
			status: "error",
			input: 0,
			output: 0,
			cost: 0,
		});
	});
});
