import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import registerTasks from "../../tasks/src/index.js";
import { runBranchSearch, type SearchOptions, type SearchResult } from "../src/orchestrator.js";
import type { SearchRecord } from "../src/record.js";
import type { ScorerSpec } from "../src/scorer.js";
import {
	type Behavior,
	FIX,
	finish,
	gitOut,
	initFixtureRepo,
	scriptedModel,
	text,
	validConfig,
	WRONG,
	withOutput,
	write,
} from "./fixtures.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const dispose of cleanup.splice(0)) dispose();
});

const SEED = new Uint8Array(32).fill(42);

const SCORER: ScorerSpec = {
	version: 1,
	goal: "value is 2",
	files: [{ path: "hidden/gate.sh", content: "bash check.sh\n" }],
	protect: ["check.sh"],
	gates: [{ id: "value", run: "bash hidden/gate.sh", onBase: "fail", timeoutSec: 30 }],
	objectives: [],
};

async function fixture(
	behaviors: Record<string, Behavior>,
	options: {
		git?: "none" | "empty";
		enumerator?: () => Reply | "until-aborted";
		author?: Reply[];
		parentPrompt?: string;
	} = {},
) {
	const model = scriptedModel(behaviors, options.enumerator, options.author);
	const run = await fauxSession([registerTasks], (context) => model(context), ["read", "write", "edit", "ls", "bash"]);
	cleanup.push(run.dispose);
	const cwd = realpathSync(run.cwd);
	if (options.git === "empty") gitOut(cwd, "init", "-q");
	if (options.git === undefined) initFixtureRepo(cwd);
	await run.session.prompt(options.parentPrompt ?? "Make value equal 2.");
	return { ...run, cwd };
}

interface SearchRun {
	result: SearchResult;
	statuses: (string | undefined)[];
	record: SearchRecord;
}

async function search(
	run: Awaited<ReturnType<typeof fixture>>,
	overrides: { config?: Record<string, unknown>; signal?: AbortSignal } & Partial<
		Pick<SearchOptions, "scorer" | "review" | "exclusive">
	> & { authored?: boolean } = {},
	onStatus?: (status: string | undefined) => void,
): Promise<SearchRun> {
	const statuses: (string | undefined)[] = [];
	const result = await runBranchSearch({
		mode: "human",
		session: run.session,
		cwd: run.cwd,
		config: { ...validConfig(), ...overrides.config },
		scorer: overrides.authored ? undefined : (overrides.scorer ?? SCORER),
		review: overrides.review,
		exclusive: overrides.exclusive ?? (async () => () => {}),
		goal: "Make value equal 2.",
		signal: overrides.signal ?? new AbortController().signal,
		onStatus: (status) => {
			statuses.push(status);
			onStatus?.(status);
		},
		seed: SEED,
	});
	const record = result.recordPath ? JSON.parse(readFileSync(result.recordPath, "utf8")) : undefined;
	return { result, statuses, record };
}

function searchRefs(cwd: string): string[] {
	return gitOut(cwd, "for-each-ref", "--format=%(refname)", "refs/apple-pi/").split("\n").filter(Boolean);
}

function worktrees(cwd: string): string[] {
	return gitOut(cwd, "worktree", "list", "--porcelain")
		.split("\n")
		.filter((line) => line.startsWith("worktree "));
}

function expectCleanedUp(cwd: string, record: SearchRecord, keep: string[]) {
	expect(worktrees(cwd)).toEqual([`worktree ${cwd}`]);
	expect(searchRefs(cwd).sort()).toEqual(keep.map((key) => `refs/apple-pi/branch-search/${record.id}/${key}`).sort());
	const stateDir = join(cwd, ".git", "apple-pi", "branch-search", record.id);
	expect(existsSync(join(stateDir, "wt"))).toBe(false);
	expect(existsSync(join(stateDir, "record.json"))).toBe(true);
	expect(record.cleanupErrors).toEqual([]);
}

function branchOf(record: SearchRecord, candidate: string) {
	const branch = record.branches.find((entry) => entry.candidate === candidate);
	if (!branch) throw new Error(`no branch ran ${candidate}`);
	return branch;
}

// Each case drives real git and several forks; under full-suite load that exceeds the 5s default.
describe("generation-0 branch search", { timeout: 30_000 }, () => {
	it("ends ready with the passing root as winner, scores protected files at base, and cleans up", async () => {
		const run = await fixture({
			// Edits the protected check to pass; scoring restores it, so this branch still fails.
			c1: [WRONG, write("check.sh", "exit 0\n", "cheat"), finish("done", "the check is easy to satisfy")],
			c2: [FIX, finish("done", "value 2 works")],
		});
		writeFileSync(join(run.cwd, "app.ts"), "export const value = 1; // uncommitted\n");
		writeFileSync(join(run.cwd, "notes.md"), "untracked\n");
		const index = readFileSync(join(run.cwd, ".git", "index"));
		const onDisk: string[] = [];

		const { result, statuses, record } = await search(run, {}, (status) => {
			if (status !== "branching run g0 2/2") return;
			const [stateDir] = readdirSync(join(run.cwd, ".git", "apple-pi", "branch-search"));
			const dir = join(run.cwd, ".git", "apple-pi", "branch-search", stateDir as string);
			onDisk.push(...readdirSync(dir), ...readdirSync(join(dir, "wt")), readFileSync(join(dir, "record.json"), "utf8"));
		});

		// While branches run, no scorer content is on disk (spec 8.4).
		expect(onDisk).toContain("record.json");
		expect(onDisk).not.toContain("spec.json");
		expect(onDisk).not.toContain("validate");
		expect(onDisk.join("\n")).not.toMatch(/"gates"|hidden\/gate\.sh|"status"/);

		expect(result.outcome).toBe("ready");
		const winner = branchOf(record, "c2");
		const loser = branchOf(record, "c1");
		expect(record.winner).toBe(winner.key);
		expect(winner.status).toBe("survived");
		expect(loser.status).toBe("dead");
		expect(loser.gates).toEqual({ value: "fail" });
		expect(gitOut(run.cwd, "show", `${loser.commit}:check.sh`)).toBe("exit 0");

		// Base: uncommitted and untracked files captured; the user's index untouched.
		expect(readFileSync(join(run.cwd, ".git", "index"))).toEqual(index);
		const base = record.base as { commit: string; tree: string };
		expect(gitOut(run.cwd, "show", `${base.commit}:app.ts`)).toContain("uncommitted");
		expect(gitOut(run.cwd, "show", `${base.commit}:notes.md`)).toBe("untracked");

		// Scorer files never land in a branch commit.
		for (const branch of record.branches)
			expect(gitOut(run.cwd, "ls-tree", "-r", "--name-only", branch.commit as string)).not.toContain("hidden/gate.sh");

		// The report's merge command applies the winner's diff cleanly to the base.
		expect(result.report.split("\n")[0]).toBe(
			`Branch search ${record.id}: ready. 1 of 2 branches survived over 1 generations.`,
		);
		expect(result.report).toContain(`Winner: ${winner.key} (c2, constraint: ${winner.constraint}) +1 -1 in 1 files.`);
		expect(result.report).toContain(`Record: ${result.recordPath}`);
		const merge = /^Merge: (.+)$/m.exec(result.report)?.[1] as string;
		expect(merge).toBe(
			`git diff --no-ext-diff --no-textconv --binary ${base.commit} refs/apple-pi/branch-search/${record.id}/${winner.key} | git apply --3way`,
		);
		const check = realpathSync(mkdtempSync(join(tmpdir(), "apple-pi-branch-merge-")));
		cleanup.push(() => rmSync(check, { recursive: true, force: true }));
		gitOut(run.cwd, "worktree", "add", "--detach", "-q", join(check, "wt"), base.commit);
		execFileSync("bash", ["-c", merge], { cwd: join(check, "wt"), stdio: "pipe" });
		expect(readFileSync(join(check, "wt", "app.ts"), "utf8")).toBe("export const value = 2;\n");
		gitOut(run.cwd, "worktree", "remove", "--force", join(check, "wt"));

		// The parent workspace is unchanged across the generation.
		expect(readFileSync(join(run.cwd, "app.ts"), "utf8")).toContain("uncommitted");
		expect(record.parentTreeChecks).toEqual([
			{ phase: "before g0", tree: base.tree },
			{ phase: "after g0", tree: base.tree },
		]);

		// Every branch with parent, order, and cost; every planning step.
		for (const branch of record.branches) {
			expect(branch.parent).toBeNull();
			expect(branch.generation).toBe(0);
			expect(branch.startSeq).toBeTypeOf("number");
			expect(branch.endSeq).toBeGreaterThan(branch.startSeq);
			expect(branch.cost).toEqual(
				expect.objectContaining({ outputTokens: expect.any(Number), runMs: expect.any(Number) }),
			);
			expect(branch.selfReport).toBe("done");
		}
		expect(new Set(record.branches.flatMap((b) => [b.startSeq, b.endSeq])).size).toBe(4);
		expect(record.enumerations).toEqual([
			expect.objectContaining({ key: "root", preferred: "c1", cost: expect.any(Object) }),
		]);
		expect(record.steps.map((step) => step.step.kind)).toEqual(["run", "stop"]);
		expect(record.steps[1]?.step).toEqual({ kind: "stop", outcome: "survivor" });
		expect(record.cost.total).toBeDefined();
		expect(record.outcome).toBe("ready");
		expect(record.spec?.path).toBe("spec.json");

		// Status while running, cleared after cleanup.
		expect(statuses).toContain("branching enumerate 0/0");
		expect(statuses).toContain("branching run g0 2/2");
		expect(statuses).toContain("branching score g0 1/2");
		expect(statuses.at(-1)).toBeUndefined();
		expect(statuses.slice(0, -1).every((status) => /^branching \S+( g\d+)? \d+\/\d+$/.test(status as string))).toBe(
			true,
		);

		expectCleanedUp(run.cwd, record, ["base", winner.key]);
	});

	it("refuses scorer files that a branch symlink leads outside the worktree, and the branch dies", async () => {
		// wt/<key> sits six levels below the parent: .git/apple-pi/branch-search/<id>/wt/<key>.
		const link = fauxAssistantMessage(
			fauxToolCall("bash", { command: "ln -s ../../../../../.. link", verbatim: true }, { id: "link" }),
			{ stopReason: "toolUse" },
		);
		const run = await fixture({ c1: [link, FIX, finish("done", "linked")], c2: [FIX, finish("done", "plain")] });
		const check = readFileSync(join(run.cwd, "check.sh"), "utf8");
		const scorer: ScorerSpec = {
			...SCORER,
			files: [{ path: "link/check.sh", content: "exit 0\n" }],
			gates: [{ id: "value", run: "bash check.sh", onBase: "fail", timeoutSec: 30 }],
		};
		const { result, record } = await search(run, { scorer });

		const linked = branchOf(record, "c1");
		expect(gitOut(run.cwd, "ls-tree", linked.commit as string, "link")).toMatch(/^120000/);
		expect(readFileSync(join(run.cwd, "check.sh"), "utf8")).toBe(check);
		expect(linked.status).toBe("dead");
		expect(linked.gates).toEqual({ value: "fail" });
		expect(linked.gateOutput?.value?.stderr).toContain("outside the worktree");
		expect(branchOf(record, "c2").status).toBe("survived");
		expect(result.outcome).toBe("ready");
		expectCleanedUp(run.cwd, record, ["base", record.winner as string]);
	});

	it("reports a merge command that carries a binary addition", async () => {
		const binary = fauxAssistantMessage(
			fauxToolCall("bash", { command: "printf '\\000\\001\\002\\377' > image.bin", verbatim: true }, { id: "bin" }),
			{ stopReason: "toolUse" },
		);
		const run = await fixture({ c1: [binary, FIX, finish("done", "binary")], c2: [WRONG, finish("done", "three")] });
		const { result, record } = await search(run);

		expect(result.outcome).toBe("ready");
		const base = (record.base as { commit: string }).commit;
		const merge = /^Merge: (.+)$/m.exec(result.report)?.[1] as string;
		const check = realpathSync(mkdtempSync(join(tmpdir(), "apple-pi-branch-merge-")));
		cleanup.push(() => rmSync(check, { recursive: true, force: true }));
		gitOut(run.cwd, "worktree", "add", "--detach", "-q", join(check, "wt"), base);
		execFileSync("bash", ["-c", merge], { cwd: join(check, "wt"), stdio: "pipe" });
		expect([...readFileSync(join(check, "wt", "image.bin"))]).toEqual([0, 1, 2, 255]);
		gitOut(run.cwd, "worktree", "remove", "--force", join(check, "wt"));
	});

	it("ends no survivor when every root fails a gate", async () => {
		const run = await fixture({
			c1: [WRONG, finish("done", "three")],
			c2: [WRONG, finish("abandoned", "also three")],
		});
		const { result, record } = await search(run);

		expect(result.outcome).toBe("no survivor");
		expect(record.winner).toBeNull();
		expect(record.branches.map((branch) => branch.status)).toEqual(["dead", "dead"]);
		expect(result.report).toContain("0 of 2 branches survived");
		expect(result.report).toMatch(/dead \(gates passed 0\/1\) abandoned: also three/);
		expectCleanedUp(run.cwd, record, ["base"]);
	});

	it("aborts branches that exceed a limit, reports limit or error, and still scores their commits", async () => {
		const run = await fixture({
			slow: [FIX, "until-aborted"],
			verbose: [withOutput(FIX, 5000), finish("done", "verbose")],
			broken: [FIX, { ...fauxAssistantMessage(""), stopReason: "error", errorMessage: "provider exploded" }],
		});
		const { result, record } = await search(run, {
			config: {
				branches: { perGeneration: 3, maxTotal: 6 },
				branch: { limits: { wallClockSec: 1, outputTokens: 1000 } },
			},
		});

		const slow = branchOf(record, "slow");
		expect(slow.selfReport).toBe("limit");
		expect(slow.commit).toBeTruthy();
		expect(slow.status).toBe("survived");
		expect(gitOut(run.cwd, "show", `${slow.commit}:app.ts`)).toBe("export const value = 2;");
		const verbose = branchOf(record, "verbose");
		expect(verbose.selfReport).toBe("limit");
		expect(verbose.cost.outputTokens).toBeGreaterThan(1000);
		expect(verbose.gates).toBeDefined();
		const broken = branchOf(record, "broken");
		expect(broken.selfReport).toBe("error");
		expect(broken.status).toBe("survived");
		expect(result.outcome).toBe("ready");
		expectCleanedUp(run.cwd, record, ["base", record.winner as string]);
	});

	it("cleans up after cancellation through the abort signal", async () => {
		const run = await fixture({ c1: ["until-aborted"], c2: [FIX, "until-aborted"] });
		const controller = new AbortController();
		const { result, record, statuses } = await search(run, { signal: controller.signal }, (status) => {
			if (status === "branching run g0 2/2") setTimeout(() => controller.abort(), 50);
		});

		expect(result.outcome).toBe("aborted: cancelled");
		expect(record.outcome).toBe("aborted: cancelled");
		expect(record.winner).toBeNull();
		expect(statuses.at(-1)).toBeUndefined();
		expectCleanedUp(run.cwd, record, ["base"]);
	});

	it("starts no fork after cancellation during preparation", async () => {
		const run = await fixture({}, { enumerator: () => "until-aborted" });
		const controller = new AbortController();
		const { result, record } = await search(run, { signal: controller.signal }, (status) => {
			if (status === "branching enumerate 0/0") controller.abort();
		});

		expect(result.outcome).toBe("aborted: cancelled");
		expect(run.requests.some((request) => text(request.messages.at(-1)).includes("approach list"))).toBe(false);
		expectCleanedUp(run.cwd, record, ["base"]);
	});

	it("cleans up after an injected error", async () => {
		// A directory where the scorer installs a file makes installing it fail while scoring.
		const blocker = fauxAssistantMessage(
			fauxToolCall("bash", { command: "mkdir -p hidden/gate.sh", verbatim: true }, { id: "dir" }),
			{ stopReason: "toolUse" },
		);
		const run = await fixture({ c1: [blocker, FIX, finish("done", "two")], c2: [WRONG, finish("done", "three")] });
		const { result, record, statuses } = await search(run);

		expect(result.outcome).toBe("aborted: error");
		expect(record.abortReason).toMatch(/EISDIR|directory/);
		expect(result.report).toContain("Reason:");
		expect(statuses.at(-1)).toBeUndefined();
		expectCleanedUp(run.cwd, record, ["base"]);
	});

	it("ends aborted: enumeration failed after a second unusable approach list, and cleans up", async () => {
		const run = await fixture({}, { enumerator: () => fauxAssistantMessage("I would just try c1.") });
		const { result, record } = await search(run);

		expect(result.outcome).toBe("aborted: enumeration failed");
		const retries = run.requests.filter((request) => text(request.messages.at(-1)).includes("could not be used"));
		expect(retries).toHaveLength(1);
		expect(record.branches).toEqual([]);
		expectCleanedUp(run.cwd, record, ["base"]);
	});

	it("gives the same roots and constraints for the same seed and candidate list", async () => {
		const behaviors = { c1: [FIX], c2: [FIX], c3: [FIX], c4: [FIX] };
		const run = await fixture(behaviors);
		const config = { branches: { perGeneration: 2, maxTotal: 6 }, constraints: ["one", "two", "three"] };
		const first = await search(run, { config });
		const second = await search(run, { config });
		const assignments = (record: SearchRecord) =>
			record.branches.map(({ key, candidate, constraint }) => ({ key, candidate, constraint }));

		expect(assignments(first.record)).toHaveLength(2);
		expect(assignments(second.record)).toEqual(assignments(first.record));
	});

	it("applies the winner to an unchanged workspace with apply auto and keeps the patch", async () => {
		const run = await fixture({ c1: [FIX, finish("done", "two")], c2: [WRONG, finish("done", "three")] });
		const { result, record } = await search(run, { config: { apply: "auto" } });

		expect(result.outcome).toBe("applied");
		expect(record.outcome).toBe("applied");
		expect(readFileSync(join(run.cwd, "app.ts"), "utf8")).toBe("export const value = 2;\n");
		const patch = join(run.cwd, ".git", "apple-pi", "branch-search", record.id, "winner.patch");
		expect(readFileSync(patch, "utf8")).toContain("value = 2");
		expect(record.apply).toEqual({ applied: true, workspaceTree: record.base?.tree });
		expect(result.report.split("\n")[0]).toBe(
			`Branch search ${record.id}: applied. 1 of 2 branches survived over 1 generations.`,
		);
		expect(result.report).not.toContain("Merge:");
		expectCleanedUp(run.cwd, record, ["base", record.winner as string]);
	});

	it("ends ready and leaves every workspace file untouched when the workspace changed during the search", async () => {
		const run = await fixture({ c1: [FIX, finish("done", "two")], c2: [WRONG, finish("done", "three")] });
		const { result, record } = await search(run, { config: { apply: "auto" } }, (status) => {
			if (status === "branching run g0 2/2") writeFileSync(join(run.cwd, "notes.md"), "written meanwhile\n");
		});

		expect(result.outcome).toBe("ready");
		expect(readFileSync(join(run.cwd, "app.ts"), "utf8")).toBe("export const value = 1;\n");
		expect(readFileSync(join(run.cwd, "notes.md"), "utf8")).toBe("written meanwhile\n");
		expect(existsSync(join(run.cwd, ".git", "apple-pi", "branch-search", record.id, "winner.patch"))).toBe(false);
		expect(record.apply).toEqual(
			expect.objectContaining({ applied: false, reason: "the workspace changed during the search" }),
		);
		expect(result.report).toContain("Not applied: the workspace changed during the search");
		expect(result.report).toMatch(/^Merge: /m);
		expectCleanedUp(run.cwd, record, ["base", record.winner as string]);
	});

	it("ends aborted: scorer invalid before any enumerator runs, and records the validation report", async () => {
		const invalid: [string, ScorerSpec, RegExp][] = [
			[
				"fail gate passes on base",
				{ ...SCORER, gates: [{ id: "value", run: "true", onBase: "fail", timeoutSec: 30 }] },
				/gate value: declared onBase "fail" but passed on the base/,
			],
			[
				"base runs disagree",
				{
					...SCORER,
					gates: [{ id: "value", run: "test -e seen && exit 0; touch seen; exit 1", onBase: "fail", timeoutSec: 30 }],
				},
				/gate value: the two base runs disagree/,
			],
			[
				"objective prints no number",
				{ ...SCORER, objectives: [{ id: "speed", run: "echo fast", better: "lower", timeoutSec: 30 }] },
				/objective speed: printed no finite number/,
			],
		];
		for (const [name, scorer, problem] of invalid) {
			const run = await fixture({ c1: [FIX], c2: [FIX] });
			const { result, record } = await search(run, { scorer });

			expect(result.outcome, name).toBe("aborted: scorer invalid");
			expect(record.spec?.validation, name).toEqual([
				expect.objectContaining({ attempt: 0, ok: false, report: expect.stringMatching(problem) }),
			]);
			expect(result.report, name).toMatch(problem);
			expect(record.enumerations, name).toEqual([]);
			expect(record.branches, name).toEqual([]);
			expectCleanedUp(run.cwd, record, ["base"]);
			expect(run.requests.some((request) => text(request.messages.at(-1)).includes("approach list"))).toBe(false);
		}
	});

	it("writes no scorer content outside the worktree before the enumerator starts, even through base symlinks", async () => {
		const run = await fixture({ c1: [FIX], c2: [FIX] });
		const outside = realpathSync(mkdtempSync(join(tmpdir(), "apple-pi-branch-outside-")));
		cleanup.push(() => rmSync(outside, { recursive: true, force: true }));
		mkdirSync(join(outside, "child"));
		// Committed in the base, so the validate worktree has them before the scorer is installed.
		symlinkSync(join(outside, "child"), join(run.cwd, "pivot"));
		symlinkSync("pivot/../hidden.sh", join(run.cwd, "gate.sh"));
		gitOut(run.cwd, "add", "pivot", "gate.sh");
		gitOut(run.cwd, "commit", "-q", "-m", "links");
		const scorer: ScorerSpec = { ...SCORER, files: [{ path: "gate.sh", content: "bash check.sh\n" }] };
		const { result, record } = await search(run, { scorer });

		expect(result.outcome).toBe("aborted: scorer invalid");
		expect(record.spec?.validation[0]?.report).toMatch(/could not install the scorer: .*outside the worktree/);
		expect(readdirSync(outside)).toEqual(["child"]);
		expect(run.requests.some((request) => text(request.messages.at(-1)).includes("approach list"))).toBe(false);
		expectCleanedUp(run.cwd, record, ["base"]);
	});

	it("ranks survivors by objective, kills a branch whose objective fails, and reports base values", async () => {
		const score = (value: string, id: string) => write("score.txt", value, id);
		const run = await fixture({
			c1: [FIX, score("5\n", "s1"), finish("done", "five")],
			c2: [FIX, score("1\n2\n3\n9\n", "s2"), finish("done", "nine")],
			c3: [FIX, score("oops\n", "s3"), finish("done", "oops")],
		});
		const scorer: ScorerSpec = {
			...SCORER,
			objectives: [
				{ id: "score", run: "tail -n 1 score.txt 2>/dev/null || echo 0", better: "higher", timeoutSec: 30 },
				{ id: "steady", run: "echo 1", better: "lower", timeoutSec: 30, serial: true, repeat: 3 },
			],
		};
		const { result, record } = await search(run, { scorer, config: { branches: { perGeneration: 3, maxTotal: 6 } } });

		expect(result.outcome).toBe("ready");
		const nine = branchOf(record, "c2");
		expect(record.winner).toBe(nine.key);
		// app.ts +1 -1 and four score lines; the lower-scoring c1 has the smaller diff and still loses.
		expect(nine.objectives).toEqual({ score: 9, steady: 1, diff_size: 6 });
		expect(branchOf(record, "c1").objectives?.diff_size).toBe(3);
		expect(branchOf(record, "c1").status).toBe("survived");
		const oops = branchOf(record, "c3");
		expect(oops.status).toBe("dead");
		expect(oops.objectiveOutput?.score?.failure).toMatch(/no finite number/);
		expect(record.spec?.baseValues).toEqual({ score: 0, steady: 1 });
		expect(result.report).toContain("Objectives: score=9 (base 0), steady=1 (base 1), diff_size=6");
		expectCleanedUp(run.cwd, record, ["base", nine.key]);
	});

	it("ends no survivor when no gate fails on base and no survivor beats the first objective's base value", async () => {
		const run = await fixture({
			c1: [FIX, write("score.txt", "0\n", "s1"), finish("done", "zero")],
			c2: [FIX, finish("done", "none")],
		});
		const scorer: ScorerSpec = {
			...SCORER,
			gates: [{ id: "runs", run: "true", onBase: "pass", timeoutSec: 30 }],
			objectives: [{ id: "score", run: "cat score.txt 2>/dev/null || echo 0", better: "higher", timeoutSec: 30 }],
		};
		const { result, record } = await search(run, { scorer });

		expect(record.branches.map((branch) => branch.status)).toEqual(["survived", "survived"]);
		expect(result.outcome).toBe("no survivor");
		expect(record.winner).toBeNull();
		expectCleanedUp(run.cwd, record, ["base"]);
	});

	it("ends aborted: no git history in a workspace without a HEAD commit", async () => {
		for (const git of ["empty", "none"] as const) {
			const run = await fixture({}, { git });
			const before = run.requests.length;
			const { result } = await search(run);
			expect(result.outcome).toBe("aborted: no git history");
			expect(result.report).toContain("aborted: no git history");
			expect(run.requests.length).toBe(before);
		}
	});

	it("stops before any git or model work when a required key is missing, naming each one", async () => {
		const run = await fixture({ c1: [FIX] });
		const before = run.requests.length;
		const config = validConfig();
		delete config.apply;
		delete config.enumerate;
		const result = await runBranchSearch({
			mode: "human",
			session: run.session,
			cwd: run.cwd,
			config,
			scorer: SCORER,
			exclusive: async () => () => {},
			signal: new AbortController().signal,
			onStatus: () => {},
		});

		expect(result.outcome).toBe("not configured");
		expect(result.report).toContain("apply: missing");
		expect(result.report).toContain("enumerate.count: missing");
		expect(result.recordPath).toBeUndefined();
		expect(run.requests.length).toBe(before);
		expect(searchRefs(run.cwd)).toEqual([]);
		expect(existsSync(join(run.cwd, ".git", "apple-pi"))).toBe(false);
	});
});

/** A scorer whose file content and gate command carry markers a branch could search for (spec 8.4, A2). */
const MARKER = "scorer-marker-7f3a";
const AUTHORED: ScorerSpec = {
	version: 1,
	goal: "value is 2",
	files: [{ path: "hidden/gate-7f3a.sh", content: `# ${MARKER}\nbash check.sh\n` }],
	protect: ["check.sh"],
	gates: [{ id: "value", run: "bash hidden/gate-7f3a.sh", onBase: "fail", timeoutSec: 30 }],
	objectives: [],
};

function authorReply(spec: unknown): Reply {
	return fauxAssistantMessage(`\`\`\`json\n${JSON.stringify(spec)}\n\`\`\``);
}

const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

function stateDir(cwd: string, record: SearchRecord): string {
	return join(cwd, ".git", "apple-pi", "branch-search", record.id);
}

function isAuthorRequest(request: Context): boolean {
	return request.messages.some((message) => text(message).includes("Branch search: acceptance checks."));
}

describe("authored scorer", { timeout: 30_000 }, () => {
	it("authors the scorer in a fork, freezes it before the enumerator, and stores exactly the frozen bytes", async () => {
		const run = await fixture(
			{ c1: [WRONG, finish("done", "three")], c2: [FIX, finish("done", "two")] },
			{ author: [authorReply(AUTHORED)] },
		);
		const atEnumerate: { record?: SearchRecord; enumeratorRequests?: number; specOnDisk?: boolean } = {};
		const { result, record } = await search(run, { authored: true }, (status) => {
			if (status !== "branching enumerate 0/0") return;
			const [id] = readdirSync(join(run.cwd, ".git", "apple-pi", "branch-search"));
			const dir = join(run.cwd, ".git", "apple-pi", "branch-search", id as string);
			atEnumerate.record = JSON.parse(readFileSync(join(dir, "record.json"), "utf8"));
			atEnumerate.specOnDisk = existsSync(join(dir, "spec.json"));
			atEnumerate.enumeratorRequests = run.requests.filter((r) =>
				text(r.messages.at(-1)).includes("approach list"),
			).length;
		});

		expect(result.outcome).toBe("ready");
		expect(record.mode).toBe("human");
		const stored = readFileSync(join(stateDir(run.cwd, record), "spec.json"));
		expect(JSON.parse(stored.toString("utf8"))).toEqual(AUTHORED);
		expect(record.spec?.sha256).toBe(sha256(stored));
		// Recorded before any enumerator request, without scorer content on disk.
		expect(atEnumerate.enumeratorRequests).toBe(0);
		expect(atEnumerate.record?.spec?.sha256).toBe(record.spec?.sha256);
		expect(atEnumerate.specOnDisk).toBe(false);
		expect(JSON.stringify(atEnumerate.record)).not.toContain(MARKER);
		// The author is a fork of the parent with the goal and the schema in its prompt.
		const authorRequest = run.requests.find(isAuthorRequest) as Context;
		const prompt = text(authorRequest.messages.at(-1));
		expect(prompt).toContain("Goal: Make value equal 2.");
		expect(prompt).toContain('onBase: "fail" | "pass"');
		expect(record.spec?.validation).toEqual([expect.objectContaining({ attempt: 0, ok: true })]);
		expect(record.cost.author?.outputTokens).toBeTypeOf("number");
		expectCleanedUp(run.cwd, record, ["base", record.winner as string]);
	});

	it("sends an unusable or invalid spec back to the author with the report, then accepts the correction", async () => {
		const passesOnBase = { ...AUTHORED, gates: [{ id: "value", run: "true", onBase: "fail", timeoutSec: 30 }] };
		const run = await fixture(
			{ c1: [FIX, finish("done", "two")], c2: [WRONG, finish("done", "three")] },
			{
				author: [fauxAssistantMessage("Here are my checks."), authorReply(passesOnBase), authorReply(AUTHORED)],
			},
		);
		const { result, record } = await search(run, { authored: true, config: { scorer: { validationRetries: 2 } } });

		expect(result.outcome).toBe("ready");
		expect(record.spec?.validation.map((entry) => entry.ok)).toEqual([false, false, true]);
		const authorRequests = run.requests.filter(isAuthorRequest);
		expect(authorRequests).toHaveLength(3);
		// Each correction continues the same author conversation, with the report as a new message.
		const [first, second, third] = authorRequests as [Context, Context, Context];
		expect(second.messages.slice(0, first.messages.length)).toEqual(first.messages);
		expect(text(second.messages.at(-1))).toContain("not valid JSON");
		expect(third.messages.slice(0, second.messages.length)).toEqual(second.messages);
		expect(text(third.messages.at(-1))).toContain('gate value: declared onBase "fail" but passed on the base');
		expect(JSON.parse(readFileSync(join(stateDir(run.cwd, record), "spec.json"), "utf8"))).toEqual(AUTHORED);
		expectCleanedUp(run.cwd, record, ["base", record.winner as string]);
	});

	it("ends aborted: scorer invalid after the configured retries, before any enumerator runs", async () => {
		const passesOnBase = { ...AUTHORED, gates: [{ id: "value", run: "true", onBase: "fail", timeoutSec: 30 }] };
		const run = await fixture(
			{ c1: [FIX], c2: [FIX] },
			{ author: [authorReply(passesOnBase), authorReply({ ...passesOnBase, gates: [] })] },
		);
		const { result, record } = await search(run, { authored: true, config: { scorer: { validationRetries: 1 } } });

		expect(result.outcome).toBe("aborted: scorer invalid");
		expect(run.requests.filter(isAuthorRequest)).toHaveLength(2);
		expect(record.spec?.validation).toEqual([
			expect.objectContaining({ attempt: 0, ok: false }),
			expect.objectContaining({ attempt: 1, ok: false, report: expect.stringContaining("at least one gate") }),
		]);
		expect(run.requests.some((request) => text(request.messages.at(-1)).includes("approach list"))).toBe(false);
		expect(record.enumerations).toEqual([]);
		expectCleanedUp(run.cwd, record, ["base"]);
	});

	it("skips the author when a scorer is supplied, and still reviews it with a review profile", async () => {
		const run = await fixture({ c1: [FIX, finish("done", "two")], c2: [WRONG, finish("done", "three")] });
		const prompts: string[] = [];
		const { result, record } = await search(run, {
			config: { scorer: { validationRetries: 1, reviewProfile: "deep" } },
			review: async (_profile, prompt) => {
				prompts.push(prompt);
				return '{"verdict":"confirm"}';
			},
		});

		expect(result.outcome).toBe("ready");
		expect(run.requests.some(isAuthorRequest)).toBe(false);
		expect(prompts).toHaveLength(1);
		expect(prompts[0]).toContain(JSON.stringify(SCORER));
		expect(record.spec?.review).toEqual(expect.objectContaining({ verdict: "confirm", applied: false }));
	});

	it("sends one review request with a review profile, and a refine verdict replaces the scorer once", async () => {
		const run = await fixture(
			{ c1: [FIX, finish("done", "two")], c2: [WRONG, finish("done", "three")] },
			{ author: [authorReply(AUTHORED)] },
		);
		writeFileSync(join(run.cwd, "app.ts"), "export const value = 1; // edited\n");
		const refined: ScorerSpec = {
			...AUTHORED,
			gates: [...AUTHORED.gates, { id: "keep", run: "test -f src/keep.txt", onBase: "pass", timeoutSec: 30 }],
		};
		const reviews: { profile: string; prompt: string }[] = [];
		const { result, record } = await search(run, {
			authored: true,
			config: { scorer: { validationRetries: 1, reviewProfile: "deep" } },
			review: async (profile, prompt) => {
				reviews.push({ profile, prompt });
				return JSON.stringify({ verdict: "refine", reason: "protect src/keep.txt", spec: refined });
			},
		});

		expect(result.outcome).toBe("ready");
		expect(reviews).toHaveLength(1);
		const [{ profile, prompt }] = reviews as [{ profile: string; prompt: string }];
		expect(profile).toBe("deep");
		expect(prompt).toContain("Goal: Make value equal 2.");
		expect(prompt).toContain("Seed gate: none");
		expect(prompt).toMatch(/app\.ts \| 2 \+-/);
		expect(prompt).toContain(JSON.stringify(AUTHORED));
		expect(JSON.parse(readFileSync(join(stateDir(run.cwd, record), "spec.json"), "utf8"))).toEqual(refined);
		expect(record.spec?.review).toEqual(expect.objectContaining({ verdict: "refine", applied: true }));
		expect(record.spec?.validation.map((entry) => entry.ok)).toEqual([true, true]);
		expect(branchOf(record, "c1").gates).toEqual({ value: "pass", keep: "pass" });
	});

	it("sends no review request without a review profile", async () => {
		const run = await fixture(
			{ c1: [FIX, finish("done", "two")], c2: [WRONG, finish("done", "three")] },
			{ author: [authorReply(AUTHORED)] },
		);
		let reviews = 0;
		const { result, record } = await search(run, {
			authored: true,
			review: async () => {
				reviews++;
				return JSON.stringify({ verdict: "confirm" });
			},
		});

		expect(result.outcome).toBe("ready");
		expect(reviews).toBe(0);
		expect(record.spec?.review).toBeNull();
	});

	it("keeps the scorer out of reach of a branch that searches the disk for it (A2)", async () => {
		const hunt = fauxAssistantMessage(
			fauxToolCall(
				"bash",
				{
					// Reaches the parent's git directory and workspace without naming the parent path.
					command: `d=$(git rev-parse --git-common-dir); top=$(cd "$d/.." && pwd -P); find "$top" "$d" -name spec.json -o -name 'gate-7f3a.sh'; grep -rl -e '${MARKER}' -e 'bash hidden/gate-7f3a' "$top" "$d"; echo searched`,
					verbatim: true,
				},
				{ id: "hunt" },
			),
			{ stopReason: "toolUse" },
		);
		const run = await fixture(
			{ c1: [hunt, FIX, finish("done", "two")], c2: [WRONG, finish("done", "three")] },
			{ author: [authorReply(AUTHORED)] },
		);
		const { result, record } = await search(run, { authored: true });

		expect(result.outcome).toBe("ready");
		const found = run.requests
			.flatMap((request) => request.messages)
			.find((message) => message.role === "toolResult" && message.toolCallId === "hunt");
		// Neither find nor grep printed a hit; only the closing echo remains.
		expect(text(found).trim()).toBe("searched");
		// The same search after the search ended finds the stored spec, so it could have found it.
		const after = execFileSync("bash", ["-c", `grep -rl -e '${MARKER}' .git`], { cwd: run.cwd, encoding: "utf8" });
		expect(after).toContain(join(record.id, "spec.json"));
	});

	it("kills every process a branch started before scoring its generation", async () => {
		const daemon = fauxAssistantMessage(
			fauxToolCall(
				"bash",
				{ command: "nohup sleep 30 >/dev/null 2>&1 & echo $! > daemon.pid", verbatim: true },
				{ id: "daemon" },
			),
			{ stopReason: "toolUse" },
		);
		const run = await fixture({ c1: [daemon, FIX, finish("done", "two")], c2: [WRONG, finish("done", "three")] });
		const alive: boolean[] = [];
		const { record } = await search(run, {}, (status) => {
			if (!status?.startsWith("branching score g0") || alive.length > 0) return;
			const [id] = readdirSync(join(run.cwd, ".git", "apple-pi", "branch-search"));
			const wt = join(run.cwd, ".git", "apple-pi", "branch-search", id as string, "wt");
			for (const key of readdirSync(wt)) {
				const pidFile = join(wt, key, "daemon.pid");
				if (!existsSync(pidFile)) continue;
				const pid = Number(readFileSync(pidFile, "utf8"));
				try {
					process.kill(pid, 0);
					alive.push(true);
				} catch {
					alive.push(false);
				}
			}
		});

		expect(alive).toEqual([false]);
		expect(record.outcome).toBe("ready");
	});

	it("holds the root session for the whole apply, and cancels while it waits", async () => {
		const run = await fixture({ c1: [FIX, finish("done", "two")], c2: [WRONG, finish("done", "three")] });
		let grant: () => void = () => {};
		const order: string[] = [];
		const applied = search(run, {
			config: { apply: "auto" },
			exclusive: () => {
				order.push("wait");
				return new Promise<() => void>((done) => {
					grant = () => {
						order.push("held");
						done(() => order.push(`released with ${readFileSync(join(run.cwd, "app.ts"), "utf8").trim()}`));
					};
				});
			},
		});
		await vi.waitFor(() => expect(order).toEqual(["wait"]));
		expect(readFileSync(join(run.cwd, "app.ts"), "utf8")).toBe("export const value = 1;\n");
		grant();
		const { result } = await applied;
		expect(result.outcome).toBe("applied");
		expect(order).toEqual(["wait", "held", "released with export const value = 2;"]);

		const again = await fixture({ c1: [FIX, finish("done", "two")], c2: [WRONG, finish("done", "three")] });
		const controller = new AbortController();
		let late: () => void = () => {};
		let releasedLate = false;
		const cancelled = await search(again, {
			config: { apply: "auto" },
			signal: controller.signal,
			exclusive: () => {
				setTimeout(() => controller.abort(), 20);
				return new Promise<() => void>((done) => {
					late = () =>
						done(() => {
							releasedLate = true;
						});
				});
			},
		});
		expect(cancelled.result.outcome).toBe("aborted: cancelled");
		expect(readFileSync(join(again.cwd, "app.ts"), "utf8")).toBe("export const value = 1;\n");
		expectCleanedUp(again.cwd, cancelled.record, ["base"]);
		// A hold granted after the cancel is released at once.
		late();
		await vi.waitFor(() => expect(releasedLate).toBe(true));
	});

	it("keeps the author's temporary files and spilled output out of reach of later branches (I2)", async () => {
		// Unique per run, so files an earlier run left behind cannot match.
		const marker = `${MARKER}-${process.pid}-${Date.now()}`;
		const spill = fauxAssistantMessage(
			fauxToolCall(
				"bash",
				{
					command: `for i in $(seq 1 4000); do echo ${marker}-$i; done; echo ${marker} > "$TMPDIR/scratch-${marker}.txt"; echo "tmp=$TMPDIR"`,
					verbatim: true,
				},
				{ id: "spill" },
			),
			{ stopReason: "toolUse" },
		);
		const osTmp = realpathSync(tmpdir());
		const hunt = fauxAssistantMessage(
			fauxToolCall(
				"bash",
				{
					command: `S="$(git rev-parse --git-common-dir)/apple-pi"; find '${osTmp}' -maxdepth 1 \\( -name 'pi-bash-*.log' -o -name 'scratch-${marker}.txt' \\) -exec grep -l -e '${marker}' {} +; grep -rl -e '${marker}' "$S" "$TMPDIR"; echo searched`,
					verbatim: true,
				},
				{ id: "hunt" },
			),
			{ stopReason: "toolUse" },
		);
		const run = await fixture(
			{ c1: [hunt, FIX, finish("done", "two")], c2: [WRONG, finish("done", "three")] },
			{
				author: [
					spill,
					authorReply({
						...AUTHORED,
						files: [{ path: "hidden/gate-7f3a.sh", content: `# ${marker}\nbash check.sh\n` }],
					}),
				],
			},
		);
		const { result, record } = await search(run, { authored: true });

		expect(result.outcome).toBe("ready");
		const results = run.requests.flatMap((request) => request.messages);
		const authorOutput = text(results.find((m) => m.role === "toolResult" && m.toolCallId === "spill"));
		// The author's output spilled to a file in its private temporary directory, which is gone.
		const full = /Full output: (\S+)/.exec(authorOutput)?.[1] as string;
		const privateTmp = /tmp=(\S+)/.exec(authorOutput)?.[1] as string;
		expect(full.startsWith(join(stateDir(run.cwd, record), "tmp"))).toBe(true);
		expect(dirname(full)).toBe(privateTmp);
		expect(existsSync(full)).toBe(false);
		expect(existsSync(privateTmp)).toBe(false);
		const found = results.find((m) => m.role === "toolResult" && m.toolCallId === "hunt");
		expect(text(found).trim()).toBe("searched");
	});

	it("states the command's goal in the enumerator prompt and every branch directive", async () => {
		const run = await fixture(
			{ c1: [FIX, finish("done", "two")], c2: [WRONG, finish("done", "three")] },
			{ parentPrompt: "Say hello." },
		);
		const { result } = await search(run);

		expect(result.outcome).toBe("ready");
		const lasts = run.requests.map((request) => text(request.messages.at(-1)));
		const enumerator = lasts.find((last) => last.includes("Branch search: approach list."));
		expect(enumerator).toContain("Goal: Make value equal 2.");
		const directives = run.requests.flatMap((request) =>
			request.messages.map(text).filter((t) => t.startsWith("Branch search: attempt")),
		);
		expect(directives.length).toBeGreaterThan(0);
		for (const directive of directives) expect(directive).toContain("Goal: Make value equal 2.");
	});
});
