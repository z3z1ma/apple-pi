import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAllMessages } from "../src/load-messages.js";
import { sessionSearchTool } from "../src/tool.js";

const records = [
	{ type: "message", id: "first", message: { role: "user", content: "original zero" } },
	{ type: "custom_message", id: "mail", customType: "mailbox", content: "dispatchneedle received", display: false },
	{ type: "compaction", id: "compact", summary: "summaryneedle retained", firstKeptEntryId: "first" },
	{ type: "branch_summary", id: "branch", summary: "branchneedle recalled", fromId: "first" },
	{ type: "custom", id: "state", customType: "private-state", data: { content: "unsearchablestate" } },
	{
		type: "custom",
		id: "notes",
		customType: "notebook.reflections.recorded",
		data: {
			reflections: [
				{
					id: "abcdef123456",
					content: "learningneedle lesson",
					sourceEntryIds: ["first"],
					supportingObservationIds: [],
				},
			],
		},
	},
	{
		type: "message",
		id: "edit",
		message: {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "edit-call",
					name: "edit",
					arguments: { path: "a.ts", edits: [{ oldText: "before", newText: "arrayneedle after" }] },
				},
			],
		},
	},
	{ type: "custom_message", id: "offbranch", customType: "mailbox", content: "offbranchneedle", display: true },
].map((entry) => ({ ...entry, timestamp: "2026-11-02T08:00:00Z" }));

const withSession = async (run: (file: string, invoke: (params: any) => Promise<string>) => Promise<void>) => {
	const dir = mkdtempSync(join(tmpdir(), "source-recall-"));
	const file = join(dir, "session.jsonl");
	writeFileSync(file, records.map((entry) => JSON.stringify(entry)).join("\n"));
	const invoke = async (params: any) => {
		const result = await sessionSearchTool.execute("search-call", params, undefined, undefined, {
			sessionManager: {
				getSessionFile: () => file,
				getBranch: () => records.filter((entry) => entry.id !== "offbranch"),
			},
		} as any);
		return (result.content[0] as any).text as string;
	};
	try {
		await run(file, invoke);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
};

describe("source-complete personal recall", () => {
	it("discovers visible custom records, summaries, notebook text and array edit bodies without renumbering messages", async () => {
		await withSession(async (file, invoke) => {
			for (const [term, id, kind] of [
				["dispatchneedle", "mail", "custom_message"],
				["summaryneedle", "compact", "compaction"],
				["branchneedle", "branch", "branch_summary"],
				["learningneedle", "notes", "notebook"],
			]) {
				const output = await invoke({ query: term });
				expect(output).toContain(`entry:${id}`);
				expect(output).toContain(kind);
				expect(output).toContain("2026-11-02");
			}
			expect(await invoke({ query: "arrayneedle" })).toContain("#1");
			expect(await invoke({ query: "unsearchablestate" })).toContain("No matches");
			const loaded = loadAllMessages(file, false);
			expect(loaded.rendered.filter((entry) => entry.index !== undefined).map((entry) => entry.index)).toEqual([0, 1]);
			expect(await invoke({ expand: [0] })).toContain("original zero");
			expect(await invoke({ query: "#1:a.ts:full" })).toContain("arrayneedle after");
		});
	});

	it("expands stable source IDs with continuation and preserves lineage scope", async () => {
		await withSession(async (_file, invoke) => {
			expect(await invoke({ query: "entry:mail" })).toContain("dispatchneedle received");
			const notebook = await invoke({ query: "entry:notes" });
			expect(notebook).toContain("abcdef123456");
			expect(notebook).toContain("entry:first");
			expect(await invoke({ query: "entry:offbranch" })).toContain("not available");
			expect(await invoke({ query: "entry:offbranch", scope: "all" })).toContain("offbranchneedle");
			expect(await invoke({ query: "offbranchneedle", scope: "all" })).toContain("off-lineage");
		});
	});
});
