import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { openWorkspace } from "../src/backend/workspace.js";
import { isWorkspaceDiff, isWorkspacePath, isWorkspaceRoot, isWorkspaceSave } from "../src/workspace.js";
import type { WorldSnapshot } from "../src/world.js";

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return { ...actual, fsyncSync: vi.fn(actual.fsyncSync) };
});

let base: string, root: string;
const snapshot: WorldSnapshot = { connected: true, characters: [], headquarters: [] };
const workspace = openWorkspace(() => snapshot);
const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
beforeEach(() => {
	base = fs.mkdtempSync(join(tmpdir(), "workspace-test-"));
	root = join(base, "repo");
	fs.mkdirSync(root);
	git("init", "-b", "main");
	git("config", "user.name", "Workspace Test");
	git("config", "user.email", "workspace@example.invalid");
	fs.writeFileSync(join(root, "hello.ts"), "export const value = 1;\n");
	git("add", "hello.ts");
	git("commit", "-m", "initial");
});
afterEach(() => {
	vi.restoreAllMocks();
	fs.rmSync(base, { recursive: true, force: true });
});

test("lazy tree hides Git metadata, reads exact UTF8 and preserves executable mode on explicit save", async () => {
	fs.mkdirSync(join(root, "src"));
	fs.writeFileSync(join(root, "src", "nested.ts"), "nested");
	fs.writeFileSync(join(root, "hello.ts"), "\uFEFFexport const value = 1;\r\n");
	fs.chmodSync(join(root, "hello.ts"), 0o755);
	const tree = await workspace.tree({ root, path: "" });
	expect(tree.ok).toBe(true);
	if (!tree.ok) throw new Error(tree.reason);
	expect(tree.entries.map((entry) => entry.path)).toEqual(["src", "hello.ts"]);
	const read = await workspace.readFile({ root, path: "hello.ts" });
	if (!read.ok) throw new Error(read.reason);
	expect(read.text).toBe("\uFEFFexport const value = 1;\r\n");
	expect(await workspace.tree({ root, path: "src" })).toMatchObject({
		ok: true,
		entries: [{ path: "src/nested.ts", kind: "file" }],
	});
	const saved = await workspace.saveFile({
		root,
		path: "hello.ts",
		text: "\uFEFFexport const value = 2;\r\n",
		baseHash: read.hash,
	});
	expect(saved.ok).toBe(true);
	expect(fs.readFileSync(join(root, "hello.ts"), "utf8")).toBe("\uFEFFexport const value = 2;\r\n");
	if (!saved.ok) throw new Error(saved.reason);
	expect(await workspace.readFile({ root, path: "hello.ts" })).toMatchObject({ ok: true, hash: saved.hash });
	expect(fs.statSync(join(root, "hello.ts")).mode & 0o777).toBe(0o755);
	expect(await workspace.tree({ root, path: "" })).toEqual(tree);
});

test("stale buffers and intervening replacements return conflicts without overwriting", async () => {
	const request = { root, path: "hello.ts" };
	const treeBefore = await workspace.tree({ root, path: "" });
	const read = await workspace.readFile(request);
	if (!read.ok) throw new Error(read.reason);
	fs.writeFileSync(join(root, request.path), "agent edit");
	expect(await workspace.saveFile({ ...request, text: "operator edit", baseHash: read.hash })).toMatchObject({
		ok: false,
		conflict: true,
	});
	expect(fs.readFileSync(join(root, request.path), "utf8")).toBe("agent edit");
	const current = await workspace.readFile(request);
	if (!current.ok) throw new Error(current.reason);
	vi.mocked(fs.fsyncSync).mockImplementationOnce(() => {
		fs.writeFileSync(join(root, "replacement"), "replacement edit");
		fs.renameSync(join(root, "replacement"), join(root, request.path));
	});
	expect(await workspace.saveFile({ ...request, text: "operator edit", baseHash: current.hash })).toMatchObject({
		ok: false,
		conflict: true,
	});
	expect(fs.readFileSync(join(root, request.path), "utf8")).toBe("replacement edit");
	expect(await workspace.tree({ root, path: "" })).toEqual(treeBefore);
});

test("rejects traversal, escaped symlinks, metadata, binary, invalid UTF8 and missing writes", async () => {
	fs.writeFileSync(join(base, "private"), "private");
	fs.symlinkSync(join(base, "private"), join(root, "escape"));
	fs.symlinkSync(join(root, "hello.ts"), join(root, "inside"));
	fs.writeFileSync(join(root, "binary"), Buffer.from([65, 0, 66]));
	fs.writeFileSync(join(root, "invalid"), Buffer.from([0xff]));
	for (const path of ["../private", "/etc/passwd", "escape", ".git/config", "binary", "invalid", "absent"])
		expect(await workspace.readFile({ root, path })).toMatchObject({ ok: false });
	expect(await workspace.tree({ root: join(root, "hello.ts"), path: "" })).toMatchObject({ ok: false });
	const inside = await workspace.readFile({ root, path: "inside" });
	if (!inside.ok) throw new Error(inside.reason);
	expect(await workspace.saveFile({ root, path: "inside", text: "new", baseHash: inside.hash })).toMatchObject({
		ok: false,
	});
	expect(fs.lstatSync(join(root, "inside")).isSymbolicLink()).toBe(true);
	expect(await workspace.saveFile({ root, path: "absent", text: "new", baseHash: "" })).toMatchObject({ ok: false });
});

test("Git reads staged, unstaged, untracked and renamed paths literally without changing index", async () => {
	git("mv", "hello.ts", "renamed [file].ts");
	fs.writeFileSync(join(root, "renamed [file].ts"), "worktree change\n");
	fs.writeFileSync(join(root, "untracked.ts"), "untracked\n");
	const index = fs.readFileSync(join(root, ".git/index"));
	const status = await workspace.gitStatus({ root });
	expect(status).toMatchObject({
		ok: true,
		branch: "main",
		entries: [
			{ path: "renamed [file].ts", previousPath: "hello.ts", index: "R", worktree: "M" },
			{ path: "untracked.ts", index: "?", worktree: "?" },
		],
	});
	const unstaged = await workspace.gitDiff({ root, path: "renamed [file].ts" });
	expect(unstaged).toMatchObject({ ok: true, text: expect.stringContaining("+worktree change") });
	const staged = await workspace.gitDiff({ root, path: "renamed [file].ts", staged: true });
	expect(staged).toMatchObject({ ok: true, text: expect.stringContaining("export const value = 1") });
	expect(await workspace.gitDiff({ root, path: "../private" })).toMatchObject({ ok: false });
	expect(fs.readFileSync(join(root, ".git/index"))).toEqual(index);
	git("checkout", "--detach");
	expect(await workspace.gitStatus({ root })).toMatchObject({ ok: true, branch: null });
});

test("manual subdirectories remain browsable but Git names the required repository root", async () => {
	const sub = join(root, "sub");
	fs.mkdirSync(sub);
	fs.writeFileSync(join(sub, "nested.txt"), "nested");
	expect(await workspace.tree({ root: sub, path: "" })).toMatchObject({ ok: true, entries: [{ path: "nested.txt" }] });
	expect(await workspace.gitStatus({ root: sub })).toMatchObject({
		ok: false,
		reason: expect.stringContaining("Open the repository root"),
	});
	expect(await workspace.gitDiff({ root: sub, path: "nested.txt" })).toMatchObject({ ok: false });
	expect(await workspace.tree({ root: join(root, ".git"), path: "" })).toMatchObject({ ok: false });
});

test("discovers real roots and validates renderer payloads", async () => {
	const discovered = openWorkspace(() => ({
		...snapshot,
		dormant: [
			{
				id: "person",
				name: "Person",
				role: "worker",
				reportsTo: null,
				repository: root,
				cwd: root,
				task: null,
				stoppedAt: 1,
				stopReason: null,
				startedAt: 0,
			},
		],
	}));
	expect(await discovered.repositories()).toEqual({ ok: true, roots: [fs.realpathSync(root)] });
	expect(isWorkspaceRoot(null)).toBe(false);
	expect(isWorkspacePath({ root, path: 2 })).toBe(false);
	expect(isWorkspaceSave({ root, path: "x", text: "new" })).toBe(false);
	expect(isWorkspaceSave({ root, path: "x", text: "new", baseHash: "abc" })).toBe(true);
	expect(isWorkspaceDiff({ root, path: "x", staged: "yes" })).toBe(false);
	expect(isWorkspaceDiff({ root, path: "x", staged: true })).toBe(true);
});
