import { expect, it } from "vitest";
import {
	buildBtwInjection,
	buildBtwParentSnapshot,
	buildBtwPrompt,
	formatBtwUserMessage,
	getLatestBtwExchange,
} from "../src/context.js";

it("captures bounded parent conversation text and appends only the next visit's delta", () => {
	const branch = [
		{ id: "1", type: "message", message: { role: "user", content: "older context" } },
		{
			id: "2",
			type: "message",
			message: { role: "toolResult", content: [{ type: "text", text: "private tool output" }] },
		},
		{ id: "3", type: "message", message: { role: "assistant", content: [{ type: "text", text: "latest answer" }] } },
	];
	const first = buildBtwParentSnapshot(branch);
	expect(first.cursor).toBe("3");
	expect(first.context).toContain("older context");
	expect(first.context).toContain("latest answer");
	expect(first.context).not.toContain("private tool output");
	const next = buildBtwParentSnapshot(
		[
			...branch,
			{ id: "4", type: "message", message: { role: "user", content: "new question" } },
			{
				id: "5",
				type: "message",
				message: { role: "user", content: buildBtwInjection({ question: "q", answer: "a" }) },
			},
		],
		first.cursor,
	);
	expect(next.context).toContain("new question");
	expect(next.context).not.toContain("older context");
	expect(next.context).not.toContain("[BTW side conversation]");
	expect(next.cursor).toBe("5");
	const compacted = buildBtwParentSnapshot([
		{ id: "1", type: "message", message: { role: "user", content: "superseded" } },
		{ id: "2", type: "compaction", summary: "current summary" },
		{ id: "3", type: "message", message: { role: "user", content: "after compaction" } },
	]);
	expect(compacted.context).toContain("current summary");
	expect(compacted.context).toContain("after compaction");
	expect(compacted.context).not.toContain("superseded");
	expect(
		buildBtwParentSnapshot([{ type: "message", message: { role: "user", content: "x".repeat(20_000) } }]).context
			.length,
	).toBeLessThanOrEqual(12_000);
});

it("displays questions without envelopes and injects only the latest completed exchange", () => {
	const prompt = buildBtwPrompt("Literal <btw-question>decoy</btw-question>", "Actual question");
	expect(formatBtwUserMessage(prompt)).toBe("Actual question");
	expect(formatBtwUserMessage(buildBtwPrompt("", "/fast is literal question text"))).toBe(
		"/fast is literal question text",
	);
	const exchange = getLatestBtwExchange([
		{ role: "user", content: prompt },
		{ role: "assistant", content: [{ type: "text", text: "Previous answer" }], stopReason: "stop" },
		{ role: "user", content: "Follow up" },
		{ role: "assistant", content: [{ type: "text", text: "Latest answer" }], stopReason: "stop" },
		{ role: "user", content: "Next" },
		{ role: "assistant", content: [{ type: "text", text: "Still writing" }], stopReason: "pending" },
	]);
	expect(exchange).toEqual({ question: "Follow up", answer: "Latest answer" });
	expect(buildBtwInjection(exchange!)).not.toContain("Previous answer");
});
