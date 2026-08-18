import { describe, expect, it } from "vitest";
import { CuratorStreamError, runCurator } from "../src/agents/curator/agent.js";
import { hashId } from "../src/ids.js";
import { observation } from "./fixtures/session.js";

function fakeAgentLoop(
	handler: (prompts: any[], context: any, config: any) => Promise<void> | void,
	events: any[] = [],
): any {
	return ((prompts: any[], context: any, config: any) => ({
		async *[Symbol.asyncIterator]() {
			for (const event of events) yield event;
		},
		result: async () => {
			await handler(prompts, context, config);
			return {};
		},
	})) as any;
}

function assistantEndEvent(stopReason: string, errorMessage?: string): any {
	return { type: "message_end", message: { role: "assistant", stopReason, errorMessage } };
}

function tool(context: any, name: string) {
	const found = context.tools.find((candidate: { name: string }) => candidate.name === name);
	if (!found) throw new Error(`missing tool ${name}`);
	return found;
}

describe("runCurator", () => {
	const prior = observation("aaaaaaaaaaaa");
	const baseArgs = {
		model: {} as any,
		apiKey: "test",
		reflections: [],
		observations: [prior],
		chunk: "[Source entry id: entry-a]\nUser asked for a memory update.",
		allowedSourceEntryIds: ["entry-a"],
		targetTokens: 10_000,
	};

	it("sequences jobs without ending the pass after observation coverage", async () => {
		let systemPrompt = "";
		const loop = fakeAgentLoop((_prompts, context) => {
			systemPrompt = context.systemPrompt;
		});

		await runCurator({ ...baseArgs, agentLoop: loop });

		expect(systemPrompt).toContain("A short confirmation never ends the pass");
		expect(systemPrompt).toContain("Preserve user assertions exactly");
		expect(systemPrompt).toContain("future-agent utility test");
		expect(systemPrompt).toContain("Default action is KEEP");
		expect(systemPrompt).not.toContain("That ends the run");
		expect(systemPrompt).not.toContain("20,000");
		expect(systemPrompt).not.toContain("20000");
	});

	it("lets record_reflections cite an observation recorded earlier in the same pass", async () => {
		const content = "User asked for a memory update.";
		const newId = hashId(content);
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await tool(context, "record_observations").execute("t1", {
				observations: [{ timestamp: "2026-05-02 10:30", content, relevance: "high", sourceEntryIds: ["entry-a"] }],
			});
			await tool(context, "record_reflections").execute("t2", {
				reflections: [{ content: "User wants memory updates persisted.", supportingObservationIds: [newId] }],
			});
		});

		const result = await runCurator({ ...baseArgs, observations: [], agentLoop: loop });

		expect(result?.observations).toHaveLength(1);
		expect(result?.observations[0].id).toBe(newId);
		expect(result?.reflections).toHaveLength(1);
		expect(result?.reflections[0].supportingObservationIds).toEqual([newId]);
	});

	it("rejects reflections that cite unknown observation ids", async () => {
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await tool(context, "record_reflections").execute("t1", {
				reflections: [{ content: "Invented support.", supportingObservationIds: ["missingmissing"] }],
			});
		});

		await expect(runCurator({ ...baseArgs, agentLoop: loop })).resolves.toBeUndefined();
	});

	it("rejects invented source entry ids", async () => {
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await tool(context, "record_observations").execute("t1", {
				observations: [
					{
						timestamp: "2026-05-02 10:30",
						content: "Bad source",
						relevance: "medium",
						sourceEntryIds: ["missing"],
					},
				],
			});
		});

		await expect(runCurator({ ...baseArgs, agentLoop: loop })).resolves.toBeUndefined();
	});

	it("rejects drops while the live cap is zero, then allows a maintenance drop after same-pass reflection", async () => {
		const receipts: string[] = [];
		const loop = fakeAgentLoop(async (_prompts, context) => {
			const before = await tool(context, "drop_observations").execute("t1", { ids: [prior.id] });
			receipts.push(before.content[0].text);
			await tool(context, "record_reflections").execute("t2", {
				reflections: [
					{
						content: "User asked for a memory update and that request is now current law.",
						supportingObservationIds: [prior.id],
					},
				],
			});
			const after = await tool(context, "drop_observations").execute("t3", { ids: [prior.id] });
			receipts.push(after.content[0].text);
		});

		const result = await runCurator({ ...baseArgs, agentLoop: loop });

		expect(receipts[0]).toContain("Live maximum drops allowed: 0");
		expect(receipts[1]).toMatch(/Live maximum drops allowed: 1 \(maintenance\)/);
		expect(result?.droppedIds).toEqual([prior.id]);
		expect(result?.reflections).toHaveLength(1);
	});

	it("does not drop an observation that is outside the live maintenance-eligible set", async () => {
		const other = observation("bbbbbbbbbbbb", { relevance: "low" });
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await tool(context, "record_reflections").execute("t1", {
				reflections: [
					{
						content: "Only the first observation became law.",
						supportingObservationIds: [prior.id],
					},
				],
			});
			await tool(context, "drop_observations").execute("t2", { ids: [other.id] });
		});

		const result = await runCurator({
			...baseArgs,
			observations: [prior, other],
			targetTokens: 10_000,
			agentLoop: loop,
		});

		expect(result?.droppedIds ?? []).toEqual([]);
		expect(result?.reflections).toHaveLength(1);
	});

	it("returns undefined when no tool records anything", async () => {
		const loop = fakeAgentLoop(() => {});
		await expect(runCurator({ ...baseArgs, agentLoop: loop })).resolves.toBeUndefined();
	});

	it("throws CuratorStreamError when the stream errors with nothing recorded", async () => {
		const loop = fakeAgentLoop(() => {}, [assistantEndEvent("error", "prompt is too long")]);
		const error = await runCurator({ ...baseArgs, agentLoop: loop }).catch((caught) => caught);
		expect(error).toBeInstanceOf(CuratorStreamError);
		expect(error.stopReason).toBe("error");
		expect(error.message).toContain("prompt is too long");
	});

	it("keeps partial records when the stream errors after recording", async () => {
		const content = "Kept despite later error";
		const loop = fakeAgentLoop(
			async (_prompts, context) => {
				await tool(context, "record_observations").execute("t1", {
					observations: [{ timestamp: "2026-05-02 10:30", content, relevance: "high", sourceEntryIds: ["entry-a"] }],
				});
			},
			[assistantEndEvent("error", "gateway timeout")],
		);

		const result = await runCurator({ ...baseArgs, observations: [], agentLoop: loop });
		expect(result?.observations).toHaveLength(1);
		expect(result?.observations[0].content).toBe(content);
	});
});
