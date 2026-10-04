import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** A git repository in `dir` with `files` committed as its first commit. */
export function initRepo(dir: string, files: Record<string, string>): void {
	const run = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
	run("init", "-q", "-b", "main");
	run("config", "user.name", "test");
	run("config", "user.email", "test@localhost");
	run("config", "commit.gpgsign", "false");
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), content);
	}
	run("add", "-A");
	run("commit", "-q", "-m", "initial");
}

export function gitOut(dir: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

function commit(dir: string, files: Record<string, string>, message: string): void {
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), content);
	}
	execFileSync("git", ["add", "-A"], { cwd: dir });
	execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir });
}

/**
 * A repository whose closed task `value` makes `src/value` hold 2, with a shell test and a Node test
 * (which the repository's own runner recognizes) that prove it.
 */
export function taskRepo(tempDir: (prefix: string) => string): string {
	const dir = tempDir("apple-pi-eval-run-");
	initRepo(dir, { "src/value": "1\n", ".gitignore": "node_modules/\n" });
	mkdirSync(join(dir, "node_modules"));
	writeFileSync(join(dir, "node_modules", "dep"), "dep\n");
	commit(
		dir,
		{
			".ledger/value/task.md": "# Make src/value hold 2\n",
			"tests/value.test.sh": "grep -qx 2 src/value\n",
			"tests/value.test.mjs":
				'import { readFileSync } from "node:fs";\nprocess.exit(readFileSync("src/value", "utf8") === "2\\n" ? 0 : 1);\n',
		},
		"add",
	);
	const tests = gitOut(dir, "rev-parse", "HEAD");
	commit(dir, { "src/value": "2\n" }, "fix");
	const fix = gitOut(dir, "rev-parse", "HEAD");
	// The bundle cites the task's commits: that is its evidence.
	writeFileSync(
		join(dir, ".ledger", "value", "task.md"),
		`# Make src/value hold 2\n\nDone in ${tests.slice(0, 7)} and ${fix.slice(0, 7)}.\n`,
	);
	mkdirSync(join(dir, ".ledger", "history"));
	renameSync(join(dir, ".ledger", "value"), join(dir, ".ledger", "history", "value"));
	commit(dir, {}, "close value");
	return dir;
}
