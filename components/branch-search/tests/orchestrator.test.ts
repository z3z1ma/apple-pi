import { execFileSync } from "node:child_process";
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
import { join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import registerTasks from "../../tasks/src/index.js";
import type { Gate, Judge } from "../src/judge.js";
import { type ProfileRequest, runBranchSearch, type SearchOptions, type SearchResult } from "../src/orchestrator.js";
import type { SearchRecord } from "../src/record.js";
import {
	barrier,
	type Behavior,
	DONE,
	FIX,
	GATE,
	gitOut,
	initFixtureRepo,
	JUDGE,
	scoreOf,
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

async function fixture(
	behaviors: Record<string, Behavior>,
	options: { git?: "none" | "empty"; enumerator?: () => Reply | "until-aborted" } = {},
) {
	const model = scriptedModel(behaviors, options.enumerator);
	const run = await fauxSession([registerTasks], (context) => model(context), ["read", "write", "edit", "ls", "bash"]);
	cleanup.push(run.dispose);
	const cwd = realpathSync(run.cwd);
	if (options.git === "empty") gitOut(cwd, "init", "-q");
	if (options.git === undefined) initFixtureRepo(cwd);
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
	overrides: {
		config?: Record<string, unknown>;
		judges?: Judge[];
		gates?: Gate[];
		protect?: string[];
		signal?: AbortSignal;
	} & Partial<Pick<SearchOptions, "profileRequest">> = {},
	onStatus?: (status: string | undefined) => void,
): Promise<SearchRun> {
	const statuses: (string | undefined)[] = [];
	const result = await runBranchSearch({
		session: run.session,
		cwd: run.cwd,
		config: { ...validConfig(), ...overrides.config },
		goal: "Make value equal 2.",
		judges: overrides.judges ?? [JUDGE],
		gates: overrides.gates ?? [GATE],
		protect: overrides.protect ?? [],
		profileRequest: overrides.profileRequest,
		signal: overrides.signal ?? new AbortController().signal,
		onStatus: (status) => {
			statuses.push(status);
			onStatus?.(status);
		},
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
	expect(existsSync(join(stateDir, "tmp"))).toBe(false);
	expect(record.cleanupErrors).toEqual([]);
	expect(record.endedAt).not.toBeNull();
}

function attemptOf(record: SearchRecord, candidate: string) {
	const attempt = record.attempts.find((entry) => entry.candidate.id === candidate);
	if (!attempt) throw new Error(`no attempt ran ${candidate}`);
	return attempt;
}

function choiceReply(text: string): ProfileRequest {
	return async () => ({ text, usage: { ...fauxAssistantMessage("").usage, input: 7, output: 3 } });
}

// Each case drives real git and several forks; under full-suite load that exceeds the 5s default.
describe("branch search", { timeout: 30_000 }, () => {
	it("applies the attempt with the best judge number among those that pass every gate", async () => {
		// No attempt's first reply arrives until all three attempts have asked: they run in parallel.
		const together = barrier(3, FIX);
		const run = await fixture({
			// The best number of all, but it fails the gate.
			c1: [together, WRONG, scoreOf("1", "s1"), DONE],
			c2: [together, scoreOf("5", "s2"), DONE],
			c3: [together, scoreOf("3", "s3"), withOutput(DONE, 11)],
		});
		const index = readFileSync(join(run.cwd, ".git", "index"));
		const { result, record, statuses } = await search(run, { config: { attempts: 3 } });

		expect(result.outcome).toBe("applied");
		const winner = attemptOf(record, "c3");
		expect(record.winner).toBe(winner.key);
		// An attempt that fails a gate is not judged.
		expect(attemptOf(record, "c1").scores).toEqual({
			gates: [{ command: GATE, pass: false }],
			judges: [],
			failure: null,
		});
		expect(attemptOf(record, "c2").scores?.judges[0]?.value).toBe(5);
		expect(record.choice).toBeNull();
		expect(readFileSync(join(run.cwd, "app.ts"), "utf8")).toBe("export const value = 2;\n");
		expect(readFileSync(join(run.cwd, "score.txt"), "utf8")).toBe("3\n");
		expect(readFileSync(join(run.cwd, ".git", "index"))).toEqual(index);
		expect(record.apply).toEqual({ applied: true, workspaceTree: record.base?.tree });

		// Every attempt ran, each in its own commit off the base, and saw the gates and judges it is scored by.
		expect(record.attempts.map((attempt) => attempt.stop)).toEqual(["done", "done", "done"]);
		for (const attempt of record.attempts)
			expect(gitOut(run.cwd, "rev-parse", `${attempt.commit}^`)).toBe(record.base?.commit);
		const prompts = run.requests.map((request) => text(request.messages.at(-1)));
		const attemptPrompts = prompts.filter((prompt) => prompt.startsWith("Branch search: attempt"));
		expect(attemptPrompts).toHaveLength(3);
		for (const prompt of attemptPrompts) {
			expect(prompt).toContain("Goal: Make value equal 2.");
			expect(prompt).toContain(`gate (must exit 0): \`${GATE}\``);
			expect(prompt).toContain(`judge (last stdout line is a number, lower is better): \`${JUDGE.command}\``);
		}
		expect(winner.cost.outputTokens).toBe(11);
		expect(record.cost.outputTokens).toBe(11);

		expect(result.report.split("\n")[0]).toBe(
			`Branch search ${record.id}: applied. 2 of 3 attempts passed every gate and judge.`,
		);
		expect(result.report).toContain(`Winner: ${winner.key} (c3)`);
		expect(result.report).toMatch(/a1 c1 done: failed gate `bash check.sh`; diff/);
		expect(result.report).not.toContain("Merge:");
		expect(statuses).toEqual(["branching enumerate", "branching run", "branching score", "branching apply", undefined]);
		expectCleanedUp(run.cwd, record, []);
	});

	it("ranks by the median of repeated judge runs, interleaved across the gate-passing attempts", async () => {
		const run = await fixture({
			// The best single run of all, but the worst median.
			c1: [FIX, scoreOf("1\n9\n8", "s1"), DONE],
			c2: [FIX, scoreOf("5\n6\n4", "s2"), DONE],
			c3: [WRONG, scoreOf("0\n0\n0", "s3"), DONE],
		});
		const log = join(realpathSync(mkdtempSync(join(tmpdir(), "apple-pi-branch-log-"))), "runs");
		cleanup.push(() => rmSync(join(log, ".."), { recursive: true, force: true }));
		// Each run prints the next line of score.txt and logs which attempt ran.
		const judge: Judge = {
			command: `n=$(( $(cat .n 2>/dev/null || echo 0) + 1 )); echo $n > .n; echo "$(basename "$PWD")" >> ${log}; sed -n "\${n}p" score.txt`,
			better: "lower",
			repeat: 3,
		};
		const { result, record } = await search(run, { config: { attempts: 3 }, judges: [judge] });

		// Run 1 of every gate-passing attempt, then run 2, then run 3; the gate-failing a3 is not judged.
		expect(readFileSync(log, "utf8").split("\n").filter(Boolean)).toEqual(["a1", "a2", "a1", "a2", "a1", "a2"]);
		expect(attemptOf(record, "c1").scores?.judges).toEqual([{ command: judge.command, value: 8, runs: [1, 9, 8] }]);
		expect(attemptOf(record, "c2").scores?.judges).toEqual([{ command: judge.command, value: 5, runs: [5, 6, 4] }]);
		expect(attemptOf(record, "c3").scores?.judges).toEqual([]);
		expect(record.winner).toBe(attemptOf(record, "c2").key);
		expect(result.report).toMatch(/a1 c1 done: passed 1 gates; judges 8 \(1–9\);/);
		expect(result.report).toMatch(/a2 c2 done: passed 1 gates; judges 5 \(4–6\);/);
	});

	it("scores an attempt that edits a protected judge script with the base script", async () => {
		const run = await fixture({
			c1: [FIX, scoreOf("9", "s1"), write("judge.sh", "echo 0\n", "cheat"), DONE],
			c2: [FIX, scoreOf("5", "s2"), DONE],
		});
		writeFileSync(join(run.cwd, "judge.sh"), "cat score.txt\n");
		const { result, record } = await search(run, {
			judges: [{ command: "bash judge.sh", better: "lower" }],
			protect: ["judge.sh"],
		});

		const attemptPrompts = run.requests
			.map((request) => text(request.messages.at(-1)))
			.filter((prompt) => prompt.startsWith("Branch search: attempt"));
		for (const prompt of attemptPrompts)
			expect(prompt).toContain("Before scoring, these paths are put back to their base content: `judge.sh`");
		expect(attemptOf(record, "c1").scores?.judges[0]?.value).toBe(9);
		expect(attemptOf(record, "c1").protectedChanged).toEqual(["judge.sh"]);
		expect(attemptOf(record, "c2").protectedChanged).toEqual([]);
		expect(record.protect).toEqual(["judge.sh"]);
		expect(record.winner).toBe(attemptOf(record, "c2").key);
		expect(result.report).toMatch(/a1 c1 done: .*; changed protected judge\.sh \(restored for scoring\)/);
		expect(result.report).not.toMatch(/a2 c2 done: .*changed protected/);
	});

	it("fails an attempt whose scoring commands change a protected path", async () => {
		const run = await fixture({
			c1: [FIX, scoreOf("9", "s1"), write("setup.sh", "echo 'echo 0' > judge.sh\n", "tamper"), DONE],
			c2: [FIX, scoreOf("5", "s2"), DONE],
		});
		writeFileSync(join(run.cwd, "judge.sh"), "cat score.txt\n");
		writeFileSync(join(run.cwd, "setup.sh"), "true\n");
		writeFileSync(join(run.cwd, "gate.sh"), "bash setup.sh && grep -q 'value = 2' app.ts\n");
		const { result, record } = await search(run, {
			gates: ["bash gate.sh"],
			judges: [{ command: "bash judge.sh", better: "lower" }],
			protect: ["judge.sh", "gate.sh"],
		});

		expect(attemptOf(record, "c1").scores?.failure).toBe("scoring changed a protected path");
		expect(attemptOf(record, "c2").scores?.failure).toBeNull();
		expect(record.winner).toBe(attemptOf(record, "c2").key);
		expect(result.outcome).toBe("applied");
		expect(readFileSync(join(run.cwd, "judge.sh"), "utf8")).toBe("cat score.txt\n");
	});

	it("fails an attempt whose scoring commits a protected change, and lets scoring write ignored caches", async () => {
		const run = await fixture({
			c1: [
				FIX,
				scoreOf("9", "s1"),
				write("setup.sh", "echo 'echo 0' > tests/judge.sh && git add tests/judge.sh && git commit -qm t\n", "commit"),
				DONE,
			],
			c2: [
				FIX,
				scoreOf("9", "s2"),
				write("setup.sh", "mkdir -p tests/__pycache__ && echo cache > tests/__pycache__/x\n", "cache"),
				DONE,
			],
			c3: [FIX, scoreOf("5", "s3"), DONE],
		});
		mkdirSync(join(run.cwd, "tests"));
		writeFileSync(join(run.cwd, "tests", "judge.sh"), "cat score.txt\n");
		writeFileSync(join(run.cwd, ".gitignore"), "__pycache__/\n");
		writeFileSync(join(run.cwd, "tests", "gate.sh"), "bash setup.sh && grep -q 'value = 2' app.ts\n");
		writeFileSync(join(run.cwd, "setup.sh"), "true\n");
		const { record } = await search(run, {
			config: { attempts: 3 },
			gates: ["bash tests/gate.sh"],
			judges: [{ command: "bash tests/judge.sh", better: "lower" }],
			protect: ["tests"],
		});

		expect(attemptOf(record, "c1").scores?.failure).toBe("scoring changed a protected path");
		expect(attemptOf(record, "c2").scores?.failure).toBeNull();
		expect(record.winner).toBe(attemptOf(record, "c3").key);
	});

	it("restores a protected directory for scoring and does not apply the winner's changes to it", async () => {
		const run = await fixture({
			c1: [
				FIX,
				scoreOf("1", "s1"),
				write("tests/gate.sh", "exit 1\n", "weaken"),
				write("tests/extra.sh", "x\n", "add"),
				DONE,
			],
			c2: [WRONG, scoreOf("0", "s2"), write("tests/gate.sh", "exit 0\n", "weaken2"), DONE],
		});
		mkdirSync(join(run.cwd, "tests"));
		writeFileSync(join(run.cwd, "tests", "gate.sh"), "grep -q 'value = 2' app.ts\n");
		const { result, record } = await search(run, { gates: ["bash tests/gate.sh"], protect: ["tests"] });

		// c1 passes only because its broken gate is restored; c2 weakened the gate to pass with the wrong value, and the base gate fails it.
		expect(attemptOf(record, "c2").scores?.gates).toEqual([{ command: "bash tests/gate.sh", pass: false }]);
		expect(attemptOf(record, "c1").protectedChanged).toEqual(["tests/extra.sh", "tests/gate.sh"]);
		expect(record.winner).toBe(attemptOf(record, "c1").key);
		expect(result.outcome).toBe("applied");
		expect(readFileSync(join(run.cwd, "app.ts"), "utf8")).toBe("export const value = 2;\n");
		expect(readFileSync(join(run.cwd, "tests", "gate.sh"), "utf8")).toBe("grep -q 'value = 2' app.ts\n");
		expect(existsSync(join(run.cwd, "tests", "extra.sh"))).toBe(false);
	});

	it("restores a protected directory replaced by a symlink and removes ignored files left under it", async () => {
		const outside = realpathSync(mkdtempSync(join(tmpdir(), "apple-pi-branch-outside-")));
		cleanup.push(() => rmSync(outside, { recursive: true, force: true }));
		writeFileSync(join(outside, "gate.sh"), "exit 0\n");
		const shell = (command: string, id: string) =>
			fauxAssistantMessage(fauxToolCall("bash", { command, verbatim: true }, { id }), { stopReason: "toolUse" });
		const run = await fixture({
			c1: [WRONG, scoreOf("0", "s1"), shell(`rm -rf tests && ln -s ${outside} tests`, "link"), DONE],
			c2: [
				FIX,
				scoreOf("5", "s2"),
				shell("mkdir -p tests/node_modules && touch tests/node_modules/cheat", "ign"),
				DONE,
			],
		});
		mkdirSync(join(run.cwd, "tests"));
		writeFileSync(join(run.cwd, "tests", "gate.sh"), "test ! -e tests/node_modules && grep -q 'value = 2' app.ts\n");
		const { result, record } = await search(run, { gates: ["bash tests/gate.sh"], protect: ["tests"] });

		// The symlink is replaced by the base directory, whose gate fails the wrong value.
		const cheat = attemptOf(record, "c1");
		expect(cheat.protectedChanged).toEqual(["tests", "tests/gate.sh"]);
		expect(cheat.scores?.gates).toEqual([{ command: "bash tests/gate.sh", pass: false }]);
		expect(attemptOf(record, "c2").protectedChanged).toEqual(["tests/node_modules/"]);
		expect(attemptOf(record, "c2").scores?.gates).toEqual([{ command: "bash tests/gate.sh", pass: true }]);
		expect(record.winner).toBe(attemptOf(record, "c2").key);
		expect(result.outcome).toBe("applied");
		expect(readFileSync(join(outside, "gate.sh"), "utf8")).toBe("exit 0\n");
	});

	it("clones a protected ignored directory again before scoring, from its copy taken before the forks", async () => {
		let parent = "";
		// c1 also rewrites the parent's copy, which a shell reaches through a path the fork does not map to its worktree.
		const reach = () =>
			fauxAssistantMessage(
				fauxToolCall(
					"bash",
					{
						command: `echo 'exit 0' > "${parent.slice(0, 8)}""${parent.slice(8)}/node_modules/gate.sh"`,
						verbatim: true,
					},
					{ id: "r" },
				),
				{ stopReason: "toolUse" },
			);
		const run = await fixture({
			c1: [WRONG, scoreOf("0", "s1"), write("node_modules/gate.sh", "exit 0\n", "weaken"), async () => reach(), DONE],
			c2: [FIX, scoreOf("5", "s2"), DONE],
		});
		parent = run.cwd;
		writeFileSync(join(run.cwd, "node_modules", "gate.sh"), "grep -q 'value = 2' app.ts\n");
		const { record } = await search(run, { gates: ["bash node_modules/gate.sh"], protect: ["node_modules"] });

		expect(attemptOf(record, "c1").scores?.gates).toEqual([{ command: "bash node_modules/gate.sh", pass: false }]);
		expect(attemptOf(record, "c1").protectedChanged).toEqual(["node_modules/"]);
		expect(attemptOf(record, "c2").protectedChanged).toEqual([]);
		expect(record.winner).toBe(attemptOf(record, "c2").key);
		expect(readFileSync(join(run.cwd, "node_modules", "gate.sh"), "utf8")).toBe("exit 0\n");
		expect(existsSync(join(run.cwd, ".git", "apple-pi", "branch-search", record.id, "protected"))).toBe(false);
	});

	it("fails an attempt that leads a protected cloned directory outside its worktree, and touches nothing there", async () => {
		const outside = realpathSync(mkdtempSync(join(tmpdir(), "apple-pi-branch-outside-")));
		cleanup.push(() => rmSync(outside, { recursive: true, force: true }));
		mkdirSync(join(outside, "node_modules"));
		writeFileSync(join(outside, "node_modules", "gate.sh"), "external\n");
		const shell = (command: string, id: string) =>
			fauxAssistantMessage(fauxToolCall("bash", { command, verbatim: true }, { id }), { stopReason: "toolUse" });
		const run = await fixture({
			c1: [FIX, scoreOf("0", "s1"), shell(`rm -rf deps && ln -s ${outside} deps`, "link"), DONE],
			c2: [FIX, scoreOf("5", "s2"), DONE],
		});
		mkdirSync(join(run.cwd, "deps", "node_modules"), { recursive: true });
		writeFileSync(join(run.cwd, "deps", "node_modules", "gate.sh"), "grep -q 'value = 2' app.ts\n");
		const { result, record } = await search(run, {
			config: { workspace: { cloneIgnored: ["deps/node_modules"] } },
			gates: ["bash deps/node_modules/gate.sh"],
			protect: ["deps/node_modules"],
		});

		expect(attemptOf(record, "c1").scores?.failure).toMatch(
			/^its protected paths could not be restored: deps\/node_modules resolves outside the attempt's worktree/,
		);
		expect(readdirSync(join(outside, "node_modules"))).toEqual(["gate.sh"]);
		expect(readFileSync(join(outside, "node_modules", "gate.sh"), "utf8")).toBe("external\n");
		expect(record.winner).toBe(attemptOf(record, "c2").key);
		expect(result.outcome).toBe("applied");
	});

	it("normalizes the spelling of cloneIgnored and protected paths, so honest attempts keep their dependencies", async () => {
		const run = await fixture({ c1: [FIX, scoreOf("1", "s1"), DONE], c2: [FIX, scoreOf("5", "s2"), DONE] });
		writeFileSync(join(run.cwd, "node_modules", "gate.sh"), "grep -q 'value = 2' app.ts\n");
		const { result, record } = await search(run, {
			config: { workspace: { cloneIgnored: ["./node_modules"] } },
			gates: ["bash node_modules/gate.sh"],
			protect: ["./node_modules/"],
		});

		expect(record.protect).toEqual(["node_modules"]);
		expect(record.config.workspace.cloneIgnored).toEqual(["node_modules"]);
		for (const attempt of record.attempts) {
			expect(attempt.scores?.gates).toEqual([{ command: "bash node_modules/gate.sh", pass: true }]);
			expect(attempt.protectedChanged).toEqual([]);
		}
		expect(result.outcome).toBe("applied");
	});

	it("fails the gate of an attempt whose gate outlives its timeoutSec, and the search continues", async () => {
		const run = await fixture({
			c1: [FIX, scoreOf("1", "s1"), write("hang", "\n", "h1"), DONE],
			c2: [FIX, scoreOf("5", "s2"), DONE],
		});
		const gate = { command: "if test -f hang; then sleep 60; fi; bash check.sh", timeoutSec: 1 };
		const started = Date.now();
		const { result, record } = await search(run, { gates: [gate] });

		expect(Date.now() - started).toBeLessThan(20_000);
		expect(attemptOf(record, "c1").scores?.gates).toEqual([{ command: gate.command, pass: false, timedOut: true }]);
		expect(record.winner).toBe(attemptOf(record, "c2").key);
		expect(record.gates).toEqual([gate]);
		expect(result.report).toContain(`a1 c1 done: failed gate \`${gate.command}\` (timed out)`);
	});

	it("fails an attempt whose judge outlives its timeoutSec", async () => {
		const run = await fixture({
			c1: [FIX, scoreOf("1", "s1"), write("hang", "\n", "h1"), DONE],
			c2: [FIX, scoreOf("5", "s2"), DONE],
		});
		const judge: Judge = {
			command: "if test -f hang; then sleep 60; fi; cat score.txt",
			better: "lower",
			repeat: 2,
			timeoutSec: 1,
		};
		const started = Date.now();
		const { result, record } = await search(run, { judges: [judge] });

		expect(Date.now() - started).toBeLessThan(20_000);
		expect(attemptOf(record, "c1").scores?.failure).toBe(`judge \`${judge.command}\` timed out after 1s`);
		expect(attemptOf(record, "c1").scores?.judges).toEqual([{ command: judge.command, value: null, runs: [] }]);
		expect(record.winner).toBe(attemptOf(record, "c2").key);
		expect(result.outcome).toBe("applied");
	});

	it("rejects a protected path that is or goes through a symlink, naming the target to protect", async () => {
		const run = await fixture({ c1: [FIX] });
		mkdirSync(join(run.cwd, "tooling"));
		writeFileSync(join(run.cwd, "tooling", "judge.sh"), "cat score.txt\n");
		symlinkSync("tooling/judge.sh", join(run.cwd, "judge.sh"));
		symlinkSync("src", join(run.cwd, "link"));
		const before = run.requests.length;

		await expect(search(run, { protect: ["judge.sh"] })).rejects.toThrow(
			'protect: "judge.sh" is or goes through a symlink; protect "tooling/judge.sh" instead',
		);
		await expect(search(run, { protect: ["link/keep.txt"] })).rejects.toThrow(
			'protect: "link/keep.txt" is or goes through a symlink; protect "src/keep.txt" instead',
		);
		expect(run.requests.length).toBe(before);
		expect(existsSync(join(run.cwd, ".git", "apple-pi"))).toBe(false);
	});

	it("rejects an invalid protected path before any git or model work", async () => {
		const run = await fixture({ c1: [FIX] });
		const outside = realpathSync(mkdtempSync(join(tmpdir(), "apple-pi-branch-outside-")));
		cleanup.push(() => rmSync(outside, { recursive: true, force: true }));
		symlinkSync(outside, join(run.cwd, "link"));
		const before = run.requests.length;
		for (const path of ["../x", "/etc/passwd", "src/../../x", "", "link/judge.sh"])
			await expect(search(run, { protect: [path] })).rejects.toThrow(/^protect: /);
		expect(run.requests.length).toBe(before);
		expect(existsSync(join(run.cwd, ".git", "apple-pi"))).toBe(false);
	});

	it("never picks an attempt that fails a gate, however good its number", async () => {
		const run = await fixture({ c1: [WRONG, scoreOf("0", "s1"), DONE], c2: [WRONG, scoreOf("1", "s2"), DONE] });
		const { result, record } = await search(run);

		expect(result.outcome).toBe("no winner");
		expect(record.winner).toBeNull();
		expect(readFileSync(join(run.cwd, "app.ts"), "utf8")).toBe("export const value = 1;\n");
		expect(result.report).toContain("0 of 2 attempts passed every gate and judge");
		expectCleanedUp(run.cwd, record, []);
	});

	it("fails an attempt whose judge prints no number or exits non-zero", async () => {
		const run = await fixture({
			c1: [FIX, scoreOf("fast", "s1"), DONE],
			// No score.txt: cat exits 1.
			c2: [FIX, DONE],
			c3: [FIX, scoreOf("9", "s3"), DONE],
		});
		const { result, record } = await search(run, { config: { attempts: 3 } });

		expect(attemptOf(record, "c1").scores?.failure).toBe(
			"judge `cat score.txt` printed no number on its last stdout line",
		);
		expect(attemptOf(record, "c2").scores?.failure).toMatch(/^judge `cat score.txt` exited with code 1/);
		expect(record.winner).toBe(attemptOf(record, "c3").key);
		expect(result.outcome).toBe("applied");
	});

	it("ranks by judges in declared order and direction, then by smaller diff", async () => {
		const run = await fixture({
			c1: [FIX, scoreOf("2", "s1"), write("extra.txt", "a\nb\nc\n", "e1"), DONE],
			c2: [FIX, scoreOf("2", "s2"), DONE],
			c3: [FIX, scoreOf("1", "s3"), DONE],
		});
		const judges: Judge[] = [
			{ command: "cat score.txt", better: "higher" },
			{ command: "echo 0", better: "lower" },
		];
		const { record } = await search(run, { config: { attempts: 3 }, judges });

		// c1 and c2 tie on both judges; c2's diff is smaller.
		expect(record.winner).toBe(attemptOf(record, "c2").key);
	});

	it("lets the judge model choose among the attempts that pass every gate", async () => {
		const run = await fixture({
			c1: [FIX, scoreOf("1", "s1"), DONE],
			c2: [FIX, scoreOf("5", "s2"), DONE],
			c3: [WRONG, scoreOf("0", "s3"), DONE],
		});
		const prompts: string[] = [];
		const profiles: string[] = [];
		const { result, record } = await search(run, {
			config: { attempts: 3, judge: { profile: "deep" } },
			profileRequest: async (profile, prompt, signal) => {
				profiles.push(profile);
				prompts.push(prompt);
				return choiceReply('{"winner":"a2","reason":"clearer code"}')(profile, prompt, signal);
			},
		});

		expect(profiles).toEqual(["deep"]);
		// Only the gate-passers, best number first, with their diffs and judge values.
		const [prompt] = prompts;
		expect(prompt?.indexOf("## Attempt a1")).toBeLessThan(prompt?.indexOf("## Attempt a2") as number);
		expect(prompt).not.toContain("## Attempt a3");
		expect(prompt).toContain("`cat score.txt` = 5");
		expect(prompt).toContain("+export const value = 2;");
		expect(record.choice).toEqual({ profile: "deep", winner: "a2", reason: "clearer code" });
		expect(record.winner).toBe("a2");
		expect(readFileSync(join(run.cwd, "score.txt"), "utf8")).toBe("5\n");
		expect(record.cost.outputTokens).toBeGreaterThanOrEqual(3);
		expect(result.report).toContain("Chosen by judge model deep: clearer code");
	});

	it("keeps the judge numbers' order when the judge model names no qualifying attempt", async () => {
		const run = await fixture({
			c1: [FIX, scoreOf("1", "s1"), DONE],
			c2: [WRONG, scoreOf("0", "s2"), DONE],
			c3: [FIX, scoreOf("4", "s3"), DONE],
		});
		const { result, record } = await search(run, {
			config: { attempts: 3, judge: { profile: "deep" } },
			profileRequest: choiceReply('{"winner":"a2"}'),
		});

		expect(record.winner).toBe("a1");
		expect(record.choice).toEqual({
			profile: "deep",
			winner: null,
			reason: "its reply could not be used: its winner is not one of a1, a3",
		});
		expect(result.report).toContain("Judge model deep could not choose");
	});

	it("sends no judge request without judge.profile, or with one qualifying attempt", async () => {
		const request = vi.fn(choiceReply('{"winner":"a1"}'));
		const run = await fixture({ c1: [FIX, scoreOf("1", "s1"), DONE], c2: [FIX, scoreOf("2", "s2"), DONE] });
		const plain = await search(run, { profileRequest: request });
		expect(plain.record.winner).toBe("a1");

		const single = await fixture({ c1: [WRONG, scoreOf("1", "s1"), DONE], c2: [FIX, scoreOf("2", "s2"), DONE] });
		const one = await search(single, { config: { judge: { profile: "deep" } }, profileRequest: request });
		expect(one.record.winner).toBe("a2");
		expect(one.record.choice).toBeNull();
		expect(request).not.toHaveBeenCalled();
	});

	it("ends ready with a merge command and leaves the workspace alone when it changed during the search", async () => {
		const run = await fixture({ c1: [FIX, scoreOf("1", "s1"), DONE], c2: [WRONG, scoreOf("0", "s2"), DONE] });
		const { result, record } = await search(run, {}, (status) => {
			if (status === "branching score") writeFileSync(join(run.cwd, "notes.md"), "written meanwhile\n");
		});

		expect(result.outcome).toBe("ready");
		expect(readFileSync(join(run.cwd, "app.ts"), "utf8")).toBe("export const value = 1;\n");
		expect(readFileSync(join(run.cwd, "notes.md"), "utf8")).toBe("written meanwhile\n");
		expect(record.apply).toEqual(
			expect.objectContaining({ applied: false, reason: "the workspace changed during the search" }),
		);
		expect(result.report).toContain("Not applied: the workspace changed during the search");
		const merge = /^Merge: (.+)$/m.exec(result.report)?.[1] as string;
		expect(merge).toBe(
			`git diff --no-ext-diff --no-textconv --binary ${record.base?.commit} refs/apple-pi/branch-search/${record.id}/a1 | git apply --3way`,
		);
		const check = realpathSync(mkdtempSync(join(tmpdir(), "apple-pi-branch-merge-")));
		cleanup.push(() => rmSync(check, { recursive: true, force: true }));
		gitOut(run.cwd, "worktree", "add", "--detach", "-q", join(check, "wt"), record.base?.commit as string);
		execFileSync("bash", ["-c", merge], { cwd: join(check, "wt"), stdio: "pipe" });
		expect(readFileSync(join(check, "wt", "app.ts"), "utf8")).toBe("export const value = 2;\n");
		gitOut(run.cwd, "worktree", "remove", "--force", join(check, "wt"));
		expectCleanedUp(run.cwd, record, ["a1"]);
	});

	it("stops attempts at a limit, reports limit or error, and still scores their commits", async () => {
		const run = await fixture({
			slow: [FIX, scoreOf("1", "s1"), "until-aborted"],
			verbose: [withOutput(FIX, 5000), scoreOf("2", "s2"), DONE],
			broken: [FIX, scoreOf("3", "s3"), { ...fauxAssistantMessage(""), stopReason: "error", errorMessage: "boom" }],
		});
		const { result, record } = await search(run, {
			config: { attempts: 3, limits: { wallClockSec: 1, outputTokens: 1000 } },
		});

		expect(attemptOf(record, "slow").stop).toBe("limit");
		expect(attemptOf(record, "verbose").stop).toBe("limit");
		expect(attemptOf(record, "broken").stop).toBe("error");
		expect(attemptOf(record, "slow").scores?.judges[0]?.value).toBe(1);
		expect(record.winner).toBe(attemptOf(record, "slow").key);
		expect(result.outcome).toBe("applied");
	});

	it("cleans up after cancellation", async () => {
		const run = await fixture({ c1: ["until-aborted"], c2: [FIX, "until-aborted"] });
		const controller = new AbortController();
		const { result, record, statuses } = await search(run, { signal: controller.signal }, (status) => {
			if (status === "branching run") setTimeout(() => controller.abort(), 50);
		});

		expect(result.outcome).toBe("aborted: cancelled");
		expect(record.winner).toBeNull();
		expect(statuses.at(-1)).toBeUndefined();
		expect(readFileSync(join(run.cwd, "app.ts"), "utf8")).toBe("export const value = 1;\n");
		expectCleanedUp(run.cwd, record, []);
	});

	it("cleans up after an error and reports its reason", async () => {
		// A lock left in the attempt's index makes committing its work fail.
		const lock = fauxAssistantMessage(
			fauxToolCall(
				"bash",
				{ command: 'touch "$(git rev-parse --git-dir)/index.lock"', verbatim: true },
				{ id: "lock" },
			),
			{ stopReason: "toolUse" },
		);
		const run = await fixture({ c1: [FIX, lock, DONE], c2: [WRONG, DONE] });
		const { result, record } = await search(run);

		expect(result.outcome).toBe("aborted: error");
		expect(record.abortReason).toMatch(/index\.lock/);
		expect(result.report).toMatch(/Reason: .*index\.lock/);
		expect(readFileSync(join(run.cwd, "app.ts"), "utf8")).toBe("export const value = 1;\n");
		expectCleanedUp(run.cwd, record, []);
	});

	it("runs only the configured number of attempts, in the enumerator's order", async () => {
		const run = await fixture({ c1: [FIX, scoreOf("1", "s1"), DONE], c2: [FIX, DONE], c3: [FIX, DONE] });
		const { record } = await search(run);
		expect(record.attempts.map(({ key, candidate }) => [key, candidate.id])).toEqual([
			["a1", "c1"],
			["a2", "c2"],
		]);
		const enumerator = run.requests.find((r) => text(r.messages.at(-1)).includes("approach list"));
		expect(text(enumerator?.messages.at(-1))).toContain("List 2 distinct approaches");
	});

	it("ends aborted: enumeration failed after a second unusable approach list", async () => {
		const run = await fixture({}, { enumerator: () => fauxAssistantMessage("I would just try c1.") });
		const { result, record } = await search(run);

		expect(result.outcome).toBe("aborted: enumeration failed");
		expect(run.requests.filter((r: Context) => text(r.messages.at(-1)).includes("could not be used"))).toHaveLength(1);
		expect(record.attempts).toEqual([]);
		expectCleanedUp(run.cwd, record, []);
	});

	it("ends aborted: no git history in a workspace without a HEAD commit", async () => {
		for (const git of ["empty", "none"] as const) {
			const run = await fixture({}, { git });
			const before = run.requests.length;
			const { result } = await search(run);
			expect(result.outcome).toBe("aborted: no git history");
			expect(run.requests.length).toBe(before);
		}
	});

	it("stops before any git or model work when a required key is missing, naming each one", async () => {
		const run = await fixture({ c1: [FIX] });
		const before = run.requests.length;
		const { result } = await search(run, { config: { attempts: undefined, limits: {} } });

		expect(result.outcome).toBe("not configured");
		expect(result.report).toContain("attempts: missing");
		expect(result.report).toContain("limits: must set wallClockSec or outputTokens");
		expect(result.recordPath).toBeUndefined();
		expect(run.requests.length).toBe(before);
		expect(existsSync(join(run.cwd, ".git", "apple-pi"))).toBe(false);
	});
});
