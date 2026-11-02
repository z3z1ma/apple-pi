import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let root = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(root, "package.json"))) {
	const p = dirname(root);
	if (p === root) throw new Error("Repository root not found");
	root = p;
}
const { sessionSearchTool } = await import(pathToFileURL(join(root, "components/session-search/src/tool.ts")));
const { searchEntries } = await import(pathToFileURL(join(root, "components/session-search/src/search-entries.ts")));
const { renderMessage } = await import(pathToFileURL(join(root, "components/session-search/src/render-entries.ts")));
const message = (id, text) => ({
	type: "message",
	id,
	parentId: null,
	message: { role: "user", content: [{ type: "text", text }] },
});
const dir = mkdtempSync(join(tmpdir(), "kofi-recall-contract-"));
try {
	const entries = [
		message("a", "alpha.ts"),
		message("b", "alphaXts"),
		{ type: "custom_message", id: "c", parentId: "b", customType: "mail", content: "mailneedle", display: true },
		{ type: "compaction", id: "d", parentId: "c", summary: "summaryneedle", firstKeptEntryId: "a" },
		{
			type: "message",
			id: "e",
			parentId: "d",
			message: {
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "edit1",
						name: "edit",
						arguments: { path: "fixture.txt", edits: [{ oldText: "priorneedle", newText: "editneedle" }] },
					},
				],
			},
		},
	];
	const path = join(dir, "fixture.jsonl");
	writeFileSync(path, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
	const ctx = { sessionManager: { getSessionFile: () => path, getBranch: () => entries, getEntries: () => entries } };
	const run = async (p) =>
		(await sessionSearchTool.execute("contract", p, undefined, undefined, ctx)).content
			.map((p) => p.text ?? "")
			.join("");
	const zero = await run({ expand: [0] });
	assert.match(zero, /Invalid expand/);
	assert.match(await run({ query: "mailneedle" }), /No matches/);
	assert.match(await run({ query: "summaryneedle" }), /No matches/);
	assert.match(await run({ query: "editneedle" }), /No matches/);
	assert.doesNotMatch(await run({ query: "editneedle", mode: "file" }), /No matches/);
	const messages = entries.filter((e) => e.type === "message").map((e) => e.message);
	const rendered = messages.map((m, i) => renderMessage(m, i));
	assert.equal(searchEntries(rendered, messages, "alpha.ts").length, 2);
	const old = Array.from({ length: 60 }, (_, i) => ({
		role: "user",
		content: [{ type: "text", text: `artifact.ts occurrence ${i}` }],
	}));
	assert.deepEqual(
		searchEntries(
			old.map((m, i) => renderMessage(m, i)),
			old,
			"artifact.ts",
		).map((h) => h.index),
		Array.from({ length: 50 }, (_, i) => i),
	);
	console.log(
		JSON.stringify(
			{
				checks: 7,
				observed: {
					expandZeroRejected: true,
					customMailAbsent: true,
					compactionSummaryAbsent: true,
					historyArrayEditsAbsent: true,
					fileModeArrayEditsPresent: true,
					dotTreatedAsWildcard: true,
					regexReturnsEarliest50: true,
				},
			},
			null,
			2,
		),
	);
} finally {
	rmSync(dir, { recursive: true, force: true });
}
