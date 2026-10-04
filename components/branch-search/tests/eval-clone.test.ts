import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cloneAt } from "../eval/clone.js";
import { gitOut, initRepo } from "./fixtures.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

function fails(dir: string, ...args: string[]): boolean {
	try {
		execFileSync("git", args, { cwd: dir, stdio: "pipe" });
		return false;
	} catch {
		return true;
	}
}

describe("evaluation clones", { timeout: 30_000 }, () => {
	it("hold only the history reachable from the base, so the solution and the oracle tests cannot be read", async () => {
		const repo = realpathSync(mkdtempSync(join(tmpdir(), "apple-pi-eval-source-")));
		cleanups.push(() => rmSync(repo, { recursive: true, force: true }));
		initRepo(repo, { "src/value": "1\n", ".gitignore": "node_modules/\n" });
		mkdirSync(join(repo, "node_modules"));
		writeFileSync(join(repo, "node_modules", "dep"), "dep\n");
		const base = gitOut(repo, "rev-parse", "HEAD");
		writeFileSync(join(repo, "tests.test.sh"), "grep -qx 2 src/value # oracle\n");
		writeFileSync(join(repo, "src/value"), "2\n");
		execFileSync("git", ["add", "-A"], { cwd: repo });
		execFileSync("git", ["commit", "-q", "-m", "solution"], { cwd: repo });
		execFileSync("git", ["tag", "v1"], { cwd: repo });
		const final = gitOut(repo, "rev-parse", "HEAD");
		const oracleBlob = gitOut(repo, "rev-parse", `${final}:tests.test.sh`);
		const refsBefore = gitOut(repo, "for-each-ref", "--format=%(refname) %(objectname)");

		const clone = await cloneAt(repo, base, ["node_modules"]);
		cleanups.push(clone.dispose);

		expect(gitOut(clone.dir, "rev-parse", "HEAD")).toBe(base);
		expect(gitOut(clone.dir, "status", "--porcelain")).toBe("");
		expect(readFileSync(join(clone.dir, "node_modules", "dep"), "utf8")).toBe("dep\n");
		// Neither the final commit, nor the oracle test's blob, nor any later ref reaches the clone.
		expect(fails(clone.dir, "cat-file", "-e", final)).toBe(true);
		expect(fails(clone.dir, "cat-file", "-e", oracleBlob)).toBe(true);
		expect(gitOut(clone.dir, "for-each-ref", "--format=%(refname)")).not.toMatch(/v1|origin/);
		expect(gitOut(clone.dir, "log", "--all", "--format=%H")).toBe(base);
		expect(gitOut(clone.dir, "remote")).toBe("");
		// The source repository gets no lasting ref.
		expect(gitOut(repo, "for-each-ref", "--format=%(refname) %(objectname)")).toBe(refsBefore);

		clone.dispose();
		expect(existsSync(clone.dir)).toBe(false);
	});
});
