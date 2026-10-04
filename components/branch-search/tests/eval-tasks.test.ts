import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closedTaskIds, extractTask, repositoryTestRunner, taskEvidence } from "../eval/tasks.js";
import { runCommand } from "../src/scorer.js";
import { repoRoot } from "../src/workspace.js";
import { gitOut, initRepo } from "./fixtures.js";

const dirs: string[] = [];
const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Shell test files run with bash; nothing else is a test. */
const testCommand = (path: string) => (path.endsWith(".test.sh") ? `bash ${path}` : undefined);
const testRunner = { command: testCommand, files: [] };

function commit(dir: string, files: Record<string, string>, message: string): string {
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), content);
	}
	execFileSync("git", ["add", "-A"], { cwd: dir });
	execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir });
	return gitOut(dir, "rev-parse", "HEAD");
}

/** Move a live bundle into the history, writing `files` into it first, in one closing commit. */
function close(dir: string, id: string, files: Record<string, string> = {}): string {
	for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, ".ledger", id, name), content);
	mkdirSync(join(dir, ".ledger", "history"), { recursive: true });
	renameSync(join(dir, ".ledger", id), join(dir, ".ledger", "history", id));
	return commit(dir, {}, `close ${id}`);
}

/**
 * A fake ledger history whose tasks interleave. `solved` cites its two implementation commits in its
 * bundle; between them and before them, another task's commits add a test (`other.test.sh`) that also
 * fails on the base and passes later. `docs` cites a commit that changes no test, `uncited` cites
 * nothing, `forked` cites commits on two lines of history, and `open` is still live.
 */
function ledgerRepo() {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "apple-pi-eval-tasks-")));
	dirs.push(dir);
	initRepo(dir, {
		"src/value": "1\n",
		"src/flag": "no\n",
		"tests/old.test.sh": "test -f src/value\n",
		".gitignore": "node_modules/\n",
	});
	mkdirSync(join(dir, "node_modules"));
	writeFileSync(join(dir, "node_modules", "dep"), "dep\n");
	const initial = gitOut(dir, "rev-parse", "HEAD");
	const added = commit(dir, { ".ledger/solved/task.md": "# Make value 2\n" }, "add solved task");
	const implement = commit(
		dir,
		{
			"tests/value.test.sh": "grep -qx 2 src/value\n",
			"tests/already.test.sh": "test -d src\n",
			"tests/broken.test.sh": "exit 1\n",
			// The oracle may rely on ignored dependencies, which every clone receives.
			"tests/deps.test.sh": "test -f node_modules/dep && grep -qx 2 src/value\n",
		},
		"tests for value",
	);
	// Another task's commit lands between the cited ones: its test fails on the base and passes at the end.
	const other = commit(dir, { "tests/other.test.sh": "grep -qx yes src/flag\n", "src/flag": "yes\n" }, "other task");
	const fix = commit(dir, { "src/value": "2\n", "tests/old.test.sh": "test -s src/value\n" }, "fix value");
	close(dir, "solved", {
		// Short and full hashes; hex words that name no commit are not evidence.
		"task.md": `# Make value 2\n\nTests in \`${implement.slice(0, 7)}\`, fix in ${fix}. Colour deadbeefcafe.\n`,
		"retrospective.md": `Done in ${fix.slice(0, 9)}.\n`,
	});
	commit(dir, { ".ledger/docs/task.md": "# Docs\n" }, "add docs task");
	const docs = commit(dir, { "docs/guide.md": "docs\n" }, "write docs");
	close(dir, "docs", { "task.md": `# Docs\n\nCommitted as ${docs.slice(0, 7)}.\n` });
	commit(dir, { ".ledger/uncited/task.md": "# Uncited\n" }, "add uncited task");
	close(dir, "uncited");
	const side = execFileSync("git", ["commit-tree", `${initial}^{tree}`, "-p", initial, "-m", "side"], {
		cwd: dir,
		encoding: "utf8",
	}).trim();
	execFileSync("git", ["branch", "side", side], { cwd: dir });
	commit(dir, { ".ledger/forked/task.md": `# Forked\n\n${side.slice(0, 8)} and ${fix.slice(0, 8)}.\n` }, "add forked");
	close(dir, "forked");
	commit(dir, { ".ledger/open/task.md": "# Open\n" }, "add open task");
	return { dir, initial, added, other, implement, fix, side };
}

describe("evaluation task extraction", { timeout: 30_000 }, () => {
	it("lists the closed tasks in the ledger history", async () => {
		const { dir } = ledgerRepo();
		expect(await closedTaskIds(dir)).toEqual(["docs", "forked", "solved", "uncited"]);
	});

	it("takes base, final, and oracle candidates from the commits the bundle cites, not the interleaved range", async () => {
		const { dir, added, other, implement, fix } = ledgerRepo();
		// Clones go to the OS temporary directory; a private one shows that each is removed.
		const clonesDir = realpathSync(mkdtempSync(join(tmpdir(), "apple-pi-eval-tmp-")));
		dirs.push(clonesDir);
		const previous = process.env.TMPDIR;
		process.env.TMPDIR = clonesDir;
		cleanups.push(() => {
			if (previous === undefined) delete process.env.TMPDIR;
			else process.env.TMPDIR = previous;
		});
		const extraction = await extractTask(dir, "solved", { testRunner, cloneIgnored: ["node_modules"], timeoutSec: 10 });

		if (!extraction.ok) throw new Error(extraction.reason);
		const { task, excluded } = extraction;
		expect(task.provenance).toBe("cited");
		expect(task.base).toBe(added);
		// The other task's commit sits inside the cited span, yet only cited commits supply candidates.
		expect(gitOut(dir, "merge-base", "--is-ancestor", other, fix)).toBe("");
		expect(task.final).toBe(fix);
		expect(task.commits).toEqual([implement, fix]);
		expect(task.goal).toContain("# Make value 2\n");
		// `other.test.sh` also fails on the base and passes at the end, but no cited commit changed it,
		// so it is neither an oracle nor an excluded candidate.
		expect(task.oracles).toEqual([
			{ path: "tests/deps.test.sh", command: "bash tests/deps.test.sh" },
			{ path: "tests/value.test.sh", command: "bash tests/value.test.sh" },
		]);
		expect(task.spec).toEqual({
			version: 1,
			goal: task.goal,
			files: [
				{ path: "tests/deps.test.sh", content: "test -f node_modules/dep && grep -qx 2 src/value\n" },
				{ path: "tests/value.test.sh", content: "grep -qx 2 src/value\n" },
			],
			protect: [],
			gates: [
				{ id: "oracle-1", run: "bash tests/deps.test.sh", onBase: "fail", timeoutSec: 10 },
				{ id: "oracle-2", run: "bash tests/value.test.sh", onBase: "fail", timeoutSec: 10 },
			],
			objectives: [],
		});
		expect(excluded).toEqual([
			{ path: "tests/already.test.sh", reason: "passes on the base" },
			{ path: "tests/broken.test.sh", reason: "fails on the final state" },
			{ path: "tests/old.test.sh", reason: "passes on the base" },
		]);
		// Extraction runs only in temporary clones: the repository is untouched.
		expect(gitOut(dir, "status", "--porcelain")).toBe("");
		expect(gitOut(dir, "for-each-ref", "--format=%(refname)")).not.toContain("apple-pi-eval");
		expect(gitOut(dir, "worktree", "list", "--porcelain").split("\n")[0]).toBe(`worktree ${dir}`);
		expect(readdirSync(clonesDir).filter((name) => name.startsWith("apple-pi-eval-clone-"))).toEqual([]);
	});

	it("uses an override's base, final, and test files when the configuration gives one", async () => {
		const { dir, initial, fix } = ledgerRepo();
		const extraction = await extractTask(dir, "uncited", {
			testRunner,
			cloneIgnored: ["node_modules"],
			timeoutSec: 10,
			override: { base: initial.slice(0, 10), final: fix, tests: ["tests/value.test.sh"] },
		});

		if (!extraction.ok) throw new Error(extraction.reason);
		expect(extraction.task.provenance).toBe("override");
		expect(extraction.task.base).toBe(initial);
		expect(extraction.task.final).toBe(fix);
		expect(extraction.task.oracles.map(({ path }) => path)).toEqual(["tests/value.test.sh"]);
	});

	it("skips a task whose bundle cites no commit and that has no override", async () => {
		const { dir } = ledgerRepo();
		expect(await extractTask(dir, "uncited", { testRunner, cloneIgnored: [], timeoutSec: 10 })).toEqual({
			ok: false,
			id: "uncited",
			reason: "the bundle cites no commit of this repository, and the configuration gives no override for it",
			excluded: [],
		});
	});

	it("skips a task whose cited commits are not one line of history", async () => {
		const { dir, side, fix } = ledgerRepo();
		const extraction = await extractTask(dir, "forked", { testRunner, cloneIgnored: [], timeoutSec: 10 });
		expect(extraction).toEqual({
			ok: false,
			id: "forked",
			reason: `ambiguous provenance: the cited commits ${[side, fix].sort().join(", ")} do not form one line of history`,
			excluded: [],
		});
	});

	it("reports a task whose cited commits change no test file, so it is skipped", async () => {
		const { dir } = ledgerRepo();
		const extraction = await extractTask(dir, "docs", { testRunner, cloneIgnored: [], timeoutSec: 10 });

		expect(extraction).toEqual({
			ok: false,
			id: "docs",
			reason: "no test file was added or changed in the task's commits",
			excluded: [],
		});
	});

	it("reports a task whose changed tests are no oracle with each test's reason", async () => {
		const { dir } = ledgerRepo();
		const extraction = await extractTask(dir, "solved", {
			testRunner: { command: (path) => (path.endsWith("already.test.sh") ? `bash ${path}` : undefined), files: [] },
			cloneIgnored: [],
			timeoutSec: 10,
		});

		expect(extraction).toEqual({
			ok: false,
			id: "solved",
			reason: "no changed test fails on the base and passes on the final state",
			excluded: [{ path: "tests/already.test.sh", reason: "passes on the base" }],
		});
	});

	it("takes a cited short hash made only of digits as evidence", async () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "apple-pi-eval-digits-")));
		dirs.push(dir);
		initRepo(dir, { "src/value": "1\n" });
		const base = gitOut(dir, "rev-parse", "HEAD");
		const tree = commit(dir, { "tests/value.test.sh": "grep -qx 2 src/value\n" }, "tree source");
		// Vary the message until the commit's 7-character prefix is all digits (about 1 in 27 tries).
		let digits = "";
		for (let i = 0; !/^[0-9]{7}/.test(digits); i++)
			digits = gitOut(dir, "commit-tree", `${tree}^{tree}`, "-p", base, "-m", `tests ${i}`);
		execFileSync("git", ["reset", "-q", "--hard", digits], { cwd: dir });
		commit(dir, { ".ledger/history/numeric/task.md": `# Numeric\n\nDone in ${digits.slice(0, 7)}.\n` }, "close");

		const evidence = await taskEvidence(dir, "numeric", testRunner);

		expect(evidence).toEqual(expect.objectContaining({ ok: true, base, final: digits, commits: [digits] }));
	});

	it("finds the implementation commit the real subagent-resume-policy bundle cites (read-only)", async () => {
		const repo = await repoRoot(process.cwd());
		const evidence = await taskEvidence(repo, "202610031136-subagent-resume-policy", repositoryTestRunner);

		if (!evidence.ok) throw new Error(evidence.reason);
		const implementation = gitOut(repo, "rev-parse", "69ef926^{commit}");
		expect(evidence.commits).toContain(implementation);
		expect(evidence.candidates).toContain("components/subagents/tests/subagent-runner-e2e.test.ts");
		expect(evidence.candidates).toContain("components/subagents/tests/subagents.test.ts");
	});

	it("installs the runner's support files in both clones and in the oracle scorer", async () => {
		const { dir } = ledgerRepo();
		// The base has no runner script: without its installation every test would fail on both sides.
		const runner = {
			command: (path: string) => (path.endsWith(".test.sh") ? `bash .runner/run.sh ${path}` : undefined),
			files: [{ path: ".runner/run.sh", content: 'bash "$1"\n' }],
		};
		const extraction = await extractTask(dir, "solved", {
			testRunner: runner,
			cloneIgnored: ["node_modules"],
			timeoutSec: 10,
		});

		if (!extraction.ok) throw new Error(extraction.reason);
		expect(extraction.task.oracles.map(({ path }) => path)).toEqual(["tests/deps.test.sh", "tests/value.test.sh"]);
		expect(extraction.task.spec.files.at(-1)).toEqual({ path: ".runner/run.sh", content: 'bash "$1"\n' });
		expect(extraction.task.spec.gates[1]?.run).toBe("bash .runner/run.sh tests/value.test.sh");
	});

	it("reports a task that is not closed in the ledger history", async () => {
		const { dir } = ledgerRepo();
		const extraction = await extractTask(dir, "open", { testRunner, cloneIgnored: [], timeoutSec: 10 });

		expect(extraction).toEqual({
			ok: false,
			id: "open",
			reason: "the task is not closed: HEAD has no .ledger/history/open/task.md",
			excluded: [],
		});
	});

	it("runs a Vitest file that the repository's own include list leaves out", async () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "apple-pi-eval-vitest-")));
		dirs.push(dir);
		symlinkSync(join(process.cwd(), "node_modules"), join(dir, "node_modules"));
		writeFileSync(join(dir, "vitest.config.ts"), 'export default { test: { include: ["listed/**/*.test.ts"] } };\n');
		mkdirSync(join(dir, "unlisted"));
		writeFileSync(
			join(dir, "unlisted", "x.test.ts"),
			'import { expect, it } from "vitest";\nit("runs", () => expect(1).toBe(1));\n',
		);
		const path = "unlisted/x.test.ts";

		const plain = await runCommand(`./node_modules/.bin/vitest run ${path}`, dir, 60, { CI: "1" });
		expect(plain.exitCode).not.toBe(0);
		for (const file of repositoryTestRunner.files) {
			mkdirSync(dirname(join(dir, file.path)), { recursive: true });
			writeFileSync(join(dir, file.path), file.content);
		}
		const run = await runCommand(repositoryTestRunner.command(path) as string, dir, 60, { CI: "1" });
		expect(run.exitCode, run.stdout + run.stderr).toBe(0);
		expect(run.stdout).toContain("1 passed");
	});
});
