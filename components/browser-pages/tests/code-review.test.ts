import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	buildCodeReviewPage,
	formatReviewResult,
	parseReviewResult,
	type ReviewCodeParams,
} from "../src/code-review.js";
import browserPages from "../src/index.js";

let repo: string;
const write = (path: string, text: string) => {
	mkdirSync(dirname(join(repo, path)), { recursive: true });
	writeFileSync(join(repo, path), text);
};
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString();

const repository = (name: string) =>
	`export class ${name}Repository {\n  find(id: string) {\n    return this.db.${name.toLowerCase()}s.findOne({ id });\n  }\n}\n`;

beforeEach(() => {
	repo = mkdtempSync(join(tmpdir(), "browser-pages-"));
	git("init", "-q", "-b", "main");
	git("config", "user.email", "test@example.com");
	git("config", "user.name", "Test");
	write("src/client.ts", "export function request() {\n  return fetch(url);\n}\n");
	write("src/db/invoices.ts", repository("Invoice"));
	write("src/db/taxs.ts", repository("Tax"));
	write("src/db/plans.ts", repository("Plan"));
	write("src/old.ts", "export const old = 1;\n");
	git("add", ".");
	git("commit", "-q", "-m", "base");
	write(
		"src/client.ts",
		"export function request() {\n  const policy = retryPolicy();\n  return fetch(url, policy);\n}\n",
	);
	for (const [file, name, source] of [
		["src/db/invoices.ts", "Invoice", "tx"],
		["src/db/plans.ts", "Plan", "tx"],
		["src/db/taxs.ts", "Tax", "this.db"],
	])
		write(
			file,
			`export class ${name}Repository {\n  find(id: string, tx = this.db) {\n    return ${source}.${name.toLowerCase()}s.findOne({ id });\n  }\n}\n`,
		);
	write("src/retry.ts", "export const retryPolicy = () => ({ attempts: 3 });\n");
	git("rm", "-q", "src/old.ts");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

const params = (overrides: Partial<ReviewCodeParams> = {}): ReviewCodeParams => ({
	title: "Retry requests",
	intent: "Requests retry.",
	chapters: [
		{
			title: "Retry policy",
			kind: "core",
			attention: "high",
			brief: "First paragraph.\n\nSecond paragraph.",
			changes: [
				{ summary: "The client asks for a policy.", file: "src/client.ts", lines: "2-3" },
				{ summary: "A new policy module.", file: "src/retry.ts" },
			],
		},
		{
			title: "Repositories take a transaction",
			kind: "consequence",
			attention: "medium",
			brief: "Each find takes a transaction.",
			changes: [
				{
					summary: "Each repository's find takes a transaction.",
					places: [{ file: "src/db/invoices.ts" }, { file: "src/db/plans.ts" }, { file: "src/db/taxs.ts" }],
				},
			],
		},
	],
	notes: [{ file: "src/client.ts", line: 2, text: "Policy first." }],
	decisions: [
		{ file: "src/retry.ts", question: "How many attempts?", options: [{ label: "3" }, { label: "5" }], chosen: 0 },
	],
	...overrides,
});

describe("buildCodeReviewPage", () => {
	it("places every hunk once and shows unreferenced hunks as unplaced", async () => {
		const { page, root } = await buildCodeReviewPage(params(), repo, "token");
		expect(root).toContain("browser-pages-");
		const placed = page.chapters.flatMap((c) => c.changes.map((ch) => ch.id));
		expect(new Set(placed).size).toBe(placed.length);
		const unplaced = page.order.filter((id) => !placed.includes(id));
		expect(unplaced.map((id) => page.hunks[id].file)).toEqual(["src/old.ts"]);
		expect(page.files.find((f) => f.path === "src/retry.ts")?.status).toBe("A");
		expect(page.files.find((f) => f.path === "src/old.ts")?.status).toBe("D");
		expect(page.chapters[0].brief).toEqual(["First paragraph.", "Second paragraph."]);
	});

	it("reads code from git, highlighted, with word-level marks", async () => {
		const { page } = await buildCodeReviewPage(params(), repo, "token");
		const client = page.order.map((id) => page.hunks[id]).find((h) => h.file === "src/client.ts")!;
		const added = client.lines.filter((l) => l.t === "+").map((l) => l.s.map((s) => s.t).join(""));
		expect(added).toEqual(["  const policy = retryPolicy();", "  return fetch(url, policy);"]);
		expect(client.lines.some((l) => l.s.some((s) => s.c))).toBe(true);
		expect(client.lines.some((l) => l.s.some((s) => s.m))).toBe(true);
	});

	it("groups a repeated change and flags a place that is more than a rename", async () => {
		const { page } = await buildCodeReviewPage(params(), repo, "token");
		const [pattern] = Object.values(page.patterns);
		expect(pattern.hunks.map((id) => page.hunks[id].file)).toEqual([
			"src/db/invoices.ts",
			"src/db/plans.ts",
			"src/db/taxs.ts",
		]);
		expect(pattern.differs.map((id) => page.hunks[id].file)).toEqual(["src/db/taxs.ts"]);
	});

	it("anchors notes and decisions and reports references that miss", async () => {
		const { page } = await buildCodeReviewPage(
			params({
				notes: [
					{ file: "src/client.ts", line: 2, text: "ok" },
					{ file: "src/nowhere.ts", line: 1, text: "x" },
				],
			}),
			repo,
			"token",
		);
		expect(page.notes).toHaveLength(1);
		expect(page.notes[0].label).toBe("L2");
		expect(page.decisions[0].label).toBe("L1");
		expect(page.warnings.some((w) => w.includes("src/nowhere.ts"))).toBe(true);
	});

	it("cuts a git hunk where the agent's entries divide it", async () => {
		const lines = Array.from({ length: 10 }, (_, i) => `const v${i + 1} = ${i + 1};`);
		write("src/values.ts", `${lines.join("\n")}\n`);
		git("add", "src/values.ts");
		git("commit", "-q", "-m", "values");
		const edited = [...lines];
		edited[1] = "const v2 = 20;";
		edited[6] = "const v7 = 70;";
		write("src/values.ts", `${edited.join("\n")}\n`);
		const base = params();
		base.chapters[0].changes.push({ summary: "Second value.", file: "src/values.ts", lines: "2" });
		base.chapters[1].changes.push({ summary: "Seventh value.", file: "src/values.ts", lines: "7" });
		const { page } = await buildCodeReviewPage(base, repo, "token");
		const pieces = page.order.filter((id) => page.hunks[id].file === "src/values.ts");
		expect(pieces).toHaveLength(2);
		const changed = (id: string) => page.hunks[id].lines.filter((l) => l.t === "+").map((l) => l.n);
		expect(pieces.map(changed)).toEqual([[2], [7]]);
		const owner = (id: string) => page.chapters.findIndex((c) => c.changes.some((ch) => ch.id === id));
		expect(pieces.map(owner)).toEqual([0, 1]);
		const shown = pieces.flatMap((id) => page.hunks[id].lines.map((l) => `${l.t}${l.o ?? ""}:${l.n ?? ""}`));
		expect(new Set(shown).size).toBe(shown.length);
	});

	it("cuts a new file at the agent's ranges and leaves the rest unplaced", async () => {
		write("src/fresh.ts", `${Array.from({ length: 10 }, (_, i) => `export const f${i + 1} = ${i + 1};`).join("\n")}\n`);
		const base = params();
		base.chapters[0].changes.push({ summary: "Head.", file: "src/fresh.ts", lines: "1-4" });
		base.chapters[1].changes.push({ summary: "Tail.", file: "src/fresh.ts", lines: "7-10" });
		const { page } = await buildCodeReviewPage(base, repo, "token");
		const pieces = page.order.filter((id) => page.hunks[id].file === "src/fresh.ts");
		const lines = (id: string) => page.hunks[id].lines.map((l) => l.n);
		expect(pieces.map(lines)).toEqual([
			[1, 2, 3, 4],
			[5, 6],
			[7, 8, 9, 10],
		]);
		const owner = (id: string) => page.chapters.findIndex((c) => c.changes.some((ch) => ch.id === id));
		expect(pieces.map(owner)).toEqual([0, -1, 1]);
	});

	it("keeps a hunk in its first chapter when two chapters claim it", async () => {
		const base = params();
		base.chapters[1].changes.push({ summary: "again", file: "src/retry.ts" });
		const { page } = await buildCodeReviewPage(base, repo, "token");
		expect(page.chapters[1].changes.some((c) => page.hunks[c.id].file === "src/retry.ts")).toBe(false);
		expect(page.warnings.some((w) => w.includes("placed by an earlier entry"))).toBe(true);
	});
});

describe("review_code tool", () => {
	// A page server, a browser subprocess, and a cold Shiki start: slower than 5 s under full-suite load.
	it("opens the page, waits for the submission, saves the page, and returns the review", {
		timeout: 30_000,
	}, async () => {
		const bin = mkdtempSync(join(tmpdir(), "browser-pages-bin-"));
		const agentDir = mkdtempSync(join(tmpdir(), "browser-pages-agent-"));
		// A stand-in browser: it submits an approval for whatever page it is asked to open.
		const browser = `#!/bin/sh\nurl="$1"\ncurl -s -X POST -H "x-page-token: \${url##*t=}" -H "content-type: application/json" --data '{"verdict":"approve","summary":"Ship it.","comments":[],"decisions":[],"seen":[]}' "\${url%%\\?*}result" > /dev/null\n`;
		for (const name of ["open", "xdg-open"]) {
			writeFileSync(join(bin, name), browser);
			chmodSync(join(bin, name), 0o755);
		}
		const saved = { path: process.env.PATH, agent: process.env.PI_CODING_AGENT_DIR };
		process.env.PATH = `${bin}:${saved.path}`;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		try {
			let tool: any;
			browserPages({
				registerTool: (definition: any) => {
					if (definition.name === "review_code") tool = definition;
				},
				on: () => {},
			} as any);
			const updates: string[] = [];
			const result = await tool.execute("call", params(), undefined, (u: any) => updates.push(u.content[0].text), {
				hasUI: true,
				cwd: repo,
			});
			expect(updates[0]).toMatch(/^Waiting for the review at http:\/\/127\.0\.0\.1:\d+\/\?t=/);
			expect(result.content[0].text).toContain("The reviewer approved.");
			expect(result.content[0].text).toContain("Summary: Ship it.");
			expect(result.details.saved.startsWith(join(agentDir, "artifacts"))).toBe(true);
			const html = readFileSync(result.details.saved, "utf8");
			expect(html).toContain('"live":false');
			expect(html).toContain('"verdict":"approve"');
		} finally {
			process.env.PATH = saved.path;
			if (saved.agent === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = saved.agent;
			rmSync(bin, { recursive: true, force: true });
			rmSync(agentDir, { recursive: true, force: true });
		}
	});

	it("opens nothing when no user is attached", async () => {
		let tool: any;
		browserPages({
			registerTool: (definition: any) => {
				if (definition.name === "review_code") tool = definition;
			},
			on: () => {},
		} as any);
		const result = await tool.execute("call", params(), undefined, undefined, { hasUI: false, cwd: repo });
		expect(result.content[0].text).toContain("no review page was opened");
	});
});

describe("repeated changes", () => {
	it("flags every place that is more than a rename of the example", async () => {
		const job = (name: string, tx: string, live: string, limit: string, event: string) =>
			`export const run = (tx) => ${tx}.${name}s.find({ live: ${live}, limit: ${limit}, event: "${name}.${event}" });\n`;
		write("src/jobs/invoices.ts", job("invoice", "tx", "true", "30_000", "sync"));
		write("src/jobs/taxs.ts", job("tax", "tx", "true", "30_000", "sync"));
		write("src/jobs/plans.ts", job("plan", "tx", "false", "30_000", "sync"));
		write("src/jobs/refunds.ts", job("refund", "tx", "true", "60_000", "sync"));
		write("src/jobs/payments.ts", job("payment", "db", "true", "30_000", "sync"));
		write("src/jobs/credits.ts", job("credit", "tx", "true", "30_000", "delete"));
		const base = params();
		const places = ["invoices", "taxs", "plans", "refunds", "payments", "credits"].map((n) => ({
			file: `src/jobs/${n}.ts`,
		}));
		base.chapters[1].changes.push({ summary: "Each job runs.", places });
		// Two places in one file that differ only by a flag: no name explains the change, so it is flagged.
		write("src/jobs/cache.ts", "enable({ cache: false });\n\nenable({ cache: true });\n");
		base.chapters[1].changes.push({
			summary: "Each cache is enabled.",
			places: [
				{ file: "src/jobs/cache.ts", lines: "1" },
				{ file: "src/jobs/cache.ts", lines: "3" },
			],
		});
		const { page } = await buildCodeReviewPage(base, repo, "token");
		const jobs = Object.values(page.patterns).find((p) => p.summary === "Each job runs.")!;
		expect(jobs.differs.map((id) => page.hunks[id].file)).toEqual([
			"src/jobs/plans.ts",
			"src/jobs/refunds.ts",
			"src/jobs/payments.ts",
			"src/jobs/credits.ts",
		]);
		const cache = Object.values(page.patterns).find((p) => p.summary === "Each cache is enabled.")!;
		expect(cache.differs.map((id) => page.hunks[id].lines[0].n)).toEqual([3]);
	});
});

describe("review results", () => {
	it("rejects malformed submissions and formats a valid one with anchors", async () => {
		const { page } = await buildCodeReviewPage(params(), repo, "token");
		const client = page.order.find((id) => page.hunks[id].file === "src/client.ts")!;
		expect(parseReviewResult({ verdict: "maybe", comments: [], decisions: [], seen: [] }, page)).toBeUndefined();
		expect(
			parseReviewResult(
				{
					verdict: "changes",
					comments: [{ hunk: "nope", start: 0, end: 0, kind: "change", text: "x" }],
					decisions: [],
					seen: [],
				},
				page,
			),
		).toBeUndefined();
		const result = parseReviewResult(
			{
				verdict: "changes",
				summary: " Close. ",
				comments: [{ hunk: client, start: 2, end: 3, kind: "concern", text: "Name it." }],
				decisions: [{ id: "d1", choice: 1, note: "More." }],
				seen: [client],
			},
			page,
		);
		expect(result).toBeDefined();
		const text = formatReviewResult(page, result!, "/tmp/saved.html");
		expect(text).toContain("requested changes");
		expect(text).toContain("Summary: Close.");
		expect(text).toContain("concern · src/client.ts:2-3: Name it.");
		expect(text).toContain('overrode your choice of "3" with "5" (More.)');
		expect(text).toContain(`marked 1 of ${page.order.length} hunks seen`);
		expect(text).toContain("Saved page: /tmp/saved.html");
	});
});

describe("files without a plain edit", () => {
	it("shows a renamed file with its old path and a binary file with a note", async () => {
		write("src/move-me.ts", "export const a = 1;\nexport const b = 2;\nexport const c = 3;\nexport const d = 4;\n");
		writeFileSync(join(repo, "logo.bin"), Buffer.from([0, 1, 2, 3, 0]));
		git("add", ".");
		git("commit", "-q", "-m", "more");
		git("mv", "src/move-me.ts", "src/moved.ts");
		write("src/moved.ts", "export const a = 1;\nexport const b = 20;\nexport const c = 3;\nexport const d = 4;\n");
		writeFileSync(join(repo, "logo.bin"), Buffer.from([0, 9, 9, 9, 0]));
		const { page } = await buildCodeReviewPage(params(), repo, "token");
		expect(page.files.find((f) => f.path === "src/moved.ts")).toMatchObject({ status: "R", oldPath: "src/move-me.ts" });
		const moved = page.order.map((id) => page.hunks[id]).find((h) => h.file === "src/moved.ts")!;
		expect(moved.lines.filter((l) => l.t !== " ").map((l) => [l.t, l.o, l.n])).toEqual([
			["-", 2, undefined],
			["+", undefined, 2],
		]);
		expect(page.files.find((f) => f.path === "logo.bin")?.binary).toBe(true);
		const logo = page.order.map((id) => page.hunks[id]).find((h) => h.file === "logo.bin")!;
		expect(logo).toMatchObject({ lines: [], note: "Binary file" });
		const placed = new Set(page.chapters.flatMap((c) => c.changes.map((ch) => ch.id)));
		expect([moved.id, logo.id].every((id) => !placed.has(id))).toBe(true);
	});
});
