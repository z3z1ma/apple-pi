import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { invalidExpandIndices, registerRecallTool } from "../src/tool.js";

describe("invalidExpandIndices", () => {
	it("returns indices that are not in available lineage index set", () => {
		const available = new Set([0, 2, 5]);
		expect(invalidExpandIndices([0, 2], available)).toEqual([]);
		expect(invalidExpandIndices([1, 2, 7], available)).toEqual([1, 7]);
	});

	it("rejects non-integer indices", () => {
		const available = new Set([0, 1, 2]);
		expect(invalidExpandIndices([1.5, 2], available)).toEqual([1.5]);
	});
});

const register = () => {
	let tool: any;
	(registerRecallTool as any)({
		registerTool: (t: any) => {
			tool = t;
		},
	});
	return tool;
};

const invoke = async (tool: any, file: string, params: Record<string, unknown>) => {
	const result = await tool.execute("tool-call", params, undefined, undefined, {
		sessionManager: {
			getSessionFile: () => file,
			getBranch: () => [{ id: "m1" }],
			getEntries: () => [{ id: "m1" }],
		},
	});
	return result.content[0].text as string;
};

// Build a multi-line user message whose match is on line 0 and whose
// PAIR_FULL_MARKER sits on line 4. The lineSnippet window used by
// searchEntries returns only ±2 lines around the match (lines 0–2), so
// the pair is excluded from the truncated snippet — but
// renderMessage(full=true) includes every line. That contrast is what
// lets us prove expand actually swapped in full content.
const buildContent = () =>
	[
		"SEARCHTOKEN alpha match here",
		"filler line one",
		"filler line two",
		"filler line three",
		"PAIR_FULL_MARKER deep in the content",
		"filler line five",
		"filler line six",
		"filler line seven",
	].join("\n");

const makeSession = () => {
	const dir = mkdtempSync(join(tmpdir(), "session-search-recall-expand-"));
	const file = join(dir, "session.jsonl");
	writeFileSync(
		file,
		`${JSON.stringify({ type: "message", id: "m1", message: { role: "user", content: buildContent() } })}\n`,
		"utf8",
	);
	return { dir, file };
};

describe("search_session expand + query composition", () => {
	it("expands matched entries to full content when query and expand are combined", async () => {
		const { dir, file } = makeSession();
		try {
			const tool = register();

			// Baseline: query alone — the ±2 line snippet excludes the pair.
			const baseline = await invoke(tool, file, { query: "SEARCHTOKEN" });
			expect(baseline).toContain("1 matches");
			expect(baseline).not.toContain("PAIR_FULL_MARKER");

			// Composed: expand the matching index → full content surfaces the pair.
			const composed = await invoke(tool, file, { query: "SEARCHTOKEN", expand: [0] });
			expect(baseline).not.toContain("expanded");
			expect(composed).toContain("PAIR_FULL_MARKER");
			expect(composed).toContain("expanded 1 entry to full content");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("signals when requested expand indices are not present on the page (no silent drop)", async () => {
		const { dir, file } = makeSession();
		try {
			const tool = register();
			const out = await invoke(tool, file, { query: "SEARCHTOKEN", expand: [42] });
			expect(out).toContain("no expand indices on this page: 42");
			expect(out).not.toContain("PAIR_FULL_MARKER");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
