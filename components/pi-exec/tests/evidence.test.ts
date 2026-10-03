import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as pi from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import runtime from "../src/index.js";
import {
	containsContextMarks,
	EVIDENCE_FUNCTION_NAMES,
	evidencePythonStubs,
	fitContext,
	runEvidenceFunction,
} from "../src/evidence.js";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof pi>();
	return { ...actual, getShellConfig: vi.fn(actual.getShellConfig) };
});

let cwd: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
const call = (name: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<any> =>
	runEvidenceFunction(name, args, { cwd, signal });
const put = (path: string, text: string) => writeFileSync(join(cwd, path), text);

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "pi-evidence-"));
	git("init", "-q");
	git("config", "user.email", "tests@example.invalid");
	git("config", "user.name", "Tests");
	put("feature.ts", "export const value = 1;\n");
	git("add", ".");
	git("commit", "-qm", "initial");
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

describe("public evidence library", () => {
	it("exposes dirty git evidence through the registered, budgeted Python tool", async () => {
		put("feature.ts", "export const value = 2;\n");
		const manager = pi.SessionManager.inMemory(cwd);
		let tool: pi.ToolDefinition<any, any> | undefined;
		runtime({
			registerTool(definition: pi.ToolDefinition<any, any>) {
				if (definition.name === "pi_exec") tool = definition;
			},
			appendEntry(type: string, data: unknown) {
				manager.appendCustomEntry(type, data);
			},
			on() {},
		} as unknown as pi.ExtensionAPI);
		const result = await tool!.execute(
			"dirty-git",
			{
				code: 'change = await git_change()\n{"files": change["changedFiles"], "patch": change["patch"], "additions": change["additions"], "deletions": change["deletions"]}',
			},
			undefined,
			undefined,
			{ cwd, sessionManager: manager, hasUI: false } as unknown as pi.ExtensionToolContext,
		);
		if (result.content[0]?.type !== "text") throw new Error("Expected a text result");
		expect(JSON.parse(result.content[0].text)).toEqual({
			files: ["feature.ts"],
			patch: git("diff", "--no-ext-diff", "--unified=3", "HEAD"),
			additions: 1,
			deletions: 1,
		});
		expect(result.details.trace.operations).toMatchObject([{ ref: "evidence.git_change", outcome: "succeeded" }]);
	});

	it("matches real git diff for staged, unstaged, renamed, binary, and untracked evidence", async () => {
		put("feature.ts", "export const value = 2;\nconst stage = true;\n");
		git("add", ".");
		put("feature.ts", "export const value = 3;\nconst stage = true;\nconst dirty = true;\n");
		put("new ' file.ts", "untracked\n");
		const change = await call("git_change");
		expect(change.patch).toBe(git("diff", "--no-ext-diff", "--unified=3", "HEAD"));
		expect(change.changedFiles).toEqual(["feature.ts"]);
		expect(change.untrackedFiles).toEqual(["new ' file.ts"]);
		expect(change).toMatchObject({ additions: 3, deletions: 1, status: { dirty: true } });
		expect(change.statusText).toContain("MM feature.ts");
		expect(await call("git_patch", { paths: ["feature.ts"] })).toBe(change.patch);
		git("add", ".");
		git("commit", "-qm", "second");
		git("mv", "feature.ts", "renamed feature.ts");
		put("binary", "\0\x01");
		git("add", "binary");
		const renamed = await call("git_change");
		expect(renamed.renames).toEqual([{ status: "R100", code: "R", from: "feature.ts", path: "renamed feature.ts" }]);
		expect(renamed).toMatchObject({ additions: 0, deletions: 0 });
		expect(renamed.changedFiles).toEqual(expect.arrayContaining(["feature.ts", "renamed feature.ts", "binary"]));
	});

	it("resolves committed boundaries without including unrelated untracked files and rejects bad revisions", async () => {
		put("feature.ts", "changed\n");
		git("commit", "-am", "change");
		put("untracked", "local");
		const change = await call("git_change", { compare: "HEAD~1...HEAD" });
		expect(change.changedFiles).toEqual(["feature.ts"]);
		expect(change.untrackedFiles).toEqual([]);
		await expect(call("git_change", { compare: "does-not-exist" })).rejects.toThrow();
		await expect(call("git_change", { compare: "--output=oops" })).rejects.toThrow("not an option");
	});

	it("fits JSON-roundtripped marks, preserves required data, and reports every clipped/dropped path", async () => {
		const value = {
			contract: await call("context_required", { value: "must retain" }),
			patch: await call("context_clippable", { value: 'quoted "\n'.repeat(10_000), priority: 1 }),
			notes: await call("context_droppable", { value: "optional".repeat(10_000) }),
		};
		expect(containsContextMarks(value)).toBe(true);
		const fitted = fitContext(JSON.parse(JSON.stringify(value)), {
			max_serialized_chars: 1000,
			flags: { patchTruncated: "$.patch" },
		});
		expect(fitted.value).toMatchObject({ contract: "must retain", patchTruncated: true });
		expect(fitted).toMatchObject({ truncated: ["$.patch"], dropped: ["$.notes"] });
		expect(fitted.serializedChars).toBeLessThanOrEqual(1000);
		expect(containsContextMarks(fitted.value)).toBe(false);
		expect(() => fitContext({ required: "x".repeat(1001) }, { max_serialized_chars: 1000 })).toThrow("required data");
		await expect(call("context_clippable", { value: 42 })).rejects.toThrow("string");
	});

	it("packs high-priority evidence first with visible omissions and field clipping", async () => {
		const packed = await call("context_pack", {
			items: [
				{ id: "low", priority: 0, evidence: "x".repeat(40) },
				{ id: "high", priority: 3, evidence: "y".repeat(40) },
			],
			fields: { evidence: 20 },
			max_serialized_chars: 90,
		});
		expect(packed.items.map((item: any) => item.id)).toEqual(["high"]);
		expect(packed.omittedIds).toEqual(["low"]);
		expect(packed.clipped).toEqual(["$[0].evidence", "$[1].evidence"]);
		await expect(call("context_pack", { items: [], max_serialized_chars: 1 })).rejects.toThrow();
	});

	it("finds repository config, matching tests outside src, and bounded definition/reference evidence", async () => {
		mkdirSync(join(cwd, "tests"));
		put("tests/feature.test.ts", "assert(value);\n");
		put("AGENTS.md", "rules\n");
		put("feature.ts", "export const feature = 2;\n");
		const nearby = await call("repo_change_neighborhood", {
			paths: ["feature.ts"],
			include: ["tests", "config", "definitions", "references"],
		});
		expect(nearby.tests["feature.ts"]).toEqual(["tests/feature.test.ts"]);
		expect(nearby.config["feature.ts"]).toContain("AGENTS.md");
		expect(nearby.definitions["feature.ts"]).toContainEqual({
			path: "feature.ts",
			line: 1,
			text: "export const feature = 2;",
		});
		put("large.txt", " ".repeat(1_000_001));
		await expect(call("repo_change_neighborhood", { paths: ["feature.ts"], include: ["references"] })).rejects.toThrow(
			"scan budget",
		);
	});

	it("bounds aggregate reference scan work even when individual files are below the size limit", async () => {
		for (let index = 0; index < 34; index++) put(`changed-${index}.ts`, `const symbol${index} = 1;\n`);
		put("large.txt", " ".repeat(999_999));
		await expect(call("repo_change_neighborhood", { include: ["references"] })).rejects.toThrow("scan budget");
	});

	it("bounds aggregate test-neighborhood evidence even when each source has at most 256 matches", async () => {
		for (let index = 0; index < 256; index++) {
			const directory = `suite-${index}-long-neighborhood-name`;
			mkdirSync(join(cwd, directory));
			put(`${directory}/feature.test.ts`, "test\n");
		}
		await expect(call("dev_find_relevant_tests")).rejects.toThrow("2 MB of evidence");
	});

	it("indexes dotted test names without matching unrelated stems", async () => {
		put("feature.extra.ts", "changed\n");
		put("feature.extra.test.ts", "test\n");
		put("feature.test.ts", "other test\n");
		const nearby = await call("dev_find_relevant_tests", { paths: ["feature.extra.ts"] });
		expect(nearby.tests["feature.extra.ts"]).toEqual(["feature.extra.test.ts"]);
	});

	it("reports not_run rather than success when no tests or runner exist", async () => {
		put("feature.ts", "changed\n");
		expect(await call("dev_run_relevant_tests")).toMatchObject({
			status: "not_run",
			reason: "No neighboring tests discovered",
			selectedTests: [],
		});
		put("feature.test.ts", "test\n");
		expect(await call("dev_run_relevant_tests")).toMatchObject({
			status: "not_run",
			reason: "No explicit command template and no package test script found",
		});
	});

	it("runs only selected test paths with quoting, exposes failures, and honors bounds/cancellation", async () => {
		put("feature.ts", "changed\n");
		put("feature.test.ts", "test\n");
		const passed = await call("dev_run_relevant_tests", { paths: ["feature.ts"], command: "printf '%s\\n' {tests}" });
		expect(passed).toMatchObject({ status: "passed", output: "feature.test.ts\n", selectedTests: ["feature.test.ts"] });
		expect(await call("dev_run_relevant_tests", { command: "printf '%s' {tests}; exit 4" })).toMatchObject({
			status: "failed",
		});
		await expect(call("dev_run_relevant_tests", { command: "npm test" })).rejects.toThrow("placeholder");
		put("feature.spec.ts", "test\n");
		await expect(call("dev_run_relevant_tests", { max_tests: 1 })).rejects.toThrow("exceeding max_tests");
		await expect(
			call("dev_run_relevant_tests", { command: "sleep 5; printf '%s' {tests}", timeout: 0.05 }),
		).rejects.toThrow("timed out");
		const controller = new AbortController();
		const pending = call("dev_run_relevant_tests", { command: "sleep 5; printf '%s' {tests}" }, controller.signal);
		setTimeout(() => controller.abort(), 100);
		await expect(pending).rejects.toThrow(/abort/i);
	});

	it("quotes discovered filenames and does not execute deleted tests", async () => {
		put("quote' space.ts", "source\n");
		put("quote' space.test.ts", "test\n");
		put("feature.test.ts", "old test\n");
		git("add", ".");
		git("commit", "-qm", "tests");
		put("quote' space.ts", "changed source\n");
		put("feature.ts", "changed\n");
		rmSync(join(cwd, "feature.test.ts"));
		const result = await call("dev_run_relevant_tests", { command: "printf '%s\\n' {tests}" });
		expect(result).toMatchObject({
			status: "passed",
			output: "quote' space.test.ts\n",
			selectedTests: ["quote' space.test.ts"],
		});
	});

	it("uses Pi's resolved shell with either argv or stdin command transport", async () => {
		put("feature.ts", "changed\n");
		put("feature.test.ts", "test\n");
		const shell = vi.mocked(pi.getShellConfig);
		try {
			for (const transport of ["argv", "stdin"] as const) {
				shell.mockReturnValue({
					shell: process.execPath,
					args: transport === "argv" ? ["-e"] : [],
					commandTransport: transport,
				});
				const result = await call("dev_run_relevant_tests", { paths: ["feature.ts"], command: "console.log({tests})" });
				expect(result).toMatchObject({ status: "passed", output: "feature.test.ts\n" });
			}
		} finally {
			shell.mockRestore();
		}
	});

	it("has no coverage or reconcile guest functions", async () => {
		expect(evidencePythonStubs()).not.toMatch(/coverage|reconcile/);
		expect(EVIDENCE_FUNCTION_NAMES).not.toContain("coverage_compare");
		await expect(call("reconcile_by_id")).rejects.toThrow("Unknown evidence function");
	});
});
