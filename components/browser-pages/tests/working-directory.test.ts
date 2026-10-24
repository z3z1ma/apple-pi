import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildCodeReviewPage, type ReviewCodeParams } from "../src/code-review.js";
import { buildExplainPage, type ExplainChangeParams } from "../src/explain-change.js";
import { buildLedgerPage } from "../src/ledger-review.js";
import { buildMarkdownPage } from "../src/markdown-review.js";
import type { ExplainPart } from "../src/page-data.js";

const ID = "202610150900-retry-http";
let base: string; // a temporary directory outside any repository, holding everything below
let outer: string; // a repository with its own uncommitted change
let wt: string; // a worktree of `outer`, nested inside it, with a different uncommitted change
let outside: string; // a directory in no repository

const write = (root: string, path: string, text: string) => {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), text);
};
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();

beforeEach(() => {
	// Git reports real paths; on macOS the temporary directory sits behind a symlink.
	base = realpathSync(mkdtempSync(join(tmpdir(), "browser-pages-cwd-")));
	outer = join(base, "outer");
	wt = join(outer, "wt");
	outside = join(base, "outside");
	mkdirSync(outer);
	mkdirSync(outside);
	git(outer, "init", "-q", "-b", "main");
	git(outer, "config", "user.email", "t@example.com");
	git(outer, "config", "user.name", "T");
	write(outer, ".gitignore", "/wt/\n");
	write(outer, "src/a.ts", "export const a = 1;\n");
	write(outer, "src/b.ts", "export const b = 1;\n");
	write(outer, "docs/plan.md", "# Outer plan\n\nThe outer plan.\n");
	write(outer, `.ledger/${ID}/task.md`, "Status: ready\n\n# Outer task\n\nIntent.\n");
	git(outer, "add", ".");
	git(outer, "commit", "-q", "-m", "base");
	git(outer, "worktree", "add", "-q", "-b", "feature", wt);
	// Each checkout has a change of its own.
	write(outer, "src/a.ts", "export const a = 2;\n");
	write(wt, "src/b.ts", "export const b = 2;\nexport const c = 3;\n");
	write(wt, "docs/plan.md", "# Worktree plan\n\nThe worktree plan.\n");
	write(wt, `.ledger/${ID}/task.md`, "Status: ready\n\n# Worktree task\n\nIntent.\n");
	write(outside, "notes.md", "# Outside notes\n\nNo repository here.\n");
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

// ---------------------------------------------------------------------------- sign_off_code

const review = (file: string, over: Partial<ReviewCodeParams> = {}): ReviewCodeParams => ({
	title: "Change",
	intent: "A change.",
	chapters: [
		{ title: "The change", kind: "core", attention: "high", brief: "It.", changes: [{ summary: "It.", file }] },
	],
	...over,
});
const changed = (page: { files: { path: string }[] }) => page.files.map((f) => f.path);
// The worktree's own changes: none of them is the outer repository's `src/a.ts`.
const WT_CHANGES = [`.ledger/${ID}/task.md`, "docs/plan.md", "src/b.ts"];

describe("buildCodeReviewPage with cwd", () => {
	it("without cwd, reviews the session's repository as before", async () => {
		const { page, root } = await buildCodeReviewPage(review("src/a.ts"), outer, "t");
		expect(root).toBe(outer);
		expect(changed(page)).toEqual(["src/a.ts"]);
		expect(page.warnings).toEqual([]);
	});

	it("reviews a nested worktree named by an absolute cwd from a session outside any repository", async () => {
		const { page, root } = await buildCodeReviewPage(review("src/b.ts", { cwd: wt }), outside, "t");
		expect(root).toBe(wt);
		expect(changed(page)).toEqual(WT_CHANGES);
		expect(page.warnings).toEqual([]);
	});

	it("resolves a relative cwd against the session's directory, not the process's", async () => {
		const fromOuter = await buildCodeReviewPage(review("src/b.ts", { cwd: "wt" }), outer, "t");
		expect(fromOuter.root).toBe(wt);
		expect(changed(fromOuter.page)).toEqual(WT_CHANGES);
		const fromBase = await buildCodeReviewPage(review("src/b.ts", { cwd: "outer/wt" }), base, "t");
		expect(fromBase.root).toBe(wt);
		expect(changed(fromBase.page)).toEqual(WT_CHANGES);
	});

	it("reviews the outer repository from inside the worktree when cwd names it", async () => {
		const { page, root } = await buildCodeReviewPage(review("src/a.ts", { cwd: ".." }), wt, "t");
		expect(root).toBe(outer);
		expect(changed(page)).toEqual(["src/a.ts"]);
	});

	it("takes a subdirectory of the repository as cwd, with references from the repository root", async () => {
		const { page, root } = await buildCodeReviewPage(review("src/b.ts", { cwd: "wt/src" }), outer, "t");
		expect(root).toBe(wt);
		expect(page.warnings).toEqual([]);
		expect(page.chapters[0].changes.map((c) => page.hunks[c.id].file)).toEqual(["src/b.ts"]);
	});

	it("fails on a cwd that does not exist instead of reviewing the session's repository", async () => {
		await expect(buildCodeReviewPage(review("src/a.ts", { cwd: "missing" }), outer, "t")).rejects.toThrow();
		await expect(buildCodeReviewPage(review("src/a.ts", { cwd: join(base, "nope") }), outer, "t")).rejects.toThrow();
	});

	it("fails on a cwd outside any repository instead of reviewing the session's repository", async () => {
		await expect(buildCodeReviewPage(review("src/a.ts", { cwd: outside }), outer, "t")).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------- explain_change

const explain = (ref: string, over: Partial<ExplainChangeParams> = {}): ExplainChangeParams => ({
	title: "Change",
	summary: "A change.",
	background: "Before.",
	intuition: "Picture it.",
	steps: [{ title: "The change", body: `It:\n\n\`\`\`code ${ref}\n\`\`\`` }],
	quiz: Array.from({ length: 5 }, (_, i) => ({ question: `Q${i}?`, options: ["a", "b", "c"], answer: 0, why: "." })),
	...over,
});
const excerpts = (parts: ExplainPart[]) => parts.flatMap((p) => ("code" in p ? [p.code] : []));

describe("buildExplainPage with cwd", () => {
	it("without cwd, explains the session's repository as before", async () => {
		const { page, root, warnings } = await buildExplainPage(explain("src/a.ts:1"), outer, "t");
		expect(root).toBe(outer);
		expect(warnings).toEqual([]);
		expect(page.stats.map((s) => s.path)).toEqual(["src/a.ts"]);
		expect(excerpts(page.steps[0].parts)[0].status).toBe("changed");
	});

	it("explains a nested worktree named by an absolute cwd from a session outside any repository", async () => {
		const { page, root, warnings } = await buildExplainPage(explain("src/b.ts:1-2", { cwd: wt }), outside, "t");
		expect(root).toBe(wt);
		expect(warnings).toEqual([]);
		expect(page.stats.map((s) => s.path)).toEqual(WT_CHANGES);
		expect(page.stats.find((s) => s.path === "src/b.ts")).toEqual({ path: "src/b.ts", add: 2, del: 1 });
		const [excerpt] = excerpts(page.steps[0].parts);
		expect(excerpt.status).toBe("changed");
		expect(excerpt.rows.filter((r) => r.t === "+").map((r) => r.s.map((s) => s.t).join(""))).toEqual([
			"export const b = 2;",
			"export const c = 3;",
		]);
	});

	it("resolves historical refs and reads committed code in the selected worktree", async () => {
		git(wt, "add", ".");
		git(wt, "commit", "-q", "-m", "worktree change");
		write(wt, "src/b.ts", "export const b = 99;\n");
		const { page, warnings } = await buildExplainPage(
			explain("src/b.ts:1-2", { cwd: "wt", base: "HEAD^", head: "HEAD" }),
			outer,
			"t",
		);
		expect(warnings).toEqual([]);
		expect(page.stats.map((s) => s.path)).toEqual(WT_CHANGES);
		const [excerpt] = excerpts(page.steps[0].parts);
		expect(excerpt.rows.filter((r) => r.t === "+").map((r) => r.s.map((s) => s.t).join(""))).toEqual([
			"export const b = 2;",
			"export const c = 3;",
		]);
	});

	it("resolves a relative cwd against the session's directory", async () => {
		const { root, page } = await buildExplainPage(explain("src/b.ts:1", { cwd: "outer/wt" }), base, "t");
		expect(root).toBe(wt);
		expect(page.stats.map((s) => s.path)).toEqual(WT_CHANGES);
	});

	it("takes a subdirectory of the repository as cwd, with code references from the repository root", async () => {
		const { root, warnings, page } = await buildExplainPage(explain("src/b.ts:1-2", { cwd: "src" }), wt, "t");
		expect(root).toBe(wt);
		expect(warnings).toEqual([]);
		expect(page.covered).toEqual(["src/b.ts"]);
	});

	it("fails on a cwd that does not exist or is in no repository, instead of explaining the session's", async () => {
		await expect(buildExplainPage(explain("src/a.ts:1", { cwd: "missing" }), outer, "t")).rejects.toThrow();
		await expect(buildExplainPage(explain("src/a.ts:1", { cwd: outside }), outer, "t")).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------- sign_off_document

describe("buildMarkdownPage with cwd", () => {
	it("without cwd, reads the path from the session's directory as before", async () => {
		const { page, root } = await buildMarkdownPage({ path: "docs/plan.md" }, outer, "t");
		expect(root).toBe(outer);
		expect(page.title).toBe("Outer plan");
		expect(page.path).toBe("docs/plan.md");
	});

	it("reads a relative path from a nested worktree named by an absolute cwd", async () => {
		const { page, root } = await buildMarkdownPage({ path: "docs/plan.md", cwd: wt }, outside, "t");
		expect(root).toBe(wt);
		expect(page.title).toBe("Worktree plan");
		expect(page.path).toBe("docs/plan.md");
	});

	it("resolves a relative cwd against the session's directory", async () => {
		const { page, root } = await buildMarkdownPage({ path: "docs/plan.md", cwd: "wt" }, outer, "t");
		expect(root).toBe(wt);
		expect(page.title).toBe("Worktree plan");
	});

	it("reads a path relative to a subdirectory cwd and places it from the repository root", async () => {
		const { page, root } = await buildMarkdownPage({ path: "plan.md", cwd: "wt/docs" }, outer, "t");
		expect(root).toBe(wt);
		expect(page.title).toBe("Worktree plan");
		expect(page.path).toBe("docs/plan.md");
	});

	it("still reads an absolute path whatever the cwd", async () => {
		const { page } = await buildMarkdownPage({ path: join(outer, "docs/plan.md"), cwd: wt }, outside, "t");
		expect(page.title).toBe("Outer plan");
	});

	it("reads a document in a directory outside any repository", async () => {
		const own = await buildMarkdownPage({ path: "notes.md" }, outside, "t");
		expect(own.root).toBe(outside);
		expect(own.page.title).toBe("Outside notes");
		const named = await buildMarkdownPage({ path: "notes.md", cwd: outside }, outer, "t");
		expect(named.root).toBe(outside);
		expect(named.page.title).toBe("Outside notes");
	});

	it("fails on a cwd that does not exist instead of reading from the session's directory", async () => {
		await expect(buildMarkdownPage({ path: "docs/plan.md", cwd: "missing" }, outer, "t")).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------- sign_off_task

describe("buildLedgerPage with cwd", () => {
	it("without cwd, finds the task in the session's repository as before", async () => {
		const { page, root } = await buildLedgerPage({ task: ID }, outer, "t");
		expect(root).toBe(outer);
		expect(page.title).toBe("Outer task");
	});

	it("finds the task in a nested worktree named by an absolute cwd", async () => {
		const { page, root, dir } = await buildLedgerPage({ task: ID, cwd: wt }, outside, "t");
		expect(root).toBe(wt);
		expect(dir).toBe(join(wt, ".ledger", ID));
		expect(page.title).toBe("Worktree task");
		expect(page.path).toBe(`.ledger/${ID}`);
	});

	it("resolves a relative cwd against the session's directory", async () => {
		const { page } = await buildLedgerPage({ task: ID, cwd: "outer/wt" }, base, "t");
		expect(page.title).toBe("Worktree task");
	});

	it("finds the repository's ledger from a subdirectory cwd, and task paths relative to it", async () => {
		const byId = await buildLedgerPage({ task: ID, cwd: "wt/src" }, outer, "t");
		expect(byId.root).toBe(wt);
		expect(byId.page.title).toBe("Worktree task");
		const byPath = await buildLedgerPage({ task: `../.ledger/${ID}/task.md`, cwd: "wt/src" }, outer, "t");
		expect(byPath.dir).toBe(join(wt, ".ledger", ID));
	});

	it("fails on a cwd that does not exist or has no ledger, instead of using the session's", async () => {
		await expect(buildLedgerPage({ task: ID, cwd: "missing" }, outer, "t")).rejects.toThrow();
		await expect(buildLedgerPage({ task: ID, cwd: outside }, outer, "t")).rejects.toThrow();
	});
});
