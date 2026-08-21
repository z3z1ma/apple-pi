import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { expandEntryFile, expandToolCall, parseCallQuery, parseDrillDown } from "../src/drill-down.js";
import { getTouchedFiles } from "../src/search-entries.js";
import { registerRecallTool } from "../src/tool.js";

const writeMessage = {
	role: "assistant",
	content: [
		{
			type: "toolCall",
			id: "write-1",
			name: "write",
			arguments: {
				path: "src/auth.ts",
				content: Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join("\n"),
			},
		},
	],
} as any;

describe("file recall", () => {
	it("parses and pages #N:path drill-down requests", () => {
		expect(parseDrillDown("#42:src/auth.ts:30:5")).toEqual({
			index: 42,
			pathPattern: "src/auth.ts",
			full: false,
			offset: 30,
			limit: 5,
		});
		const output = expandEntryFile(
			[{ index: 42, role: "assistant", summary: "write" }],
			[writeMessage],
			parseDrillDown("#42:auth.ts:30:5")!,
		);
		expect(output).toContain("Lines 31-35");
		expect(output).toContain("line 31");
		expect(output).not.toContain("line 36");
	});

	it("aggregates direct and pi_exec nested writes in mode:touched data", () => {
		const nested = {
			role: "toolResult",
			toolName: "pi_exec",
			content: [{ type: "text", text: "done" }],
			details: {
				trace: {
					kind: "apple-pi.execution",
					version: 1,
					operations: [
						{
							ref: "agents.run",
							args: { task: "update auth" },
							outcome: "succeeded",
							children: [
								{
									ref: "pi.edit",
									args: { path: "src/auth.ts", oldText: "old", newText: "new" },
									outcome: "succeeded",
								},
							],
						},
					],
				},
			},
		} as any;
		const rendered = [
			{ index: 4, role: "assistant", summary: "write" },
			{ index: 9, role: "tool_result", summary: "exec" },
		];
		expect(getTouchedFiles([writeMessage, nested], rendered)).toEqual([
			{
				path: "src/auth.ts",
				entries: [
					{ index: 4, toolName: "write" },
					{ index: 9, toolName: "edit" },
				],
			},
		]);
		const nestedPayload = expandEntryFile(rendered, [writeMessage, nested], parseDrillDown("#9:auth.ts")!);
		expect(nestedPayload).toContain("old");
		expect(nestedPayload).toContain("new");
	});

	it("resolves call:<id> to the persisted tool-result body", async () => {
		expect(parseCallQuery("call: read-1")).toBe("read-1");
		expect(parseCallQuery("#0:src/auth.ts")).toBeUndefined();
		const readResult = {
			role: "toolResult",
			toolCallId: "read-1",
			toolName: "read",
			content: [{ type: "text", text: "SECRET_LINE\nsecond" }],
			isError: false,
		} as any;
		expect(expandToolCall([readResult], "read-1")).toContain("SECRET_LINE");
		expect(expandToolCall([readResult], "missing")).toContain("No primary tool result");

		const dir = mkdtempSync(join(tmpdir(), "session-search-call-recall-"));
		const file = join(dir, "session.jsonl");
		try {
			writeFileSync(file, `${JSON.stringify({ type: "message", id: "m2", message: readResult })}\n`, "utf8");
			let tool: any;
			registerRecallTool({
				registerTool(value: any) {
					tool = value;
				},
			} as any);
			const ctx = {
				sessionManager: {
					getSessionFile: () => file,
					getBranch: () => [{ id: "m2" }],
				},
			};
			const recovered = await tool.execute("call", { query: "call:read-1" }, undefined, undefined, ctx);
			expect(recovered.content[0].text).toContain("SECRET_LINE");
			expect(recovered.content[0].text).toContain("call: read-1");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("exposes mode:touched and #N:path through session_search", async () => {
		const dir = mkdtempSync(join(tmpdir(), "session-search-file-recall-"));
		const file = join(dir, "session.jsonl");
		try {
			writeFileSync(file, `${JSON.stringify({ type: "message", id: "m1", message: writeMessage })}\n`, "utf8");
			let tool: any;
			registerRecallTool({
				registerTool(value: any) {
					tool = value;
				},
			} as any);
			const ctx = {
				sessionManager: {
					getSessionFile: () => file,
					getBranch: () => [{ id: "m1" }],
				},
			};
			const touched = await tool.execute("touched", { mode: "touched" }, undefined, undefined, ctx);
			expect(touched.content[0].text).toContain("src/auth.ts");
			expect(touched.content[0].text).toContain("#0 (write)");

			const drill = await tool.execute("drill", { query: "#0:auth.ts" }, undefined, undefined, ctx);
			expect(drill.content[0].text).toContain("line 1");
			expect(drill.content[0].text).not.toContain("line 31");
			expect(drill.content[0].text).toContain("#0:src/auth.ts:30:30");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
