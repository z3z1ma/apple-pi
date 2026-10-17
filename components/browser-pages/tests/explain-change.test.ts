import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	buildExplainPage,
	type ExplainChangeParams,
	parseTutorTurn,
	readerNote,
	tutorPrompt,
} from "../src/explain-change.js";
import browserPages from "../src/index.js";
import type { CodeExcerpt, ExplainPart } from "../src/page-data.js";

let repo: string;
const write = (path: string, text: string) => {
	mkdirSync(dirname(join(repo, path)), { recursive: true });
	writeFileSync(join(repo, path), text);
};
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString().trim();

beforeEach(() => {
	repo = mkdtempSync(join(tmpdir(), "browser-pages-explain-"));
	git("init", "-q", "-b", "main");
	git("config", "user.email", "t@example.com");
	git("config", "user.name", "T");
	write("src/retry.ts", "export function retry(n: number) {\n  return n;\n}\n");
	write("src/util.ts", "export const one = 1;\n");
	git("add", ".");
	git("commit", "-q", "-m", "base");
	write("src/retry.ts", "export function retry(n: number) {\n  const limit = 4;\n  return Math.min(n, limit);\n}\n");
	write("src/policy.ts", "export const policy = { attempts: 4 };\n");
	git("add", ".");
	git("commit", "-q", "-m", "Cap retries at four");
	write("src/util.ts", "export const one = 1;\nexport const two = 2;\n");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const quiz = Array.from({ length: 5 }, (_, i) => ({
	question: `Q${i}?`,
	options: ["a", "b", "c"],
	answer: i % 3,
	why: "Because.",
}));
const params = (over: Partial<ExplainChangeParams> = {}): ExplainChangeParams => ({
	title: "Cap retries",
	summary: "Retries stop at four.",
	background: "Retries were unbounded.",
	intuition:
		'Picture a loop.\n\n```figure Drag the slider.\n<div id="x"></div>\n```\n\n```mermaid\ngraph TD; A-->B\n```',
	steps: [{ title: "The cap", body: "The cap:\n\n```code src/retry.ts:1-4\n```" }],
	quiz,
	...over,
});
const code = (parts: ExplainPart[]) => parts.flatMap((p) => ("code" in p ? [p.code] : []));
const rows = (c: CodeExcerpt) => c.rows.map((r) => `${r.t}${r.n ?? ""} ${r.s.map((s) => s.t).join("")}`);

describe("buildExplainPage", () => {
	it("explains one past commit, with removed lines back in place", async () => {
		const { page, warnings } = await buildExplainPage(params({ base: "HEAD^", head: "HEAD" }), repo, "t");
		expect(page.ref).toBe(git("rev-parse", "--short=7", "HEAD"));
		expect(page.subject).toBe("Cap retries at four");
		expect(page.stats).toEqual([
			{ path: "src/policy.ts", add: 1, del: 0 },
			{ path: "src/retry.ts", add: 2, del: 1 },
		]);
		const [cap] = code(page.steps[0].parts);
		expect(cap.status).toBe("changed");
		expect(rows(cap)).toEqual([
			" 1 export function retry(n: number) {",
			"-   return n;",
			"+2   const limit = 4;",
			"+3   return Math.min(n, limit);",
			" 4 }",
		]);
		expect(cap.rows[1].s.length).toBeGreaterThan(1);
		expect(page.covered).toEqual(["src/retry.ts"]);
		expect(warnings).toEqual([]);
	});

	it("explains the working tree, and a range from where head meets base, as a pull request shows it", async () => {
		const tree = (
			await buildExplainPage(params({ steps: [{ title: "S", body: "```code src/util.ts:1-2\n```" }] }), repo, "t")
		).page;
		expect(tree.ref).toBe("uncommitted changes");
		expect(rows(code(tree.steps[0].parts)[0])).toEqual([" 1 export const one = 1;", "+2 export const two = 2;"]);
		// A branch that left main before its last commit, with a change of its own.
		git("checkout", "-q", "-b", "other", "HEAD~1");
		write("src/other.ts", "export const other = true;\n");
		git("add", "src/other.ts");
		git("commit", "-q", "-m", "Other work");
		git("checkout", "-q", "main");
		const range = (await buildExplainPage(params({ base: "other", head: "main" }), repo, "t")).page;
		expect(range.stats.map((f) => f.path)).toEqual(["src/policy.ts", "src/retry.ts"]);
	});

	it("marks new and unchanged files, and turns a bad reference into a warning the agent sees", async () => {
		const body =
			"```code src/policy.ts:1-1\n```\n\n```code src/util.ts:1\n```\n\n```code src/retry.ts:3-9\n```\n\n```code src/nope.ts:1-2\n```";
		const { page, warnings } = await buildExplainPage(
			params({ base: "HEAD^", head: "HEAD", steps: [{ title: "S", body }] }),
			repo,
			"t",
		);
		expect(code(page.steps[0].parts).map((c) => c.status)).toEqual(["new", "unchanged"]);
		expect(page.steps[0].parts.filter((p) => "missing" in p)).toHaveLength(2);
		expect(warnings).toEqual([
			"`src/retry.ts:3-9`: `src/retry.ts` has 4 lines.",
			expect.stringContaining("`src/nope.ts` does not exist at"),
		]);
		expect(page.covered).toEqual(["src/policy.ts"]);
	});

	it("shows a file the change deletes from its old lines", async () => {
		git("rm", "-q", "src/policy.ts");
		git("commit", "-q", "-m", "Drop the policy");
		const step = { title: "S", body: "```code src/policy.ts:1-1\n```" };
		const { page, warnings } = await buildExplainPage(
			params({ base: "HEAD^", head: "HEAD", steps: [step] }),
			repo,
			"t",
		);
		const [gone] = code(page.steps[0].parts);
		expect(gone.status).toBe("deleted");
		expect(rows(gone)).toEqual(["-1 export const policy = { attempts: 4 };"]);
		expect(page.covered).toEqual(["src/policy.ts"]);
		expect(warnings).toEqual([]);
	});

	it("keeps a figure's HTML and caption, a diagram as a block, and rejects an answer that is not an option", async () => {
		const { page } = await buildExplainPage(params(), repo, "t");
		expect(page.intuition.find((p) => "figure" in p)).toEqual({
			figure: { caption: "Drag the slider.", html: '<div id="x"></div>' },
		});
		expect(page.intuition.some((p) => "block" in p && p.block.mermaid)).toBe(true);
		const bad = quiz.map((q, i) => (i === 2 ? { ...q, answer: 3 } : q));
		await expect(buildExplainPage(params({ quiz: bad }), repo, "t")).rejects.toThrow("Quiz question 3");
		await expect(buildExplainPage(params({ head: "nope" }), repo, "t")).rejects.toThrow();
	});
});

describe("the tutor", () => {
	it("frames each way into the conversation for the fork", async () => {
		const { page } = await buildExplainPage(params(), repo, "t");
		const talk = parseTutorTurn(
			{ message: "Talk me through it.", mode: "socratic", thread: [], start: { kind: "talk", question: 1, choice: 0 } },
			page,
		)!;
		expect(tutorPrompt(page, talk)).toContain("A. a (the reader's choice)\nB. b (right)");
		// A check asks first, so it reads the same in either mode; a reader's own question follows the mode.
		const check = parseTutorTurn(
			{ message: "Check me.", mode: "direct", thread: [], start: { kind: "check", step: 0 } },
			page,
		)!;
		expect(tutorPrompt(page, check)).toBe(tutorPrompt(page, { ...check, mode: "socratic" }));
		expect(tutorPrompt(page, check)).toContain('Step 1, "The cap"');
		const direct = parseTutorTurn(
			{
				message: "Why four?",
				mode: "direct",
				thread: [
					{ role: "reader", text: "Hi" },
					{ role: "tutor", text: "Hello" },
				],
			},
			page,
		)!;
		expect(tutorPrompt(page, direct)).not.toBe(tutorPrompt(page, { ...direct, mode: "socratic" }));
		expect(tutorPrompt(page, direct)).toContain("Reader: Hi\nTutor: Hello\n\nReader: Why four?");
		for (const bad of [
			{ message: "", mode: "socratic", thread: [] },
			{ message: "x", mode: "loud", thread: [] },
			{ message: "x", mode: "direct", thread: [{ role: "x", text: "" }] },
		])
			expect(parseTutorTurn(bad, page)).toBeUndefined();
	});

	it("tells the agent what the reader missed and asked, and nothing when they did nothing", async () => {
		const { page } = await buildExplainPage(params(), repo, "t");
		expect(readerNote({ answers: [], asked: [] }, page)).toBeUndefined();
		const note = readerNote(
			{
				answers: [
					{ question: 0, chosen: 0 },
					{ question: 1, chosen: 0 },
				],
				asked: ["Why four?"],
			},
			page,
		)!;
		expect(note).toContain("Quiz: 1 of 2 right (2 of 5 answered).");
		expect(note).toContain('- Missed question 2, "Q1?": chose "a", not "b".');
		expect(note).toContain("They asked the tutor:\n- Why four?");
		expect(note).toContain("close that gap first");
		const allRight = readerNote({ answers: [{ question: 1, chosen: 1 }], asked: [] }, page)!;
		expect(allRight).toContain("Quiz: 1 of 1 right");
		expect(allRight).not.toContain("close that gap");
	});
});

describe("explain_change tool", () => {
	it("returns at once, saves a clean copy, and passes the reader's note to the agent once", {
		timeout: 30_000,
	}, async () => {
		const bin = mkdtempSync(join(tmpdir(), "browser-pages-bin-"));
		const agentDir = mkdtempSync(join(tmpdir(), "browser-pages-agent-"));
		for (const name of ["open", "xdg-open"]) {
			writeFileSync(join(bin, name), "#!/bin/sh\nexit 0\n");
			chmodSync(join(bin, name), 0o755);
		}
		const saved = { path: process.env.PATH, agent: process.env.PI_CODING_AGENT_DIR };
		process.env.PATH = `${bin}:${saved.path}`;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		const shutdown: (() => void)[] = [];
		try {
			let tool: any;
			const sent: { message: { customType: string; content: string }; options: unknown }[] = [];
			browserPages({
				registerTool: (definition: any) => {
					if (definition.name === "explain_change") tool = definition;
				},
				on: (event: string, handler: () => void) => {
					if (event === "session_shutdown") shutdown.push(handler);
				},
				sendMessage: (message: any, options: unknown) => sent.push({ message, options }),
			} as any);
			const result = await tool.execute(
				"call",
				params({ cwd: repo, base: "HEAD^", head: "HEAD" }),
				undefined,
				undefined,
				{
					hasUI: true,
					cwd: bin,
				},
			);
			const { url, saved: copy } = result.details;
			const html = readFileSync(copy, "utf8");
			const data = JSON.parse(/<script id="page-data" type="application\/json">(.*?)<\/script>/s.exec(html)![1]);
			expect(data).toMatchObject({
				kind: "explain-change",
				title: "Cap retries",
				session: { live: false, ask: false },
			});
			expect(result.content[0].text).toContain(
				`Saved a shareable copy (attach it to a pull request or a page): ${copy}`,
			);
			const token = new URL(url).searchParams.get("t")!;
			const call = (path: string, body?: unknown) =>
				fetch(new URL(path, url), {
					method: body === undefined ? "GET" : "POST",
					headers: { "x-page-token": token, "content-type": "application/json" },
					body: body === undefined ? undefined : JSON.stringify(body),
				});
			// No live session runs in this test, so the page learns that the tutor cannot answer and hides it.
			expect(await (await call("/health")).json()).toEqual({ ask: false });
			const note = { answers: [{ question: 0, chosen: 1 }], asked: ["Why four?"] };
			await call("/note", note);
			await call("/note", note);
			await call("/note", { answers: [], asked: [] });
			expect(sent).toHaveLength(1);
			expect(sent[0].message.customType).toBe("explain-reader-note");
			expect(sent[0].message.content).toContain('Missed question 1, "Q0?"');
			expect(sent[0].options).toEqual({ deliverAs: "nextTurn" });
			for (const close of shutdown) close();
			await expect(call("/health")).rejects.toThrow();
		} finally {
			process.env.PATH = saved.path;
			if (saved.agent === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = saved.agent;
			rmSync(bin, { recursive: true, force: true });
			rmSync(agentDir, { recursive: true, force: true });
		}
	});
});
