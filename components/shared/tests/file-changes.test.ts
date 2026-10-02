import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFileChangeTracker, formatFileChanges } from "../src/file-changes.js";

const patch = (path: string, body: string) => `Index: ${path}\n===\n--- ${path}\n+++ ${path}\n@@ -1,3 +1,3 @@\n${body}`;

function run(
	tracker: ReturnType<typeof createFileChangeTracker>,
	id: string,
	toolName: string,
	args: object,
	end: object,
) {
	tracker.observe({ type: "tool_execution_start", toolCallId: id, toolName, args });
	tracker.observe({ type: "tool_execution_end", toolCallId: id, toolName, isError: false, ...end });
}

describe("file change tracker", () => {
	it("summarizes edit deltas, write sizes, creation, and failures per file", () => {
		const cwd = mkdtempSync(join(tmpdir(), "file-changes-"));
		writeFileSync(join(cwd, "old.md"), "old\n");
		const tracker = createFileChangeTracker(cwd);

		run(tracker, "1", "edit", { path: "src/a.ts" }, { result: { details: { patch: patch("a", " x\n-y\n+z\n+w\n") } } });
		run(tracker, "2", "edit", { path: join(cwd, "src/a.ts") }, { result: { details: { patch: patch("a", "-q\n") } } });
		run(tracker, "3", "write", { path: "new.md", content: "one\ntwo\n" }, { result: {} });
		run(tracker, "4", "write", { path: "old.md", content: "a\nb\nc" }, { result: {} });
		run(tracker, "5", "edit", { path: "bad.ts" }, { isError: true, result: {} });
		run(tracker, "6", "read", { path: "src/a.ts" }, { result: {} });

		expect(tracker.changes()).toEqual([
			{ path: "src/a.ts", edits: 2, added: 2, removed: 2, writes: 0, writtenLines: 0, created: false, failed: 0 },
			{ path: "new.md", edits: 0, added: 0, removed: 0, writes: 1, writtenLines: 2, created: true, failed: 0 },
			{ path: "old.md", edits: 0, added: 0, removed: 0, writes: 1, writtenLines: 3, created: false, failed: 0 },
			{ path: "bad.ts", edits: 0, added: 0, removed: 0, writes: 0, writtenLines: 0, created: false, failed: 1 },
		]);
		expect(formatFileChanges(tracker.changes())).toBe(
			[
				"Files touched via edit/write:",
				"- src/a.ts: edit +2 -2 (2 calls)",
				"- new.md: write 2 lines (created)",
				"- old.md: write 3 lines (overwrote)",
				"- bad.ts: 1 failed call",
			].join("\n"),
		);

		tracker.reset();
		expect(tracker.changes()).toEqual([]);
		expect(formatFileChanges(tracker.changes())).toBe("");
	});

	it("shows paths outside the display root as absolute", () => {
		const cwd = mkdtempSync(join(tmpdir(), "file-changes-"));
		const tracker = createFileChangeTracker(join(cwd, "work"), join(cwd, "root"));
		run(tracker, "1", "write", { path: "x.txt", content: "" }, { result: {} });
		run(tracker, "2", "write", { path: "../root/y.txt", content: "y" }, { result: {} });
		expect(tracker.changes().map((change) => change.path)).toEqual([join(cwd, "work", "x.txt"), "y.txt"]);
		expect(tracker.changes()[0]?.writtenLines).toBe(0);
	});
});
