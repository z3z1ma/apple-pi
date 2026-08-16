import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Runtime } from "../components/memory/src/runtime.js";
import { visibleProjection } from "../components/memory/src/session-ledger/projection.js";
import { OM_FOLDED, type Entry, type Observation } from "../components/memory/src/session-ledger/types.js";
import { countPiVccCompactions } from "../components/vcc/src/core/compaction-count";
import {
	PI_VCC_COMPACT_INSTRUCTION,
	registerBeforeCompactHook,
} from "../components/vcc/src/hooks/before-compact";
import { createMemoryCompactionAugmenter } from "../extensions/context.js";

let cwd: string;

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "apple-pi-context-"));
	const configPath = join(cwd, "vcc.json");
	writeFileSync(configPath, JSON.stringify({ overrideDefaultCompaction: false, debug: false }));
	process.env.PI_VCC_CONFIG_PATH = configPath;
});

afterEach(() => {
	delete process.env.PI_VCC_CONFIG_PATH;
	rmSync(cwd, { recursive: true, force: true });
});

function message(id: string, role: string, content: unknown): Entry {
	return { id, type: "message", message: { role, content } };
}

function captureBeforeCompact() {
	let handler: ((event: any, ctx: any) => any) | undefined;
	const pi = {
		on(name: string, next: (event: any, ctx: any) => any) {
			if (name === "session_before_compact") handler = next;
		},
		sendMessage() {},
	} as any;
	return {
		pi,
		invoke(event: any) {
			if (!handler) throw new Error("before-compact handler was not registered");
			return handler(event, {
				cwd,
				model: { contextWindow: 128_000, maxTokens: 8_000 },
				hasUI: false,
				isIdle: () => true,
				sessionManager: { getEntries: () => [] },
				ui: { notify() {} },
			});
		},
	};
}

describe("integrated VCC and observational-memory compaction", () => {
	it("writes one summary and one flat details record recognized by both readers", () => {
		const observation: Observation = {
			id: "abc123abc123",
			content: "The project requires deterministic compaction.",
			timestamp: "2026-08-15T10:00:00.000Z",
			relevance: "high",
			sourceEntryIds: ["m1"],
			tokenCount: 8,
		};
		const entries: Entry[] = [
			message("m1", "user", "Build deterministic context compaction"),
			message("m2", "assistant", [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } }]),
			message("m3", "toolResult", "README contents"),
			{
				id: "memory-1",
				type: "custom",
				customType: "om.observations.recorded",
				data: { observations: [observation], coversUpToId: "m3" },
			},
			message("m4", "assistant", "Initial investigation complete"),
			message("m5", "user", "Continue"),
		];

		const runtime = new Runtime();
		runtime.configLoaded = true;
		const harness = captureBeforeCompact();
		registerBeforeCompactHook(harness.pi, createMemoryCompactionAugmenter(runtime));
		const result = harness.invoke({
			branchEntries: entries,
			customInstructions: PI_VCC_COMPACT_INSTRUCTION,
			preparation: {
				previousSummary: undefined,
				fileOps: { read: [], written: [], edited: [] },
				tokensBefore: 1_000,
				settings: { keepRecentTokens: 20_000 },
			},
		});

		expect(result.compaction.summary).toContain("[Session Goal]");
		expect(result.compaction.summary).toContain("## Observations");
		expect(result.compaction.summary).toContain("[abc123abc123]");
		expect(result.compaction.details.compactor).toBe("pi-vcc");
		expect(result.compaction.details.type).toBe(OM_FOLDED);
		expect(result.compaction.firstKeptEntryId).toBe("m5");

		const compactionEntry: Entry = {
			id: "compact-1",
			type: "compaction",
			firstKeptEntryId: result.compaction.firstKeptEntryId,
			details: result.compaction.details,
		};
		expect(countPiVccCompactions([...entries, compactionEntry])).toBe(1);
		expect(visibleProjection([...entries, compactionEntry]).observations).toEqual([observation]);
	});
});
