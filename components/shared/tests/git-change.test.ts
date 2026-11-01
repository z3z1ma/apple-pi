import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { GIT_DIFF, type GitTarget, openGitChange } from "../src/git-change.js";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

async function repository() {
	const cwd = await mkdtemp(join(tmpdir(), "git-change-"));
	directories.push(cwd);
	git(cwd, "init", "-q", "-b", "main");
	git(cwd, "config", "user.email", "t@example.com");
	git(cwd, "config", "user.name", "T");
	await writeFile(join(cwd, "value.ts"), "export const value = 1;\n");
	await writeFile(join(cwd, "caller.ts"), "console.log(value);\n");
	git(cwd, "add", ".");
	git(cwd, "commit", "-qm", "base");
	return cwd;
}

async function changed(cwd: string, target: GitTarget) {
	const change = await openGitChange(cwd, target);
	try {
		const names = (await change.git([...GIT_DIFF, "--name-only", change.baseTree, change.headTree]))
			.toString()
			.split("\n")
			.filter(Boolean);
		return { change, names };
	} finally {
		await change.close();
	}
}

test("exact ranges differ from branch comparisons, and a commit compares with its parent", async () => {
	const cwd = await repository();
	const base = git(cwd, "rev-parse", "HEAD");
	git(cwd, "checkout", "-qb", "feature");
	await writeFile(join(cwd, "value.ts"), "feature\n");
	git(cwd, "commit", "-qam", "feature");
	git(cwd, "checkout", "-qb", "upstream", base);
	await writeFile(join(cwd, "caller.ts"), "upstream\n");
	git(cwd, "commit", "-qam", "upstream");
	const branch = await changed(cwd, { kind: "branch", base: "upstream", head: "feature" });
	const range = await changed(cwd, { kind: "range", base: "upstream", head: "feature" });
	expect(branch.change.baseCommit).toBe(base);
	expect(branch.names).toEqual(["value.ts"]);
	expect(range.change.baseCommit).toBe(git(cwd, "rev-parse", "upstream"));
	expect(range.names).toEqual(["caller.ts", "value.ts"]);
	const commit = await changed(cwd, { kind: "commit", commit: "feature" });
	expect(commit.change.baseCommit).toBe(base);
	expect(commit.names).toEqual(["value.ts"]);
	await expect(openGitChange(cwd, { kind: "range", base: "--output=x", head: "HEAD" })).rejects.toThrow();
});

test("working-tree and staged snapshots keep exact bytes and leave the author's index and objects alone", async () => {
	const cwd = await repository();
	await writeFile(join(cwd, "value.ts"), "staged\n");
	git(cwd, "add", "value.ts");
	await writeFile(join(cwd, "value.ts"), "  working\r\n");
	await writeFile(join(cwd, "new file.txt"), "untracked\n");
	await writeFile(join(cwd, ".gitattributes"), "* text=auto eol=crlf\n");
	await symlink("caller.ts", join(cwd, "link"));
	const index = await readFile(join(cwd, ".git/index"));
	const objects = async () => (await readdir(join(cwd, ".git/objects"), { recursive: true })).sort();
	const before = await objects();
	const working = await openGitChange(cwd, { kind: "working-tree", base: "HEAD" });
	try {
		expect((await working.read("after", "value.ts"))?.toString()).toBe("  working\r\n");
		expect((await working.read("before", "value.ts"))?.toString()).toBe("export const value = 1;\n");
		expect((await working.read("after", "new file.txt"))?.toString()).toBe("untracked\n");
		expect((await working.read("after", "link"))?.toString()).toBe("caller.ts");
		expect(await working.read("before", "new file.txt")).toBeUndefined();
	} finally {
		await working.close();
	}
	const staged = await openGitChange(cwd, { kind: "staged" });
	try {
		expect((await staged.read("after", "value.ts"))?.toString()).toBe("staged\n");
		expect(await staged.read("after", "new file.txt")).toBeUndefined();
		expect(staged.headTree).toBe(working.indexTree);
	} finally {
		await staged.close();
	}
	expect(await readFile(join(cwd, ".git/index"))).toEqual(index);
	expect(await objects()).toEqual(before);
});

test("a same-second edit with an unchanged size is not hidden by the copied index's timestamp", async () => {
	const cwd = await repository();
	const { mtime } = await stat(join(cwd, "value.ts"));
	await writeFile(join(cwd, "value.ts"), "export const value = 2;\n");
	await utimes(join(cwd, "value.ts"), mtime, mtime);
	await utimes(join(cwd, ".git/index"), mtime, mtime);
	// Snapshot in a later second: a copy stamped "now" would make the entry look clean.
	await new Promise((resolve) => setTimeout(resolve, 1100));
	const change = await openGitChange(cwd, { kind: "working-tree", base: "HEAD" });
	try {
		expect((await change.read("after", "value.ts"))?.toString()).toBe("export const value = 2;\n");
	} finally {
		await change.close();
	}
});

test("unmerged index entries are refused rather than guessed", async () => {
	const cwd = await repository();
	const blob = git(cwd, "rev-parse", "HEAD:value.ts");
	execFileSync("git", ["update-index", "--index-info"], {
		cwd,
		input: `0 ${"0".repeat(40)}\tvalue.ts\n100644 ${blob} 1\tvalue.ts\n100644 ${blob} 2\tvalue.ts\n`,
	});
	await expect(openGitChange(cwd, { kind: "staged" })).rejects.toThrow("Resolve index conflicts");
});
