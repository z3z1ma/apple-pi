import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** A complete configuration; tests change the keys they exercise. */
export function validConfig(): Record<string, unknown> {
	return {
		passive: { enabled: false, repeatThreshold: 3 },
		enumerate: { count: 4 },
		branches: { perGeneration: 2, maxTotal: 6 },
		generations: { maxDepth: 0, rootsPerGeneration: 0, parentsPerGeneration: 1, childrenPerParent: 1 },
		branch: { limits: { wallClockSec: 600 } },
		scorer: { validationRetries: 1 },
		constraints: ["Add no new dependencies."],
		workspace: { cloneIgnored: ["node_modules"] },
		apply: "report",
	};
}

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
