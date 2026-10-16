import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import browserPages from "../src/index.js";
import {
	buildMarkdownPage,
	formatMarkdownResult,
	markdownTemplate,
	parseMarkdownQuestion,
	parseMarkdownResult,
} from "../src/markdown-review.js";
import type { MarkdownReviewPage } from "../src/page-data.js";

const DOC = `# Rollout plan

Ship the change behind a flag.

## Steps

1. Enable for staff.
2. Enable for everyone.

\`\`\`ts
const flag = "rollout";
\`\`\`

\`\`\`mermaid
graph TD; A-->B
\`\`\`
`;

let repo: string;
beforeEach(() => {
	repo = mkdtempSync(join(tmpdir(), "browser-pages-md-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	mkdirSync(join(repo, "docs"));
	writeFileSync(join(repo, "docs/plan.md"), DOC);
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const build = async () => (await buildMarkdownPage({ path: "plan.md" }, join(repo, "docs"), "token")).page;
const block = (page: MarkdownReviewPage, start: string) => page.blocks.find((b) => b.raw.startsWith(start))!;

describe("buildMarkdownPage", () => {
	it("splits the file into blocks with their source lines", async () => {
		const page = await build();
		expect(page.title).toBe("Rollout plan");
		expect(page.path).toBe("docs/plan.md");
		expect(page.blocks.map((b) => [b.line, b.endLine, b.raw.split("\n")[0]])).toEqual([
			[1, 1, "# Rollout plan"],
			[3, 3, "Ship the change behind a flag."],
			[5, 5, "## Steps"],
			[7, 8, "1. Enable for staff."],
			[10, 12, "```ts"],
			[14, 16, "```mermaid"],
		]);
		expect(block(page, "## Steps").heading).toEqual({ depth: 2, text: "Steps" });
	});

	it("highlights code fences and leaves Mermaid for the page to draw", async () => {
		const page = await build();
		const code = block(page, "```ts").code!;
		expect(code.lang).toBe("ts");
		expect(code.lines[0].map((s) => s.t).join("")).toBe('const flag = "rollout";');
		expect(code.lines[0].some((s) => s.c)).toBe(true);
		const mermaid = block(page, "```mermaid");
		expect(mermaid.mermaid).toBe(true);
		expect(mermaid.code).toBeUndefined();
	});

	it("inlines Mermaid only when the document has a diagram", async () => {
		const page = await build();
		const withDiagram = await markdownTemplate(page);
		const without = await markdownTemplate({ ...page, blocks: page.blocks.filter((b) => !b.mermaid) });
		expect(withDiagram).toContain('globalThis["mermaid"]');
		expect(without).not.toContain('globalThis["mermaid"]');
		expect(withDiagram.indexOf('globalThis["mermaid"]')).toBeLessThan(withDiagram.indexOf('id="page-data"'));
		expect(without.length).toBeLessThan(withDiagram.length / 4);
	});
});

describe("results", () => {
	it("accepts annotations on blocks the page showed and rejects anything else whole", async () => {
		const page = await build();
		const para = block(page, "Ship").id;
		const valid = {
			verdict: "changes",
			overall: " Tighten it. ",
			annotations: [
				{ type: "comment", spans: [{ block: para, start: 0, end: 4 }], quote: "Ship", text: "When?" },
				{ type: "label", spans: [{ block: para, start: 5, end: 15 }], label: "clarify" },
				{ type: "comment", spans: [{ block: para }], text: "Whole paragraph." },
			],
			edits: [{ block: para, after: "Ship it behind a flag." }],
		};
		expect(parseMarkdownResult(valid, page)).toMatchObject({ verdict: "changes", overall: "Tighten it." });
		const broken = [
			{ ...valid, verdict: "maybe" },
			{ ...valid, annotations: [{ type: "comment", spans: [{ block: "nope", start: 0, end: 1 }] }] },
			{ ...valid, annotations: [{ type: "comment", spans: [{ block: para, start: 4, end: 4 }] }] },
			{ ...valid, annotations: [{ type: "comment", spans: [{ block: para, start: -1, end: 4 }] }] },
			{ ...valid, annotations: [{ type: "comment", spans: [{ block: para, start: 0.5, end: 4 }] }] },
			{ ...valid, annotations: [{ type: "comment", spans: [] }] },
			{ ...valid, annotations: [{ type: "suggest", spans: [{ block: para, start: 0, end: 4 }] }] },
			{ ...valid, annotations: [{ type: "label", spans: [{ block: para, start: 0, end: 4 }], label: "meh" }] },
			{ ...valid, edits: [{ block: "nope", after: "x" }] },
		];
		for (const body of broken) expect(parseMarkdownResult(body, page)).toBeUndefined();
		expect(
			parseMarkdownQuestion({ spans: [{ block: para, start: 0, end: 4 }], question: " Why? " }, page),
		).toMatchObject({
			question: "Why?",
		});
		expect(parseMarkdownQuestion({ spans: [{ block: "nope" }], question: "Why?" }, page)).toBeUndefined();
		// The page's text runs past the source: marked puts a newline after each element, and a table adds more.
		const past = {
			...valid,
			annotations: [{ type: "comment", spans: [{ block: para, start: 0, end: 31 }], text: "x" }],
		};
		expect(parseMarkdownResult(past, page)).toBeDefined();
	});

	it("tells the model each annotation with its source lines and quote, and rewritten blocks as before and after", async () => {
		const page = await build();
		const para = block(page, "Ship").id;
		const list = block(page, "1.").id;
		const result = parseMarkdownResult(
			{
				verdict: "approve_notes",
				annotations: [
					{ type: "delete", spans: [{ block: para, start: 15, end: 30 }], quote: "behind a flag." },
					{
						type: "suggest",
						spans: [{ block: list, start: 0, end: 15 }],
						quote: "Enable for staff.",
						replacement: "Enable for the team.",
						text: "We have no staff flag.",
					},
					{
						type: "ask",
						spans: [{ block: para, start: 0, end: 4 }],
						quote: "Ship",
						text: "When?",
						answer: "Monday.\nAfter the freeze.",
					},
				],
				edits: [{ block: para, after: "Ship it." }],
			},
			page,
		)!;
		const text = formatMarkdownResult(page, result, "/saved.html");
		expect(text).toContain("approved the document with notes");
		expect(text).toContain("- delete · docs/plan.md:3 “behind a flag.”");
		expect(text).toContain(
			"- replace · docs/plan.md:7-8 “Enable for staff.” with “Enable for the team.” (We have no staff flag.)",
		);
		expect(text).toContain("- asked · docs/plan.md:3 “Ship”: When?\n  > Monday.\n  > After the freeze.");
		expect(text).toContain("- docs/plan.md:3\n  before:\n  | Ship the change behind a flag.\n  after:\n  | Ship it.");
		expect(text).toContain("Saved page: /saved.html");
	});
});

describe("review_markdown tool", () => {
	// A page server, a browser subprocess, and a cold Shiki start: slower than 5 s under full-suite load.
	it("opens the page, waits for the submission, and saves the page with the result", { timeout: 30_000 }, async () => {
		const bin = mkdtempSync(join(tmpdir(), "browser-pages-bin-"));
		const agentDir = mkdtempSync(join(tmpdir(), "browser-pages-agent-"));
		const browser = `#!/bin/sh\nurl="$1"\ncurl -s -X POST -H "x-page-token: \${url##*t=}" -H "content-type: application/json" --data '{"verdict":"approve","annotations":[],"edits":[]}' "\${url%%\\?*}result" > /dev/null\n`;
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
					if (definition.name === "review_markdown") tool = definition;
				},
				on: () => {},
			} as any);
			const result = await tool.execute("call", { path: "docs/plan.md" }, undefined, undefined, {
				hasUI: true,
				cwd: repo,
			});
			expect(result.content[0].text).toContain("The reviewer approved the document (docs/plan.md).");
			const html = readFileSync(result.details.saved, "utf8");
			expect(html).toContain('"kind":"markdown-review"');
			expect(html).toContain('"live":false');
		} finally {
			process.env.PATH = saved.path;
			if (saved.agent === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = saved.agent;
			rmSync(bin, { recursive: true, force: true });
			rmSync(agentDir, { recursive: true, force: true });
		}
	});
});
