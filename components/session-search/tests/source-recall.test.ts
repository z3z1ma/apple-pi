import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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

const withSession = async (
	run: (file: string, invoke: (params: any) => Promise<string>) => Promise<void>,
	entries: any[] = records,
) => {
	const dir = mkdtempSync(join(tmpdir(), "source-recall-"));
	const file = join(dir, "session.jsonl");
	writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join("\n"));
	const invoke = async (params: any) => {
		const result = await sessionSearchTool.execute("search-call", params, undefined, undefined, {
			sessionManager: {
				getSessionFile: () => file,
				getBranch: () => entries.filter((entry) => entry.id !== "offbranch"),
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
	it("keeps matches from different conversation turns in separate displayed segments", async () => {
		const entries = [
			{ type: "message", id: "first-question", parentId: null, message: { role: "user", content: "First topic" } },
			{
				type: "message",
				id: "first-answer",
				parentId: "first-question",
				message: { role: "assistant", content: [{ type: "text", text: "needle in the first conversation" }] },
			},
			{
				type: "message",
				id: "second-question",
				parentId: "first-answer",
				message: { role: "user", content: "Second topic" },
			},
			{
				type: "message",
				id: "second-answer",
				parentId: "second-question",
				message: { role: "assistant", content: [{ type: "text", text: "needle needle in the second conversation" }] },
			},
		];
		await withSession(async (_file, invoke) => {
			const output = await invoke({ query: "needle" });
			expect(output).toContain("2 matches across 2 segments");
			const segments = output.split(/^--- /m).filter((segment) => segment.includes("Read source:"));
			expect(segments).toHaveLength(2);
			for (const [answer, question] of [
				["first-answer", "first-question"],
				["second-answer", "second-question"],
			]) {
				const segment = segments.find((part) => part.includes(`Read source: entry:${answer}`));
				expect(segment).toContain(`preceding input entry:${question}`);
			}
		}, entries);
	});

	it("follows discovered saved-program evidence through entry and numeric recovery", async () => {
		const entries = [
			{
				type: "message",
				id: "saved",
				message: {
					role: "toolResult",
					toolName: "program_publish",
					toolCallId: "saved-call",
					isError: false,
					content: [{ type: "text", text: "Batch finished" }],
					details: {
						trace: {
							kind: "apple-pi.execution",
							version: 1,
							operations: [
								{
									ref: "pi.send_mail",
									args: { body: "nestedargumentneedle" },
									outcome: "failed",
									error: "Delivery refused",
								},
							],
						},
					},
				},
			},
		];
		await withSession(async (_file, invoke) => {
			expect(await invoke({ query: "nestedargumentneedle" })).toContain("Read source: entry:saved");
			for (const params of [{ query: "entry:saved" }, { expand: [0] }]) {
				const recovered = await invoke(params);
				expect(recovered).toContain("nestedargumentneedle");
				expect(recovered).toContain("Delivery refused");
				expect(recovered).toContain('"outcome": "failed"');
			}
		}, entries);
	});

	it("uses issuer exclusion for touched discovery but preserves scoped exact recovery", async () => {
		const entries = [
			{
				type: "message",
				id: "prior",
				message: {
					role: "assistant",
					content: [
						{
							type: "toolCall",
							id: "prior-write",
							name: "write",
							arguments: { path: "prior.ts", content: "historical payload" },
						},
					],
				},
			},
			{
				type: "message",
				id: "issuer",
				parentId: "prior",
				message: {
					role: "assistant",
					content: [
						{ type: "toolCall", id: "search-call", name: "search_session", arguments: { mode: "touched" } },
						{
							type: "toolCall",
							id: "current-write",
							name: "write",
							arguments: { path: "current.ts", content: "currentneedle" },
						},
					],
				},
			},
		];
		await withSession(async (_file, invoke) => {
			const touched = await invoke({ mode: "touched" });
			expect(touched).toContain("prior.ts");
			expect(touched).not.toContain("current.ts");
			expect(await invoke({ query: "currentneedle" })).toContain("No matches");
			expect(await invoke({ query: "entry:issuer" })).toContain("currentneedle");
			expect(await invoke({ query: "#1:current.ts:full" })).toContain("currentneedle");
		}, entries);
	});

	it("labels notification ancestry as preceding input rather than an originating question", async () => {
		const entries = [
			{ type: "custom_message", id: "notice", content: "A prior run has finished.", customType: "notification" },
			{
				type: "message",
				id: "reply",
				parentId: "notice",
				message: { role: "assistant", content: [{ type: "text", text: "evidenceneedle is available" }] },
			},
		];
		await withSession(async (_file, invoke) => {
			const output = await invoke({ query: "evidenceneedle" });
			expect(output).toContain("preceding input entry:notice");
			expect(output).not.toContain("question entry:");
		}, entries);
	});
	it("recovers complete write/edit arguments by ID and continues long sources without losing content", async () => {
		const payload = Array.from({ length: 80 }, (_, i) => `unique payload line ${i} END`).join("\n");
		const entries = [
			{
				type: "message",
				id: "body",
				message: {
					role: "assistant",
					content: [
						{ type: "toolCall", id: "write", name: "write", arguments: { path: "a.ts", content: payload } },
						{
							type: "toolCall",
							id: "edit",
							name: "edit",
							arguments: { path: "b.ts", edits: [{ oldText: "original bytes", newText: "replacement bytes" }] },
						},
					],
				},
			},
		];
		await withSession(async (_file, invoke) => {
			const first = await invoke({ query: "entry:body:0:5" });
			expect(first).toContain("Continue with entry:body:5:5");
			const windows: string[] = [];
			const visited = new Set<string>();
			let address: string | undefined = "entry:body:0:5";
			while (address) {
				expect(visited.has(address)).toBe(false);
				visited.add(address);
				const output = await invoke({ query: address });
				windows.push(output);
				address = /Continue with (entry:body:\d+:5)/.exec(output)?.[1];
			}
			const recovered = windows.join("\n");
			for (const line of payload.split("\n")) expect(recovered).toContain(line);
			expect(recovered).toContain("original bytes");
			expect(recovered).toContain("replacement bytes");
			expect(await invoke({ query: "#0:a.ts:full" })).toContain(payload);
			expect(await invoke({ expand: [0] })).toContain("replacement bytes");
		}, entries);
	});

	it("excludes the issuing entry but keeps exact recovery, and links results to preceding input and attempted calls", async () => {
		const entries = [
			{ type: "message", id: "q", parentId: null, message: { role: "user", content: "What happened to the write?" } },
			{
				type: "message",
				id: "w",
				parentId: "q",
				message: {
					role: "assistant",
					content: [
						{ type: "toolCall", id: "write-call", name: "write", arguments: { path: "a.ts", content: "body" } },
					],
				},
			},
			{
				type: "message",
				id: "r",
				parentId: "w",
				message: {
					role: "toolResult",
					toolCallId: "write-call",
					toolName: "write",
					isError: true,
					content: [{ type: "text", text: "deniedneedle blocked" }],
				},
			},
			{
				type: "message",
				id: "issuer",
				parentId: "r",
				message: {
					role: "assistant",
					content: [
						{ type: "toolCall", id: "search-call", name: "search_session", arguments: { query: "issuerneedle" } },
					],
				},
			},
		];
		await withSession(async (_file, invoke) => {
			expect(await invoke({ query: "issuerneedle" })).toContain("No matches");
			expect(await invoke({ query: "entry:issuer" })).toContain("issuerneedle");
			const output = await invoke({ query: "deniedneedle" });
			expect(output).toContain("preceding input entry:q");
			expect(output).toContain("attempted call entry:w");
			expect(output).toContain("failed write call:write-call");
		}, entries);
	});
	it("discovers visible custom records, summaries, notebook text and array edit bodies without renumbering messages", async () => {
		await withSession(async (_file, invoke) => {
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
			const edit = await invoke({ expand: [1] });
			expect(edit).toContain("entry:edit");
			expect(edit).toContain("arrayneedle after");
			expect(await invoke({ expand: [0] })).toContain("original zero");
			expect(await invoke({ query: "#1:a.ts:full" })).toContain("arrayneedle after");
		});
	});

	it("expands stable source IDs and preserves lineage scope", async () => {
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
