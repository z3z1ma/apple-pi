import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import registerTasks from "../../tasks/src/index.js";
import { runBranchSearch, type SearchResult } from "../src/orchestrator.js";
import type { SearchRecord } from "../src/record.js";
import type { ScorerSpec } from "../src/scorer.js";
import { gitOut, initRepo, validConfig } from "./fixtures.js";

type Behavior = (Reply | "until-aborted")[];

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const dispose of cleanup.splice(0)) dispose();
});

const SEED = new Uint8Array(32).fill(42);

function text(message: Context["messages"][number] | undefined): string {
	if (!message) return "";
	if (typeof message.content === "string") return message.content;
	return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

function write(path: string, content: string, id: string): Reply {
	return fauxAssistantMessage(fauxToolCall("write", { path, content }, { id }), { stopReason: "toolUse" });
}

function finish(result: "done" | "abandoned", learned: string): Reply {
	return fauxAssistantMessage(`Finished.\nresult: ${result}\nlearned: ${learned}`);
}

function withOutput(reply: Reply, output: number): Reply {
	return { ...reply, usage: { ...reply.usage, output } };
}

const FIX = write("app.ts", "export const value = 2;\n", "fix");
const WRONG = write("app.ts", "export const value = 3;\n", "wrong");

/**
 * The scripted model: the enumerator prompt gets the candidate list; each branch replies by its
 * approach, one scripted reply per model turn after its directive.
 */
function scriptedModel(behaviors: Record<string, Behavior>, enumerator?: () => Reply | "until-aborted") {
	const candidates = Object.keys(behaviors).map((id) => ({
		id,
		approach: `approach ${id}`,
		firstStep: `open app.ts for ${id}`,
	}));
	return (context: Context): Reply | "until-aborted" => {
		if (text(context.messages.at(-1)).includes("Branch search: approach list."))
			return enumerator?.() ?? fauxAssistantMessage(JSON.stringify({ candidates, preferred: "c1" }));
		const directive = context.messages.findLastIndex((message) => text(message).includes("Branch search: attempt"));
		if (directive < 0) return fauxAssistantMessage("Understood.");
		const approach = /Approach: approach (\S+)/.exec(text(context.messages[directive]))?.[1] as string;
		const turn = context.messages.slice(directive + 1).filter((message) => message.role === "assistant").length;
		return behaviors[approach]?.[turn] ?? fauxAssistantMessage("result: done\nlearned: nothing more to do");
	};
}

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
	options: { git?: "none" | "empty"; enumerator?: () => Reply | "until-aborted" } = {},
) {
	const model = scriptedModel(behaviors, options.enumerator);
	const run = await fauxSession([registerTasks], (context) => model(context), ["read", "write", "edit", "ls", "bash"]);
	cleanup.push(run.dispose);
	const cwd = realpathSync(run.cwd);
	if (options.git === "empty") gitOut(cwd, "init", "-q");
	if (options.git === undefined) {
		initRepo(cwd, {
			".gitignore": "agent/\nnode_modules/\n",
			"check.sh": "grep -q 'value = 2' app.ts\n",
			"src/keep.txt": "keep\n",
		});
		mkdirSync(join(cwd, "node_modules"));
		writeFileSync(join(cwd, "node_modules", "dep.js"), "dep\n");
	}
	await run.session.prompt("Make value equal 2.");
	return { ...run, cwd };
}

interface SearchRun {
	result: SearchResult;
	statuses: (string | undefined)[];
	record: SearchRecord;
}

async function search(
	run: Awaited<ReturnType<typeof fixture>>,
	overrides: { config?: Record<string, unknown>; scorer?: ScorerSpec; signal?: AbortSignal } = {},
	onStatus?: (status: string | undefined) => void,
): Promise<SearchRun> {
	const statuses: (string | undefined)[] = [];
	const result = await runBranchSearch({
		session: run.session,
		cwd: run.cwd,
		config: { ...validConfig(), ...overrides.config },
		scorer: overrides.scorer ?? SCORER,
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
			onDisk.push(...readdirSync(dir), readFileSync(join(dir, "record.json"), "utf8"));
		});

		// While branches run, no scorer content is on disk (spec 8.4).
		expect(onDisk).toContain("record.json");
		expect(onDisk).not.toContain("spec.json");
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
			`git diff --binary ${base.commit} refs/apple-pi/branch-search/${record.id}/${winner.key} | git apply --3way`,
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
		const run = await fixture({ c1: [FIX, finish("done", "two")], c2: [WRONG, finish("done", "three")] });
		// Installing a scorer file over an existing directory fails while scoring.
		const scorer = { ...SCORER, files: [{ path: "src", content: "not a directory\n" }] };
		const { result, record, statuses } = await search(run, { scorer });

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
			session: run.session,
			cwd: run.cwd,
			config,
			scorer: SCORER,
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
