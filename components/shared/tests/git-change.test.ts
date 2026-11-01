import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, realpath, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { gitBytes } from "../src/git.js";
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

test("index promises, cached conversions and every attribute source cannot hide raw working-tree bytes", async () => {
	const cwd = await repository();
	const marker = join(cwd, "..", `${cwd.split("/").pop()}-filter-ran`);
	directories.push(marker);
	await writeFile(join(cwd, ".gitattributes"), "*.txt text=auto\n");
	await writeFile(join(cwd, "crlf.txt"), "one\r\ntwo\r\n");
	git(cwd, "add", ".");
	git(cwd, "commit", "-qm", "normalized");
	// Git stored LF; the disk keeps CRLF and the stat cache calls it clean once the second has passed.
	await new Promise((resolve) => setTimeout(resolve, 1100));
	git(cwd, "status", "--porcelain");
	git(cwd, "config", "filter.trip.clean", `sh -c 'touch ${marker}; tr a-z A-Z'`);
	await writeFile(join(cwd, ".git/info/attributes"), "value.ts filter=trip\n");
	const attributes = join(cwd, "..", `${cwd.split("/").pop()}-attributes`);
	directories.push(attributes);
	await writeFile(attributes, "caller.ts filter=trip\n");
	git(cwd, "config", "core.attributesFile", attributes);
	git(cwd, "update-index", "--assume-unchanged", "value.ts");
	await writeFile(join(cwd, "value.ts"), "hidden by assume-unchanged\n");
	git(cwd, "update-index", "--skip-worktree", "caller.ts");
	await writeFile(join(cwd, "caller.ts"), "hidden by skip-worktree\n");
	const change = await openGitChange(cwd, { kind: "working-tree", base: "HEAD" });
	try {
		expect((await change.read("after", "crlf.txt"))?.toString()).toBe("one\r\ntwo\r\n");
		expect((await change.read("after", "value.ts"))?.toString()).toBe("hidden by assume-unchanged\n");
		expect((await change.read("after", "caller.ts"))?.toString()).toBe("hidden by skip-worktree\n");
	} finally {
		await change.close();
	}
	await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
	expect(git(cwd, "ls-files", "-v", "value.ts", "caller.ts")).toBe("S caller.ts\nh value.ts");
});

test("repository paths with colons or newlines and revision ranges as endpoints are handled exactly", async () => {
	const parent = await mkdtemp(join(tmpdir(), "git-change-paths-"));
	directories.push(parent);
	for (const name of ["with:colon", "with\nnewline"]) {
		const cwd = join(parent, name);
		execFileSync("git", ["init", "-q", "-b", "main", cwd]);
		git(cwd, "config", "user.email", "t@example.com");
		git(cwd, "config", "user.name", "T");
		await writeFile(join(cwd, "a.txt"), "one\n");
		git(cwd, "add", ".");
		git(cwd, "commit", "-qm", "base");
		await writeFile(join(cwd, "a.txt"), "two\n");
		const change = await openGitChange(cwd, { kind: "working-tree", base: "HEAD" });
		try {
			expect(change.repository).toBe(await realpath(cwd));
			expect((await change.read("after", "a.txt"))?.toString()).toBe("two\n");
			expect((await change.read("before", "a.txt"))?.toString()).toBe("one\n");
		} finally {
			await change.close();
		}
	}
	const cwd = await repository();
	await expect(openGitChange(cwd, { kind: "range", base: "HEAD", head: "HEAD..HEAD" })).rejects.toThrow(
		"exactly one commit",
	);
});

test("intent-to-add entries are part of the index identity, large blobs read intact, and close is terminal", async () => {
	const cwd = await repository();
	await writeFile(join(cwd, "planned.ts"), "");
	git(cwd, "add", "-N", "planned.ts");
	const large = Buffer.alloc(24 * 1024 * 1024, 7);
	await writeFile(join(cwd, "large.bin"), large);
	const change = await openGitChange(cwd, { kind: "working-tree", base: "HEAD" });
	expect(change.indexEntries?.map((entry) => entry.path)).toContain("planned.ts");
	expect((await change.read("after", "large.bin"))?.equals(large)).toBe(true);
	await change.close();
	await expect(change.read("after", "value.ts")).rejects.toThrow("closed");
	await expect(change.git(["rev-parse", "HEAD"])).rejects.toThrow("closed");
});

test("a lone skip-worktree edit is captured, and a Git process ignoring TERM still settles its deadline", async () => {
	const cwd = await repository();
	git(cwd, "update-index", "--skip-worktree", "caller.ts");
	await writeFile(join(cwd, "caller.ts"), "only skip-worktree\n");
	const change = await openGitChange(cwd, { kind: "working-tree", base: "HEAD" });
	try {
		expect((await change.read("after", "caller.ts"))?.toString()).toBe("only skip-worktree\n");
	} finally {
		await change.close();
	}
	git(cwd, "config", "alias.stubborn", "!trap '' TERM; sleep 30");
	const started = Date.now();
	await expect(gitBytes(cwd, ["stubborn"], { timeoutMs: 200 })).rejects.toThrow("timed out");
	expect(Date.now() - started).toBeLessThan(10_000);
	await expect(gitBytes(cwd, ["log", "--no-such-option"], { maxBytes: 4 })).rejects.toThrow("error output exceeded");
});
