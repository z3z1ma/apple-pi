import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import browserPages from "../src/index.js";
import {
	buildLedgerPage,
	formatLedgerResult,
	ledgerPassage,
	parseLedgerResult,
	serveEvidence,
} from "../src/ledger-review.js";

const ID = "202610150900-retry-http";
let repo: string;
const write = (path: string, text: string | Buffer) => {
	mkdirSync(dirname(join(repo, path)), { recursive: true });
	writeFileSync(join(repo, path), text);
};

beforeEach(() => {
	repo = mkdtempSync(join(tmpdir(), "browser-pages-ledger-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	const b = `.ledger/${ID}`;
	write(
		`${b}/task.md`,
		"Status: ready\nCreated: 2026-10-15\nUpdated: 2026-10-15\n\n# Retry HTTP calls\n\n## Intent\n\nRetry safely.\n",
	);
	write(`${b}/retrospective.md`, "# Retrospective\n\nNothing yet.\n");
	write(`${b}/spec.md`, "# Spec\n\n## Rules\n\nRetry 503.\n");
	write(`${b}/notes.md`, "# Notes\n\nA note.\n");
	write(
		`${b}/tickets/02-runner.md`,
		"# 02: Runner\n\n**Blocked by:** 01: Policy.\n\n**Status:** ready-for-agent\n\n- [ ] Runs\n",
	);
	write(`${b}/tickets/01-policy.md`, "# 01: Policy\n\n**Blocked by:** None.\n\n**Status:** done\n\n- [x] Exists\n");
	write(`${b}/evidence/run.json`, '{\n  "ok": true,\n  "runs": 3\n}\n');
	write(`${b}/evidence/blob.bin`, Buffer.from([1, 0, 2]));
	write(".ledger/history/202609010000-old/task.md", "# Old task\n");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const build = async (task = ID, cwd = repo) => (await buildLedgerPage({ task }, cwd, "token")).page;

describe("buildLedgerPage", () => {
	it("finds the bundle by id, by its path, by a path inside it, and in history", async () => {
		expect((await build()).path).toBe(`.ledger/${ID}`);
		expect((await build(`.ledger/${ID}`)).path).toBe(`.ledger/${ID}`);
		expect((await build("tickets/02-runner.md", join(repo, ".ledger", ID))).path).toBe(`.ledger/${ID}`);
		expect((await build("202609010000-old")).title).toBe("Old task");
		await expect(build("202601010000-missing")).rejects.toThrow('No ledger task "202601010000-missing"');
	});

	it("lists documents in reading order, other files as evidence, and the tickets", async () => {
		const page = await build();
		expect(page.documents.map((d) => d.path)).toEqual([
			"task.md",
			"spec.md",
			"notes.md",
			"tickets/01-policy.md",
			"tickets/02-runner.md",
			"retrospective.md",
		]);
		expect(page.evidence).toEqual([
			{ path: "evidence/blob.bin", bytes: 3 },
			{ path: "evidence/run.json", bytes: 30 },
		]);
		expect(page).toMatchObject({ title: "Retry HTTP calls", status: "ready", created: "2026-10-15" });
		expect(page.tickets.map((t) => [t.id, t.blockers, t.status])).toEqual([
			[1, [], "done"],
			[2, [1], "ready-for-agent"],
		]);
	});
});

describe("evidence files", () => {
	it("serves only files the page lists, highlighted, and says when a file is not text", async () => {
		const page = await build();
		const dir = join(repo, ".ledger", ID);
		const served = await serveEvidence(page, dir, "evidence/run.json");
		expect(served?.lines?.map((l) => l.map((s) => s.t).join(""))).toEqual(["{", '  "ok": true,', '  "runs": 3', "}"]);
		expect(await serveEvidence(page, dir, "evidence/blob.bin")).toEqual({ lines: undefined, binary: true });
		expect(await serveEvidence(page, dir, "task.md")).toBeUndefined();
		expect(await serveEvidence(page, dir, "../../../etc/passwd")).toBeUndefined();
	});
});

describe("results", () => {
	it("accepts annotations on documents and on served evidence lines, and rejects anything else whole", async () => {
		const page = await build();
		const spec = page.documents.find((d) => d.path === "spec.md")!;
		const rule = spec.blocks.find((b) => b.raw === "Retry 503.")!.id;
		const valid = {
			verdict: "changes",
			annotations: [
				{
					type: "comment",
					file: "spec.md",
					spans: [{ block: rule, start: 0, end: 5 }],
					quote: "Retry",
					text: "Which?",
				},
			],
			edits: [{ file: "spec.md", block: rule, after: "Retry 502 and 503." }],
			opened: ["task.md", "spec.md"],
		};
		expect(parseLedgerResult(valid, page)).toMatchObject({ verdict: "changes", opened: ["task.md", "spec.md"] });
		const onEvidence = {
			...valid,
			annotations: [{ type: "delete", file: "evidence/run.json", spans: [{ block: "l3" }] }],
		};
		expect(parseLedgerResult(onEvidence, page)).toBeUndefined();
		await serveEvidence(page, join(repo, ".ledger", ID), "evidence/run.json");
		expect(parseLedgerResult(onEvidence, page)).toBeDefined();
		for (const broken of [
			{ ...onEvidence, annotations: [{ type: "delete", file: "evidence/run.json", spans: [{ block: "l9" }] }] },
			{ ...valid, annotations: [{ type: "comment", file: "nope.md", spans: [{ block: rule }] }] },
			{ ...valid, edits: [{ file: "evidence/run.json", block: "l1", after: "x" }] },
			{ ...valid, opened: ["../outside.md"] },
			{ ...valid, opened: undefined },
		])
			expect(parseLedgerResult(broken, page)).toBeUndefined();
	});

	it("tells the model each annotation with its repository path and lines, rewrites, and what went unopened", async () => {
		const page = await build();
		await serveEvidence(page, join(repo, ".ledger", ID), "evidence/run.json");
		const spec = page.documents.find((d) => d.path === "spec.md")!;
		const rule = spec.blocks.find((b) => b.raw === "Retry 503.")!.id;
		const result = parseLedgerResult(
			{
				verdict: "approve_notes",
				annotations: [
					{
						type: "comment",
						file: "spec.md",
						spans: [{ block: rule, start: 0, end: 5 }],
						quote: "Retry",
						text: "Which?",
					},
					{
						type: "label",
						label: "clarify",
						file: "evidence/run.json",
						spans: [{ block: "l3", start: 2, end: 8 }],
						quote: '"runs"',
					},
				],
				edits: [{ file: "spec.md", block: rule, after: "Retry 502 and 503." }],
				opened: ["task.md", "spec.md", "tickets/01-policy.md", "evidence/run.json"],
			},
			page,
		)!;
		const text = formatLedgerResult(page, result, "/saved.html");
		expect(text).toContain(`The reviewer approved the task with notes: apply the annotations (.ledger/${ID}).`);
		expect(text).toContain(`- comment · .ledger/${ID}/spec.md:5 “Retry”: Which?`);
		expect(text).toContain(`- ❓ clarify this · .ledger/${ID}/evidence/run.json:3 “"runs"”`);
		expect(text).toContain(`- .ledger/${ID}/spec.md:5\n  before:\n  | Retry 503.\n  after:\n  | Retry 502 and 503.`);
		expect(text).toContain("The reviewer did not open: notes.md, tickets/02-runner.md, retrospective.md.");
		expect(ledgerPassage(page, "evidence/run.json", [{ block: "l2" }, { block: "l3" }], undefined)).toEqual({
			where: `.ledger/${ID}/evidence/run.json:2-3`,
			excerpt: '  "ok": true,\n  "runs": 3',
		});
	});
});

describe("review_ledger_task tool", () => {
	// A page server, a browser subprocess, and a cold Shiki start: slower than 5 s under full-suite load.
	it("opens the page, serves an evidence file, and saves the page with it and the result", {
		timeout: 30_000,
	}, async () => {
		const bin = mkdtempSync(join(tmpdir(), "browser-pages-bin-"));
		const agentDir = mkdtempSync(join(tmpdir(), "browser-pages-agent-"));
		// A stand-in browser: it opens one evidence file, then approves.
		const browser = `#!/bin/sh\nurl="$1"\nbase="\${url%%\\?*}"\ntoken="\${url##*t=}"\ncurl -s -H "x-page-token: $token" "\${base}file?path=evidence/run.json" > /dev/null\ncurl -s -X POST -H "x-page-token: $token" -H "content-type: application/json" --data '{"verdict":"approve","annotations":[],"edits":[],"opened":["task.md","evidence/run.json"]}' "\${base}result" > /dev/null\n`;
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
					if (definition.name === "review_ledger_task") tool = definition;
				},
				on: () => {},
			} as any);
			const result = await tool.execute("call", { task: ID }, undefined, undefined, { hasUI: true, cwd: repo });
			expect(result.content[0].text).toContain(`The reviewer approved the task (.ledger/${ID}).`);
			const html = readFileSync(result.details.saved, "utf8");
			const data = JSON.parse(/<script id="page-data" type="application\/json">(.*?)<\/script>/s.exec(html)![1]);
			expect(data).toMatchObject({
				kind: "ledger-review",
				session: { live: false },
				result: { opened: ["task.md", "evidence/run.json"] },
			});
			const evidence = data.evidence.find((e: { path: string }) => e.path === "evidence/run.json");
			expect(evidence.lines.map((l: { t: string }[]) => l.map((seg) => seg.t).join(""))).toContain('  "runs": 3');
		} finally {
			process.env.PATH = saved.path;
			if (saved.agent === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = saved.agent;
			rmSync(bin, { recursive: true, force: true });
			rmSync(agentDir, { recursive: true, force: true });
		}
	});
});
