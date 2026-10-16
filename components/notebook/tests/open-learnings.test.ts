import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { registerOpenLearnings } from "../src/hooks/open-learnings.js";
import type { Entry, Reflection } from "../src/session-ledger/types.js";

function learning(id: string): Reflection {
	return { id, content: `learning ${id}`, supportingObservationIds: [], sourceEntryIds: ["m1"], tokenCount: 4 };
}

function harness(reflections: Reflection[]) {
	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
	const statuses = new Map<string, string | undefined>();
	const branch: Entry[] = [
		{ id: "m1", type: "message", message: { role: "user", content: "start" } },
		{
			id: "n1",
			type: "custom",
			customType: "notebook.reflections.recorded",
			data: { reflections, coversUpToId: "m1" },
		},
	];
	const ctx = {
		sessionManager: { getBranch: () => branch },
		ui: { setStatus: (key: string, text: string | undefined) => statuses.set(key, text) },
	} as unknown as ExtensionContext;
	registerOpenLearnings({
		on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => handlers.set(event, handler),
	} as unknown as ExtensionAPI);
	const emit = (event: string, payload: unknown = {}) => handlers.get(event)?.(payload, ctx);
	const close = (task: string, status = "done") =>
		emit("tool_call", { toolName: "ledger_status", input: { task, status } });
	return { branch, statuses, emit, close };
}

describe("open learnings", () => {
	it("shows the open-learning count and clears it when none are open", () => {
		const open = harness([learning("aaaaaaaaaaaa"), learning("bbbbbbbbbbbb")]);
		open.emit("session_start");
		expect(open.statuses.get("learnings")).toBe("learnings:2");

		open.branch.push({
			id: "n2",
			type: "custom",
			customType: "notebook.reflections.retired",
			data: { reflectionIds: ["aaaaaaaaaaaa", "bbbbbbbbbbbb"], coversUpToId: "m1" },
		});
		open.emit("turn_end");
		expect(open.statuses.get("learnings")).toBeUndefined();
	});

	it("holds the first close of each task while learnings are open", () => {
		const { close } = harness([learning("aaaaaaaaaaaa")]);
		expect(close("task-a", "in-progress")).toBeUndefined();
		expect(close("task-a")).toMatchObject({ block: true, reason: expect.stringContaining("distill") });
		expect(close("task-a")).toBeUndefined();
		expect(close("task-b", "cancelled")).toMatchObject({ block: true });
	});

	it("lists every open learning's id and full text in the hold", () => {
		const { close } = harness([learning("aaaaaaaaaaaa"), learning("bbbbbbbbbbbb")]);
		const result = close("task-a") as { block: boolean; reason: string };
		expect(result.reason).toContain("\n[aaaaaaaaaaaa] learning aaaaaaaaaaaa\n[bbbbbbbbbbbb] learning bbbbbbbbbbbb");
	});

	it("lets a task close at once when no learnings are open", () => {
		expect(harness([]).close("task-a")).toBeUndefined();
	});
});
