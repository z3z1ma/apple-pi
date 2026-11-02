import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { sessionSearchTool } from "../src/tool.js";

const search = async (messages: Message[], query: string): Promise<string> => {
	const dir = mkdtempSync(join(tmpdir(), "evidence-recall-"));
	const file = join(dir, "session.jsonl");
	const entries = messages.map((message, index) => ({ type: "message", id: `evidence-${index}`, message }));
	writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join("\n"));
	try {
		const result = await sessionSearchTool.execute("current-search", { query }, undefined, undefined, {
			sessionManager: { getSessionFile: () => file, getBranch: () => entries },
		} as any);
		return (result.content[0] as any).text;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
};

describe("answer-bearing evidence windows", () => {
	it("shows the decision passage rather than an earlier weak match", async () => {
		const message = {
			role: "assistant",
			content: [
				{
					type: "text",
					text: [
						"alpha mentioned in passing",
						...Array(12).fill("filler"),
						"alpha beta gamma: the actual decision",
						"Keep the owner stable.",
					].join("\n"),
				},
			],
		} as any;
		const output = await search([message], "alpha beta gamma");
		expect(output).toContain("Read source: entry:evidence-0");
		expect(output).toContain("Keep the owner stable.");
		expect(output).not.toContain("alpha mentioned in passing");
	});

	it("labels thinking, attempted calls and failed results rather than presenting them as successful facts", async () => {
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "hypothesisneedle unproven" },
					{
						type: "toolCall",
						id: "attempt",
						name: "write",
						arguments: { path: "a.ts", content: "payloadneedle durable change" },
					},
				],
			} as any,
			{
				role: "toolResult",
				toolCallId: "attempt",
				toolName: "write",
				isError: true,
				content: [{ type: "text", text: "failuretarget permission denied" }],
			} as any,
		];
		const thinking = await search(messages, "hypothesisneedle");
		expect(thinking).toContain("[thinking]");
		expect(thinking).toContain("hypothesisneedle unproven");
		const attempted = await search(messages, "payloadneedle");
		expect(attempted).toContain("[attempted write call:attempt]");
		expect(attempted).toContain("payloadneedle durable change");
		const failed = await search(messages, "failuretarget");
		expect(failed).toContain("[failed write call:attempt]");
		expect(failed).toContain("failuretarget permission denied");
	});

	it("shows original evidence before repeated recall output with both source addresses", async () => {
		const messages: Message[] = [
			{
				role: "toolResult",
				toolName: "search_session",
				toolCallId: "recall",
				content: [{ type: "text", text: "needle needle needle" }],
			} as any,
			{ role: "user", content: "needle: the original decision was to retain the owner" } as any,
		];
		const output = await search(messages, "needle");
		const addresses = [...output.matchAll(/Read source: entry:(evidence-\d+)/g)].map((match) => match[1]);
		expect(addresses).toEqual(["evidence-1", "evidence-0"]);
	});
});
