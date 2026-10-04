import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { git } from "../../shared/src/git.js";
import { runCommand } from "../../shared/src/run-command.js";
import { type Clone, cloneAt, showFile } from "./clone.js";

/**
 * Evaluation tasks from closed ledger tasks. A task's commits are the ones its bundle cites:
 * every commit hash in any of its files that resolves to a commit of this repository. Tasks interleave,
 * so the range from the bundle's creation to its archiving is not the task's work. The cited commits
 * must form one line of history; the base is the parent of the oldest, the final state the newest, the
 * goal the closed `task.md`, and the oracle gates the test files the cited commits add or change that
 * fail on the base (with their final version copied in) and pass on the final commit. The evaluation
 * configuration may instead give a task's base, final commit, and test files explicitly.
 */

export interface OracleGate {
	/** The test file, relative to the repository root. */
	path: string;
	/** The shell command that runs it, from the repository root. */
	command: string;
}

export interface EvalTask {
	id: string;
	goal: string;
	base: string;
	final: string;
	/** `cited`: the commits the bundle cites; `override`: the configuration's base and final commit. */
	provenance: "cited" | "override";
	/** The cited commits, oldest first; with an override, every commit after the base up to the final one. */
	commits: string[];
	oracles: OracleGate[];
	/** What scoring installs over a final state: the oracles' final test files and the runner's support files. */
	files: { path: string; content: string }[];
}

/** A changed test file that is no oracle, and why. */
export interface Excluded {
	path: string;
	reason: "passes on the base" | "fails on the final state";
}

export type Extraction =
	| { ok: true; task: EvalTask; excluded: Excluded[] }
	| { ok: false; id: string; reason: string; excluded: Excluded[] };

/** How a repository's test files run as oracle gates. */
export interface TestRunner {
	/** The command that runs one test file from the repository root, or undefined when the path is no test file. */
	command: (path: string) => string | undefined;
	/**
	 * Files the commands need that the repository may lack at the base, such as a runner configuration.
	 * Installed in both extraction clones and with the oracle's test files before every oracle run.
	 */
	files: { path: string; content: string }[];
}

export interface ExtractOptions {
	testRunner: TestRunner;
	/** Ignored directories cloned into each clone, such as `node_modules`. */
	cloneIgnored: string[];
	/** Per test run. */
	timeoutSec: number;
	/** The configuration's explicit boundaries for this task, used instead of the bundle's evidence. */
	override?: TaskOverride;
	signal?: AbortSignal;
}

/** A task's boundaries given explicitly; `tests` defaults to the test files changed from base to final. */
export interface TaskOverride {
	base: string;
	final: string;
	tests?: string[];
}

const LEDGER = ".ledger";
const HISTORY = `${LEDGER}/history`;

const VITEST_CONFIG = ".apple-pi-eval/vitest.config.mjs";

/**
 * Test files of this repository: Vitest suites, and the Node-run `.test.mjs` harnesses. Vitest runs
 * under the harness's own configuration, because the repository's allowlists its test directories: a
 * test in a directory the base does not list would fail there with "No test files found", and on any
 * final state that does not add that directory, for reasons unrelated to the behavior it tests.
 */
export const repositoryTestRunner: TestRunner = {
	command(path) {
		if (/\.test\.mjs$/.test(path)) return `PI_DIST=$PWD/node_modules/@earendil-works/pi-coding-agent/dist node ${path}`;
		if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(path))
			return `./node_modules/.bin/vitest run --config ${VITEST_CONFIG} --root . ${path}`;
		return undefined;
	},
	files: [
		{
			path: VITEST_CONFIG,
			content: 'export default { test: { environment: "node", include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)"] } };\n',
		},
	],
};

/** The ids of the tasks whose bundle is in the ledger history at HEAD. */
export async function closedTaskIds(repo: string): Promise<string[]> {
	const files = (await git(repo, ["ls-tree", "-r", "--name-only", "HEAD", "--", HISTORY])).split("\n");
	const pattern = new RegExp(`^${HISTORY.replace(".", "\\.")}/([^/]+)/task\\.md$`);
	return files.flatMap((file) => pattern.exec(file)?.[1] ?? []).sort();
}

/** The full ids of the commits that `text` cites: hex words of 7 to 40 characters that name a commit here. */
async function citedIn(repo: string, text: string): Promise<string[]> {
	const words = new Set(text.match(/\b[0-9a-f]{7,40}\b/g) ?? []);
	const commits = new Set<string>();
	for (const word of words) {
		// Resolving is the filter: a word that names no commit (or several) is no evidence. A short hash
		// may be all digits, so numbers are not skipped; one that names a commit by chance is vanishingly rare.
		const commit = await git(repo, ["rev-parse", "--verify", "--quiet", `${word}^{commit}`]).catch(() => undefined);
		if (commit) commits.add(commit);
	}
	return [...commits];
}

async function isAncestor(repo: string, ancestor: string, descendant: string): Promise<boolean> {
	return git(repo, ["merge-base", "--is-ancestor", ancestor, descendant]).then(
		() => true,
		() => false,
	);
}

/** Test files (outside the ledger) that `commit` adds or modifies. */
async function testsChangedIn(repo: string, commit: string, runner: TestRunner): Promise<string[]> {
	const changed = await git(repo, [
		"diff-tree",
		"--root",
		"--no-commit-id",
		"-r",
		"--name-only",
		"--no-renames",
		"--diff-filter=AM",
		"-z",
		commit,
	]);
	return changed.split("\0").filter((path) => isCandidate(path, runner));
}

function isCandidate(path: string, runner: TestRunner): boolean {
	return path !== "" && !path.startsWith(`${LEDGER}/`) && runner.command(path) !== undefined;
}

async function existsAt(repo: string, commit: string, path: string): Promise<boolean> {
	return git(repo, ["cat-file", "-e", `${commit}:${path}`]).then(
		() => true,
		() => false,
	);
}

export type Evidence =
	| {
			ok: true;
			provenance: "cited" | "override";
			base: string;
			final: string;
			commits: string[];
			/** Test files to try as oracles, sorted; each exists at the final commit. */
			candidates: string[];
	  }
	| { ok: false; reason: string };

/**
 * A closed task's boundaries without running anything: from the override when one is given, otherwise
 * from the commits its bundle cites at HEAD. Reads the repository only.
 */
export async function taskEvidence(
	repo: string,
	id: string,
	runner: TestRunner,
	override?: TaskOverride,
): Promise<Evidence> {
	const fail = (reason: string): Evidence => ({ ok: false, reason });
	const sorted = async (paths: Iterable<string>, final: string) => {
		const kept: string[] = [];
		for (const path of new Set(paths))
			if (isCandidate(path, runner) && (await existsAt(repo, final, path))) kept.push(path);
		return kept.sort();
	};
	if (override) {
		const resolve = (name: string) =>
			git(repo, ["rev-parse", "--verify", "--quiet", `${name}^{commit}`]).catch(() => undefined);
		const [base, final] = [await resolve(override.base), await resolve(override.final)];
		if (!base) return fail(`the override's base ${override.base} is no commit of this repository`);
		if (!final) return fail(`the override's final ${override.final} is no commit of this repository`);
		if (!(await isAncestor(repo, base, final)))
			return fail("the override's base is not an ancestor of its final commit");
		const commits = (await git(repo, ["rev-list", "--reverse", `${base}..${final}`])).split("\n").filter(Boolean);
		const changed =
			override.tests ??
			(
				await git(repo, ["diff", "--no-ext-diff", "--name-only", "--no-renames", "--diff-filter=AM", "-z", base, final])
			).split("\0");
		return { ok: true, provenance: "override", base, final, commits, candidates: await sorted(changed, final) };
	}

	const bundle = `${HISTORY}/${id}/`;
	const files = (await git(repo, ["ls-tree", "-r", "--name-only", "HEAD", "--", bundle])).split("\n").filter(Boolean);
	const cited = new Set<string>();
	for (const file of files)
		for (const commit of await citedIn(repo, await showFile(repo, "HEAD", file))) cited.add(commit);
	if (cited.size === 0)
		return fail("the bundle cites no commit of this repository, and the configuration gives no override for it");
	// Oldest first: a commit's place is the number of the other cited commits that are its ancestors.
	const ranked: { commit: string; ancestors: number }[] = [];
	for (const commit of cited) {
		let ancestors = 0;
		for (const other of cited) if (other !== commit && (await isAncestor(repo, other, commit))) ancestors++;
		ranked.push({ commit, ancestors });
	}
	const commits = ranked.sort((a, b) => a.ancestors - b.ancestors).map(({ commit }) => commit);
	for (let i = 1; i < commits.length; i++) {
		if (!(await isAncestor(repo, commits[i - 1] as string, commits[i] as string)))
			return fail(
				`ambiguous provenance: the cited commits ${[...cited].sort().join(", ")} do not form one line of history`,
			);
	}
	const oldest = commits[0] as string;
	const final = commits.at(-1) as string;
	const base = await git(repo, ["rev-parse", "--verify", "--quiet", `${oldest}^`]).catch(() => undefined);
	if (!base) return fail(`the oldest cited commit, ${oldest}, has no parent`);
	const changed: string[] = [];
	for (const commit of commits) changed.push(...(await testsChangedIn(repo, commit, runner)));
	return { ok: true, provenance: "cited", base, final, commits, candidates: await sorted(changed, final) };
}

/** Derive a closed task's base, final commit, goal, and oracle gates, or say why it cannot be evaluated. */
export async function extractTask(repo: string, id: string, options: ExtractOptions): Promise<Extraction> {
	const fail = (reason: string, excluded: Excluded[] = []): Extraction => ({ ok: false, id, reason, excluded });
	const runner = options.testRunner;
	const closedPath = `${HISTORY}/${id}/task.md`;
	if (!(await existsAt(repo, "HEAD", closedPath))) return fail(`the task is not closed: HEAD has no ${closedPath}`);
	const goal = await showFile(repo, "HEAD", closedPath);
	const evidence = await taskEvidence(repo, id, runner, options.override);
	if (!evidence.ok) return fail(evidence.reason);
	const { base, final, commits, provenance, candidates: changed } = evidence;
	if (changed.length === 0) return fail("no test file was added or changed in the task's commits");

	const contents = new Map<string, string>();
	for (const path of changed) contents.set(path, await showFile(repo, final, path));
	const oracles: OracleGate[] = [];
	const excluded: Excluded[] = [];
	const clones: Clone[] = [];
	try {
		const atFinal = await cloneAt(repo, final, options.cloneIgnored);
		clones.push(atFinal);
		const atBase = await cloneAt(repo, base, options.cloneIgnored);
		clones.push(atBase);
		const install = (dir: string, files: Iterable<[string, string]>) => {
			for (const [path, content] of files) {
				mkdirSync(dirname(join(dir, path)), { recursive: true });
				writeFileSync(join(dir, path), content);
			}
		};
		const support = runner.files.map(({ path, content }): [string, string] => [path, content]);
		install(atFinal.dir, support);
		install(atBase.dir, [...contents, ...support]);
		const passes = async (dir: string, command: string) =>
			(await runCommand(command, dir, { CI: "1" }, { timeoutSec: options.timeoutSec, signal: options.signal }))
				.exitCode === 0;
		for (const path of changed) {
			options.signal?.throwIfAborted();
			const command = runner.command(path) as string;
			if (!(await passes(atFinal.dir, command))) excluded.push({ path, reason: "fails on the final state" });
			else if (await passes(atBase.dir, command)) excluded.push({ path, reason: "passes on the base" });
			else oracles.push({ path, command });
		}
	} finally {
		for (const clone of clones) clone.dispose();
	}
	if (oracles.length === 0) return fail("no changed test fails on the base and passes on the final state", excluded);

	const files = [...oracles.map(({ path }) => ({ path, content: contents.get(path) as string })), ...runner.files];
	return { ok: true, task: { id, goal, base, final, provenance, commits, oracles, files }, excluded };
}
