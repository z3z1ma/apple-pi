import { describe, it, expect } from "bun:test";
import { searchEntries } from "../src/core/search-entries.js";
import type { RenderedEntry } from "../src/core/render-entries.js";
import type { Message } from "@earendil-works/pi-ai";

const entries: RenderedEntry[] = [
	{ index: 0, role: "user", summary: "Fix login bug" },
	{ index: 1, role: "assistant", summary: "Reading auth.ts" },
	{ index: 2, role: "tool_result", summary: "[Read] code here" },
	{ index: 3, role: "assistant", summary: "Found the root cause in auth module" },
];

const messages: Message[] = [
	{ role: "user", content: "Fix login bug" } as any,
	{ role: "assistant", content: [{ type: "text", text: "Reading auth.ts" }] } as any,
	{ role: "toolResult", content: [{ type: "text", text: "[Read] code here" }] } as any,
	{ role: "assistant", content: [{ type: "text", text: "Found the root cause in auth module" }] } as any,
];

describe("searchEntries", () => {
	it("returns all for empty query", () => {
		expect(searchEntries(entries, messages)).toEqual(entries);
		expect(searchEntries(entries, messages, "")).toEqual(entries);
	});

	it("filters by single term", () => {
		const r = searchEntries(entries, messages, "login");
		expect(r).toHaveLength(1);
		expect(r[0].index).toBe(0);
	});

	it("returns empty for no match", () => {
		expect(searchEntries(entries, messages, "xyz123")).toEqual([]);
	});

	it("finds keyword beyond clip boundary in full content", () => {
		const longText = `${"A".repeat(400)} hidden_keyword here`;
		const longEntries: RenderedEntry[] = [{ index: 0, role: "user", summary: "A".repeat(300) }];
		const longMsgs: Message[] = [{ role: "user", content: longText } as any];
		const r = searchEntries(longEntries, longMsgs, "hidden_keyword");
		expect(r).toHaveLength(1);
		expect(r[0].snippet).toContain("hidden_keyword");
	});

	it("returns snippet around matched term", () => {
		const r = searchEntries(entries, messages, "root");
		expect(r).toHaveLength(1);
		expect(r[0].snippet).toBeDefined();
		expect(r[0].snippet).toContain("root");
	});

	// ── regex support ──

	it("supports regex pattern: alternation", () => {
		const r = searchEntries(entries, messages, "login|auth");
		expect(r).toHaveLength(3); // "login bug", "auth.ts", "auth module"
		expect(r.map((h) => h.index).sort()).toEqual([0, 1, 3]);
	});

	it("supports regex pattern: wildcard", () => {
		const r = searchEntries(entries, messages, "Read.*auth");
		expect(r).toHaveLength(1);
		expect(r[0].index).toBe(1);
	});

	it("falls back to escaped literal for invalid regex", () => {
		const extraEntries: RenderedEntry[] = [
			{ index: 0, role: "user", summary: "test (foo" },
			{ index: 1, role: "assistant", summary: "no match here" },
		];
		const extraMsgs: Message[] = [
			{ role: "user", content: "error with (foo pattern" } as any,
			{ role: "assistant", content: [{ type: "text", text: "no match here" }] } as any,
		];
		const r = searchEntries(extraEntries, extraMsgs, "(foo");
		expect(r).toHaveLength(1);
		expect(r[0].index).toBe(0);
	});

	it("regex is case-insensitive", () => {
		const r = searchEntries(entries, messages, "FIX|ROOT");
		expect(r).toHaveLength(2);
	});

	// ── natural language queries (OR logic + ranking) ──

	it("natural language query uses OR logic with multi-term minimum", () => {
		// "root cause auth" -- 3 meaningful terms → requires ≥2 matches
		// #3 has all 3 (root, cause, auth); #1 has only auth (1 term, below threshold)
		const r = searchEntries(entries, messages, "root cause auth");
		expect(r.length).toBe(1);
		expect(r[0].index).toBe(3); // "Found the root cause in auth module" matches all 3
	});

	it("2-term OR query matches on single term (no multi-term floor)", () => {
		// 2 meaningful terms → no floor, matches entries with ANY term
		const r = searchEntries(entries, messages, "login auth");
		expect(r.length).toBeGreaterThanOrEqual(2); // #0 has login, #1 + #3 have auth
	});

	it("natural language ranks by BM25 score", () => {
		const r = searchEntries(entries, messages, "root cause auth");
		// Top result has more terms matched = higher BM25 score
		expect(r[0].matchCount!).toBeGreaterThanOrEqual(r[r.length - 1].matchCount!);
	});

	it("filters stopwords from queries", () => {
		// "the root cause of it" → stopwords: the, of, it → meaningful: root, cause
		const r = searchEntries(entries, messages, "the root cause of it");
		expect(r).toHaveLength(1);
		expect(r[0].index).toBe(3);
	});

	it("keeps all terms if all are stopwords", () => {
		// When all terms are stopwords, keep them (don't drop everything)
		// "the" appears in "Found the root cause" so it matches
		const r = searchEntries(entries, messages, "the");
		expect(r.length).toBeGreaterThan(0);
	});

	// ── line-based snippet ──

	it("snippet shows context lines around match", () => {
		const multiline = "line 0\nline 1\nline 2 TARGET\nline 3\nline 4\nline 5";
		const e: RenderedEntry[] = [{ index: 0, role: "user", summary: "test" }];
		const m: Message[] = [{ role: "user", content: multiline } as any];
		const r = searchEntries(e, m, "TARGET");
		expect(r).toHaveLength(1);
		const snip = r[0].snippet!;
		expect(snip).toContain("line 2 TARGET");
		expect(snip).toContain("line 0");
		expect(snip).toContain("line 4");
		expect(snip).not.toContain("line 5");
	});

	it("snippet handles match at beginning", () => {
		const multiline = "TARGET here\nline 1\nline 2\nline 3";
		const e: RenderedEntry[] = [{ index: 0, role: "user", summary: "test" }];
		const m: Message[] = [{ role: "user", content: multiline } as any];
		const r = searchEntries(e, m, "TARGET");
		const snip = r[0].snippet!;
		expect(snip).toContain("TARGET here");
		expect(snip).toContain("line 2");
		expect(snip).not.toContain("line 3");
	});

	// ── thinking content searchability ──

	it("finds terms in thinking content", () => {
		const e: RenderedEntry[] = [
			{ index: 0, role: "user", summary: "Fix the parser" },
			{ index: 1, role: "assistant", summary: "Looking at parser" },
		];
		const m: Message[] = [
			{ role: "user", content: "Fix the parser" } as any,
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "The race condition is in the event emitter" },
					{ type: "text", text: "Looking at parser" },
				],
			} as any,
		];
		const r = searchEntries(e, m, "race condition");
		expect(r).toHaveLength(1);
		expect(r[0].index).toBe(1);
		expect(r[0].snippet).toContain("race condition");
	});

	// ── toolCall argument searchability (bash command, edit text) ──

	it("finds terms in a bash toolCall's arguments.command", () => {
		const e: RenderedEntry[] = [
			{ index: 0, role: "user", summary: "set up env" },
			{ index: 1, role: "assistant", summary: "bash command=DEV_API_KEY grep" },
		];
		const m: Message[] = [
			{ role: "user", content: "set up env" } as any,
			{
				role: "assistant",
				content: [
					{ type: "text", text: "let me grep for the key" },
					{
						type: "toolCall",
						name: "bash",
						id: "tc_1",
						arguments: { command: "DEV_API_KEY=$(grep DEV_API_KEY .dev.vars) curl -X POST https://api.test" },
					},
				],
			} as any,
		];
		// Query has no regex metacharacters, so it takes the BM25 term path
		// (the .dev.vars dots would otherwise make the whole query a single
		// contiguous regex — a separate query-parsing concern).
		const r = searchEntries(e, m, "DEV_API_KEY grep curl");
		expect(r).toHaveLength(1);
		expect(r[0].index).toBe(1);
		expect(r[0].snippet).toContain("DEV_API_KEY");
	});

	it("finds terms in a non-bash toolCall's string args (edit newText)", () => {
		const e: RenderedEntry[] = [{ index: 0, role: "assistant", summary: "edit" }];
		const m: Message[] = [
			{
				role: "assistant",
				content: [
					{ type: "text", text: "applying the fix" },
					{
						type: "toolCall",
						name: "edit",
						id: "tc_1",
						arguments: { path: "a.ts", oldText: "oldToken", newText: "freshToken" },
					},
				],
			} as any,
		];
		const r = searchEntries(e, m, "freshToken");
		expect(r).toHaveLength(1);
		expect(r[0].snippet).toContain("freshToken");
	});

	it("mode:file searches write/edit payloads but excludes transcript and read paths", () => {
		const fileEntries: RenderedEntry[] = [
			{ index: 0, role: "assistant", summary: "secret in transcript", files: ["secret.txt"] },
			{ index: 1, role: "assistant", summary: "write", files: ["output.txt"] },
		];
		const fileMessages: Message[] = [
			{
				role: "assistant",
				content: [
					{ type: "text", text: "secret in transcript" },
					{ type: "toolCall", name: "read", id: "read", arguments: { path: "secret.txt" } },
				],
			} as any,
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						name: "write",
						id: "write",
						arguments: { path: "output.txt", content: "payload needle" },
					},
				],
			} as any,
		];
		expect(searchEntries(fileEntries, fileMessages, "secret", "file")).toEqual([]);
		expect(searchEntries(fileEntries, fileMessages, "assistant", "file")).toEqual([]);
		const result = searchEntries(fileEntries, fileMessages, "needle", "file");
		expect(result).toHaveLength(1);
		expect(result[0].fileMatches?.[0]).toMatchObject({ path: "output.txt", toolName: "write" });
	});

	it("does not match on toolCall args that are absent (regression guard)", () => {
		const e: RenderedEntry[] = [{ index: 0, role: "assistant", summary: "reading" }];
		const m: Message[] = [
			{
				role: "assistant",
				content: [
					{ type: "text", text: "looking around" },
					{ type: "toolCall", name: "read", id: "tc_1", arguments: { path: "a.ts" } },
				],
			} as any,
		];
		expect(searchEntries(e, m, "DEV_API_KEY")).toEqual([]);
	});

	// ── search result grounding (prevents "half the session" returns) ──

	it("filters low-relevance BM25 hits by score ratio threshold", () => {
		// Build a session where one entry is highly relevant and many are barely relevant
		const govEntries: RenderedEntry[] = [
			{ index: 0, role: "user", summary: "Review the policy document" },
			{ index: 1, role: "assistant", summary: "I found the policy document. It covers the review process." },
			{ index: 2, role: "user", summary: "Check the deployment pipeline" },
			{ index: 3, role: "assistant", summary: "The pipeline has a step for document generation" }, // weak match
			{ index: 4, role: "user", summary: "Fix the login bug" },
			{ index: 5, role: "assistant", summary: "Updated the document in README" }, // very weak
		];
		const govMsgs: Message[] = [
			{ role: "user", content: "Review the policy document" } as any,
			{
				role: "assistant",
				content: [{ type: "text", text: "I found the policy document. It covers the review process." }],
			} as any,
			{ role: "user", content: "Check the deployment pipeline" } as any,
			{
				role: "assistant",
				content: [{ type: "text", text: "The pipeline has a step for document generation" }],
			} as any,
			{ role: "user", content: "Fix the login bug" } as any,
			{ role: "assistant", content: [{ type: "text", text: "Updated the document in README" }] } as any,
		];
		// 2-term query: policy + review → no multi-term floor
		// Should return both strong matches but may filter very weak ones
		const r = searchEntries(govEntries, govMsgs, "policy review");
		// #0 and #1 are strong matches; #3 and #5 only have "document" which isn't queried
		expect(r.length).toBeLessThanOrEqual(2);
		expect(r[0].index).toBe(0); // highest BM25: matches both terms
	});

	it("requires 2+ term matches for 3+ term queries", () => {
		// Simulates a government session with common domain vocabulary
		const govEntries: RenderedEntry[] = [
			{ index: 0, role: "user", summary: "Review the policy document" },
			{ index: 1, role: "assistant", summary: "Checking policy" }, // only 1/3 terms
			{ index: 2, role: "user", summary: "Fix login bug" }, // 0/3 terms
			{ index: 3, role: "assistant", summary: "Review policy and update document" }, // 2/3 terms
		];
		const govMsgs: Message[] = [
			{ role: "user", content: "Review the policy document" } as any,
			{ role: "assistant", content: [{ type: "text", text: "Checking policy" }] } as any,
			{ role: "user", content: "Fix login bug" } as any,
			{ role: "assistant", content: [{ type: "text", text: "Review policy and update document" }] } as any,
		];
		// "review policy document" = 3 terms → requires ≥2 matches
		// #0 matches all 3, #1 matches only "policy" (1 term → filtered), #3 matches "review" + "document" (2 terms → kept)
		const r = searchEntries(govEntries, govMsgs, "review policy document");
		expect(r.length).toBe(2);
		const indices = r.map((h) => h.index).sort();
		expect(indices).toContain(0);
		expect(indices).toContain(3);
	});

	it("hard caps regex search results", () => {
		// Build many entries that all match the same regex
		const manyEntries: RenderedEntry[] = Array.from({ length: 100 }, (_, i) => ({
			index: i,
			role: "user" as const,
			summary: `document ${i} review`,
		}));
		const manyMsgs: Message[] = Array.from(
			{ length: 100 },
			(_, i) =>
				({
					role: "user" as const,
					content: `document ${i} review`,
				}) as any,
		);
		const r = searchEntries(manyEntries, manyMsgs, "document.*review");
		expect(r.length).toBeLessThanOrEqual(50); // MAX_SEARCH_RESULTS
	});
});
