import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { openGit } from "../src/backend/git.js";
import { type GitAction, isGitDiff, isGitLog, isGitRun } from "../src/git.js";

let base: string, root: string, remote: string, other: string;
const api = openGit();
const run = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
const git = (...args: string[]) => run(root, ...args);
const write = (path: string, text: string, at = root) => fs.writeFileSync(join(at, path), text);
const act = async (action: GitAction) => {
	const result = await api.run({ root, action });
	if (!result.ok) throw new Error(result.reason);
	return result.output;
};
const overview = async () => {
	const result = await api.overview({ root });
	if (!result.ok) throw new Error(result.reason);
	return result.overview;
};

function identity(at: string) {
	run(at, "config", "user.name", "Git Test");
	run(at, "config", "user.email", "git@example.invalid");
}

beforeEach(() => {
	base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "git-test-")));
	remote = join(base, "remote.git");
	root = join(base, "repo");
	other = join(base, "other");
	execFileSync("git", ["init", "--bare", "-b", "main", remote]);
	execFileSync("git", ["clone", "-q", remote, root]);
	identity(root);
	write("hello.ts", "export const value = 1;\n");
	git("add", "hello.ts");
	git("commit", "-q", "-m", "first");
	git("push", "-q", "-u", "origin", "main");
	execFileSync("git", ["clone", "-q", remote, other]);
	identity(other);
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

test("status and diffs read staged, unstaged, untracked and renamed paths literally without changing the index", async () => {
	git("mv", "hello.ts", "renamed [file].ts");
	write("renamed [file].ts", "worktree change\n");
	write("untracked.ts", "untracked\n");
	const index = fs.readFileSync(join(root, ".git/index"));
	const info = await overview();
	expect(info).toMatchObject({ branch: "main", upstream: "origin/main", ahead: 0, behind: 0, state: "clean" });
	expect(info.changes).toEqual([
		{ path: "renamed [file].ts", previousPath: "hello.ts", index: "R", worktree: "M" },
		{ path: "untracked.ts", index: "?", worktree: "?" },
	]);
	expect(await api.diff({ root, path: "renamed [file].ts", staged: false })).toMatchObject({
		ok: true,
		text: expect.stringContaining("+worktree change"),
	});
	expect(await api.diff({ root, path: "renamed [file].ts", staged: true })).toMatchObject({
		ok: true,
		text: expect.stringContaining("export const value = 1"),
	});
	expect(await api.diff({ root, path: "untracked.ts", staged: false })).toMatchObject({
		ok: true,
		text: expect.stringContaining("+untracked"),
	});
	expect(await api.diff({ root, path: "../private", staged: false })).toMatchObject({ ok: false });
	expect(fs.readFileSync(join(root, ".git/index"))).toEqual(index);
	git("checkout", "-q", "--detach");
	expect(await overview()).toMatchObject({ branch: null, head: expect.stringMatching(/^[0-9a-f]{40}$/) });
});

test("a subdirectory is refused with the repository root to open", async () => {
	fs.mkdirSync(join(root, "sub"));
	expect(await api.overview({ root: join(root, "sub") })).toMatchObject({
		ok: false,
		reason: expect.stringContaining("Open the repository root"),
	});
});

test("stage, unstage, discard and commit, including a multi-line message and an amend", async () => {
	write("hello.ts", "export const value = 2;\n");
	write("new [file].ts", "new\n");
	await act({ kind: "stage", paths: ["hello.ts", "new [file].ts"] });
	expect((await overview()).changes.map((change) => [change.path, change.index, change.worktree])).toEqual([
		["hello.ts", "M", " "],
		["new [file].ts", "A", " "],
	]);
	await act({ kind: "unstage", paths: ["new [file].ts"] });
	expect((await overview()).changes.find((change) => change.path === "new [file].ts")).toMatchObject({
		index: "?",
		worktree: "?",
	});
	await act({ kind: "commit", message: "Second change\n\nWith a body line.", amend: false });
	expect(git("log", "-1", "--format=%B").trim()).toBe("Second change\n\nWith a body line.");
	await act({ kind: "commit", message: "Second change, amended", amend: true });
	expect(git("log", "--format=%s")).toBe("Second change, amended\nfirst");
	write("hello.ts", "export const value = 3;\n");
	await act({ kind: "discard", paths: ["hello.ts", "new [file].ts"] });
	expect(fs.readFileSync(join(root, "hello.ts"), "utf8")).toBe("export const value = 2;\n");
	expect(fs.existsSync(join(root, "new [file].ts"))).toBe(false);
	expect((await overview()).changes).toEqual([]);
	expect(await api.run({ root, action: { kind: "commit", message: "  ", amend: false } })).toMatchObject({
		ok: false,
		reason: "Write a commit message.",
	});
});

test("branches: create, check out, merge, a remote branch becomes a tracking branch, delete", async () => {
	await act({ kind: "createBranch", name: "feature/one", from: "main", checkout: true });
	write("feature.ts", "feature\n");
	await act({ kind: "stage", paths: ["feature.ts"] });
	await act({ kind: "commit", message: "feature work", amend: false });
	await act({ kind: "checkout", ref: "main" });
	await act({ kind: "merge", ref: "feature/one" });
	expect(fs.existsSync(join(root, "feature.ts"))).toBe(true);
	await act({ kind: "deleteBranch", name: "feature/one", force: false });
	expect((await overview()).refs.some((ref) => ref.name === "feature/one")).toBe(false);
	run(other, "switch", "-q", "-c", "remote-topic");
	write("topic.ts", "topic\n", other);
	run(other, "add", "topic.ts");
	run(other, "commit", "-q", "-m", "topic");
	run(other, "push", "-q", "-u", "origin", "remote-topic");
	await act({ kind: "fetch" });
	expect((await overview()).refs).toContainEqual(
		expect.objectContaining({ name: "origin/remote-topic", kind: "remote" }),
	);
	await act({ kind: "checkout", ref: "origin/remote-topic" });
	expect(await overview()).toMatchObject({ branch: "remote-topic", upstream: "origin/remote-topic" });
	expect(await api.run({ root, action: { kind: "checkout", ref: "--upload-pack=touch /tmp/x" } })).toMatchObject({
		ok: false,
	});
});

test("pull and push: ahead and behind counts, setting an upstream on first push", async () => {
	write("local.ts", "local\n");
	await act({ kind: "stage", paths: ["local.ts"] });
	await act({ kind: "commit", message: "local", amend: false });
	expect(await overview()).toMatchObject({ ahead: 1, behind: 0 });
	await act({ kind: "push", force: false });
	expect(run(other, "ls-remote", "origin", "main").split("\t")[0]).toBe(git("rev-parse", "HEAD"));
	run(other, "pull", "-q");
	write("theirs.ts", "theirs\n", other);
	run(other, "add", "theirs.ts");
	run(other, "commit", "-q", "-m", "theirs");
	run(other, "push", "-q");
	await act({ kind: "fetch" });
	expect(await overview()).toMatchObject({ ahead: 0, behind: 1 });
	await act({ kind: "pull" });
	expect(fs.existsSync(join(root, "theirs.ts"))).toBe(true);
	await act({ kind: "createBranch", name: "fresh", from: "HEAD", checkout: true });
	expect(await overview()).toMatchObject({ branch: "fresh", upstream: null });
	await act({ kind: "push", force: false });
	expect(await overview()).toMatchObject({ branch: "fresh", upstream: "origin/fresh" });
});

test("stash save, apply, pop and drop", async () => {
	write("hello.ts", "stashed\n");
	write("loose.ts", "loose\n");
	await act({ kind: "stashSave", message: "work in progress", untracked: true });
	let info = await overview();
	expect(info.changes).toEqual([]);
	expect(info.stashes).toEqual([{ index: 0, date: expect.any(Number), message: "On main: work in progress" }]);
	await act({ kind: "stashApply", index: 0 });
	expect(fs.readFileSync(join(root, "hello.ts"), "utf8")).toBe("stashed\n");
	git("checkout", "-q", "--", "hello.ts");
	fs.rmSync(join(root, "loose.ts"));
	await act({ kind: "stashPop", index: 0 });
	expect(fs.existsSync(join(root, "loose.ts"))).toBe(true);
	await act({ kind: "stashSave", message: "", untracked: true });
	await act({ kind: "stashDrop", index: 0 });
	info = await overview();
	expect(info.stashes).toEqual([]);
});

test("history: the graph log, a commit's files, its diffs, tags, cherry-pick, revert and reset", async () => {
	await act({ kind: "createBranch", name: "side", from: "main", checkout: true });
	git("mv", "hello.ts", "moved.ts");
	write("side.ts", "side\n");
	git("add", "side.ts");
	git("commit", "-q", "-m", "side work");
	const side = git("rev-parse", "HEAD");
	await act({ kind: "checkout", ref: "main" });
	write("main.ts", "main\n");
	git("add", "main.ts");
	git("commit", "-q", "-m", "main work");
	await act({ kind: "merge", ref: "side" });
	await act({ kind: "createTag", name: "v1.0", sha: "HEAD" });
	const log = await api.log({ root, skip: 0, limit: 50 });
	if (!log.ok) throw new Error(log.reason);
	const subjects = log.commits.map((commit) => commit.subject);
	expect(subjects[0]).toBe("Merge branch 'side'");
	expect(subjects.at(-1)).toBe("first");
	expect(subjects.slice(1, 3).sort()).toEqual(["main work", "side work"]);
	expect(log.commits[0].parents).toHaveLength(2);
	expect(log.commits[0].refs).toEqual(expect.arrayContaining(["HEAD -> main", "tag: v1.0"]));
	expect(log.commits.at(-1)?.refs).toContain("origin/main");
	const page = await api.log({ root, skip: 1, limit: 1 });
	expect(page).toMatchObject({ ok: true, commits: [{ subject: subjects[1] }] });
	const detail = await api.show({ root, sha: side });
	expect(detail).toMatchObject({
		ok: true,
		commit: {
			subject: "side work",
			files: [
				{ status: "R", previousPath: "hello.ts", path: "moved.ts" },
				{ status: "A", path: "side.ts" },
			],
		},
	});
	expect(await api.diff({ root, path: "side.ts", commit: side })).toMatchObject({
		ok: true,
		text: expect.stringContaining("+side"),
	});
	const first = git("rev-list", "--max-parents=0", "HEAD");
	expect(await api.show({ root, sha: first })).toMatchObject({
		ok: true,
		commit: { files: [{ status: "A", path: "hello.ts" }] },
	});
	await act({ kind: "revert", sha: "HEAD~1" });
	expect(fs.existsSync(join(root, "main.ts"))).toBe(false);
	await act({ kind: "reset", sha: "HEAD~1", mode: "hard" });
	expect(fs.existsSync(join(root, "main.ts"))).toBe(true);
	await act({ kind: "createBranch", name: "pick", from: first, checkout: true });
	await act({ kind: "cherryPick", sha: side });
	expect(fs.existsSync(join(root, "side.ts"))).toBe(true);
	await act({ kind: "deleteTag", name: "v1.0" });
	expect((await overview()).refs.some((ref) => ref.kind === "tag")).toBe(false);
	const after = await api.log({ root, skip: 0, limit: 50 });
	if (!after.ok) throw new Error(after.reason);
	expect(after.commits.find((commit) => commit.refs.includes("HEAD -> pick"))?.subject).toBe("side work");
});

test("a conflicted merge reports its state and can be aborted", async () => {
	await act({ kind: "createBranch", name: "clash", from: "main", checkout: true });
	write("hello.ts", "clash\n");
	git("commit", "-q", "-am", "clash");
	await act({ kind: "checkout", ref: "main" });
	write("hello.ts", "main\n");
	git("commit", "-q", "-am", "main");
	expect(await api.run({ root, action: { kind: "merge", ref: "clash" } })).toMatchObject({ ok: false });
	expect(await overview()).toMatchObject({ state: "merging" });
	await act({ kind: "abort" });
	expect(await overview()).toMatchObject({ state: "clean", changes: [] });
	expect(await api.run({ root, action: { kind: "abort" } })).toMatchObject({
		ok: false,
		reason: expect.stringContaining("No merge"),
	});
});

test("a resolved merge or rebase continues without an editor, and a commit checks out detached", async () => {
	await act({ kind: "createBranch", name: "clash", from: "main", checkout: true });
	write("hello.ts", "clash\n");
	git("commit", "-q", "-am", "clash");
	const clash = git("rev-parse", "HEAD");
	await act({ kind: "checkout", ref: "main" });
	write("hello.ts", "main\n");
	git("commit", "-q", "-am", "main");
	expect(await api.run({ root, action: { kind: "merge", ref: "clash" } })).toMatchObject({ ok: false });
	write("hello.ts", "merged\n");
	await act({ kind: "stage", paths: ["hello.ts"] });
	await act({ kind: "continue" });
	expect(await overview()).toMatchObject({ state: "clean", changes: [] });
	expect(git("rev-list", "--parents", "-n", "1", "HEAD").split(" ")).toHaveLength(3);

	await act({ kind: "createBranch", name: "onto", from: `${clash}~1`, checkout: true });
	write("hello.ts", "rebased\n");
	git("commit", "-q", "-am", "rebased change");
	expect(await api.run({ root, action: { kind: "rebase", onto: "clash" } })).toMatchObject({ ok: false });
	expect(await overview()).toMatchObject({ state: "rebasing" });
	write("hello.ts", "resolved\n");
	await act({ kind: "stage", paths: ["hello.ts"] });
	await act({ kind: "continue" });
	expect(await overview()).toMatchObject({ state: "clean", branch: "onto" });
	expect(git("log", "-1", "--format=%s")).toBe("rebased change");
	expect(git("rev-parse", "HEAD~1")).toBe(clash);

	await act({ kind: "checkoutCommit", sha: clash });
	expect(await overview()).toMatchObject({ branch: null, head: clash });
});

test("an empty repository has no history and its first commit works", async () => {
	const empty = join(base, "empty");
	execFileSync("git", ["init", "-q", "-b", "main", empty]);
	identity(empty);
	expect(await api.log({ root: empty, skip: 0, limit: 10 })).toEqual({ ok: true, commits: [] });
	fs.writeFileSync(join(empty, "a.txt"), "a\n");
	expect(await api.run({ root: empty, action: { kind: "stage", paths: ["a.txt"] } })).toMatchObject({ ok: true });
	expect(await api.run({ root: empty, action: { kind: "unstage", paths: ["a.txt"] } })).toMatchObject({ ok: true });
	expect(await api.run({ root: empty, action: { kind: "stage", paths: ["a.txt"] } })).toMatchObject({ ok: true });
	expect(await api.run({ root: empty, action: { kind: "commit", message: "start", amend: false } })).toMatchObject({
		ok: true,
	});
	expect(await api.overview({ root: empty })).toMatchObject({ ok: true, overview: { branch: "main", upstream: null } });
});

test("IPC shapes accept only known actions with their fields", () => {
	expect(isGitRun({ root, action: { kind: "stage", paths: ["a"] } })).toBe(true);
	expect(isGitRun({ root, action: { kind: "stage", paths: "a" } })).toBe(false);
	expect(isGitRun({ root, action: { kind: "reset", sha: "HEAD", mode: "nuke" } })).toBe(false);
	expect(isGitRun({ root, action: { kind: "shell", command: "rm -rf /" } })).toBe(false);
	expect(isGitRun({ root, action: { kind: "fetch" } })).toBe(true);
	expect(isGitLog({ root, skip: 0, limit: 10 })).toBe(true);
	expect(isGitLog({ root, skip: -1, limit: 10 })).toBe(false);
	expect(isGitDiff({ root, path: "a", staged: true })).toBe(true);
	expect(isGitDiff({ root, path: "a", commit: "HEAD" })).toBe(true);
	expect(isGitDiff({ root, path: "a" })).toBe(false);
});
