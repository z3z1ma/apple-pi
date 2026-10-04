import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	addWorktree,
	applyWinner,
	baseRef,
	branchRef,
	commitWorktree,
	diffStat,
	gitCommonDir,
	hasHead,
	removeWorktrees,
	restoreOwned,
	snapshotBase,
	snapshotTree,
} from "../src/workspace.js";
import { gitOut, initRepo } from "./fixtures.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo(files: Record<string, string> = { "app.ts": "export const value = 1;\n" }): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "apple-pi-branch-ws-")));
	dirs.push(dir);
	initRepo(dir, files);
	return dir;
}

describe("base snapshot", { timeout: 30_000 }, () => {
	it("needs a HEAD commit", async () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "apple-pi-branch-ws-")));
		dirs.push(dir);
		gitOut(dir, "init", "-q");
		expect(await hasHead(dir)).toBe(false);
		expect(await hasHead(repo())).toBe(true);
	});

	it("captures uncommitted and untracked files, skips ignored ones, and leaves the index alone", async () => {
		const dir = repo({ "app.ts": "export const value = 1;\n", ".gitignore": "node_modules/\n" });
		writeFileSync(join(dir, "app.ts"), "export const value = 3;\n");
		writeFileSync(join(dir, "new.ts"), "new\n");
		mkdirSync(join(dir, "node_modules"));
		writeFileSync(join(dir, "node_modules", "dep.js"), "dep\n");
		const index = readFileSync(join(dir, ".git", "index"));

		const base = await snapshotBase(dir, "bs-test");

		expect(readFileSync(join(dir, ".git", "index"))).toEqual(index);
		expect(gitOut(dir, "rev-parse", baseRef("bs-test"))).toBe(base.commit);
		expect(gitOut(dir, "rev-parse", `${base.commit}^{tree}`)).toBe(base.tree);
		expect(gitOut(dir, "rev-parse", `${base.commit}^`)).toBe(gitOut(dir, "rev-parse", "HEAD"));
		expect(gitOut(dir, "show", `${base.commit}:app.ts`)).toBe("export const value = 3;");
		expect(gitOut(dir, "show", `${base.commit}:new.ts`)).toBe("new");
		expect(gitOut(dir, "ls-tree", "-r", "--name-only", base.commit)).not.toContain("node_modules");
		expect(await snapshotTree(dir)).toBe(base.tree);
		expect(gitOut(dir, "status", "--porcelain")).toContain("new.ts");
	});

	it("creates worktrees from a commit with ignored directories cloned, commits them, and removes them", async () => {
		const dir = repo({ "app.ts": "export const value = 1;\n", ".gitignore": "node_modules/\n" });
		mkdirSync(join(dir, "node_modules"));
		writeFileSync(join(dir, "node_modules", "dep.js"), "dep\n");
		const base = await snapshotBase(dir, "bs-test");
		const wt = join(await gitCommonDir(dir), "apple-pi", "wt", "r0");

		await addWorktree(dir, wt, base.commit, ["node_modules", "missing"]);
		expect(readFileSync(join(wt, "node_modules", "dep.js"), "utf8")).toBe("dep\n");
		writeFileSync(join(wt, "app.ts"), "export const value = 2;\n");
		const commit = await commitWorktree(dir, wt, "bs-test", "r0");

		expect(gitOut(dir, "rev-parse", branchRef("bs-test", "r0"))).toBe(commit);
		expect(gitOut(dir, "rev-parse", `${commit}^`)).toBe(base.commit);
		expect(gitOut(dir, "ls-tree", "-r", "--name-only", commit)).not.toContain("node_modules");
		await removeWorktrees(dir, [wt]);
		expect(existsSync(wt)).toBe(false);
		expect(gitOut(dir, "worktree", "list")).not.toContain(wt);
	});
});

describe("apply", { timeout: 30_000 }, () => {
	/** A repository with an uncommitted edit in its base and a winner that changes, adds, and adds a binary file. */
	async function searched() {
		const dir = repo({ "app.ts": "export const value = 1;\n", "keep.txt": "keep\n" });
		writeFileSync(join(dir, "keep.txt"), "keep, uncommitted\n");
		const base = await snapshotBase(dir, "bs-test");
		const wt = join(await gitCommonDir(dir), "apple-pi", "wt", "r0");
		await addWorktree(dir, wt, base.commit, []);
		writeFileSync(join(wt, "app.ts"), "export const value = 2;\n");
		writeFileSync(join(wt, "added.ts"), "export {};\n");
		writeFileSync(join(wt, "image.bin"), Buffer.from([0, 1, 2, 255]));
		const winner = await commitWorktree(dir, wt, "bs-test", "r0");
		await removeWorktrees(dir, [wt]);
		const patchPath = join(await gitCommonDir(dir), "apple-pi", "winner.patch");
		return { dir, base, winner, patchPath };
	}

	it("applies the winner's diff to an unchanged workspace and keeps the patch", async () => {
		const { dir, base, winner, patchPath } = await searched();
		const index = readFileSync(join(dir, ".git", "index"));
		const result = await applyWinner(dir, { base, winner, patchPath });

		expect(result).toEqual({ applied: true, workspaceTree: base.tree });
		expect(readFileSync(join(dir, "app.ts"), "utf8")).toBe("export const value = 2;\n");
		expect(readFileSync(join(dir, "added.ts"), "utf8")).toBe("export {};\n");
		expect([...readFileSync(join(dir, "image.bin"))]).toEqual([0, 1, 2, 255]);
		expect(readFileSync(join(dir, "keep.txt"), "utf8")).toBe("keep, uncommitted\n");
		expect(readFileSync(patchPath, "utf8")).toContain("GIT binary patch");
		expect(readFileSync(join(dir, ".git", "index"))).toEqual(index);
	});

	it("applies the real diff whatever external diff or textconv driver the repository configures", async () => {
		const { dir, base, winner, patchPath } = await searched();
		gitOut(dir, "config", "diff.external", "true");
		gitOut(dir, "config", "diff.blank.textconv", "true");
		writeFileSync(join(dir, ".git", "info", "attributes"), "* diff=blank\n");
		const result = await applyWinner(dir, { base, winner, patchPath });

		expect(result).toEqual({ applied: true, workspaceTree: base.tree });
		expect(readFileSync(join(dir, "app.ts"), "utf8")).toBe("export const value = 2;\n");
		expect(readFileSync(join(dir, "added.ts"), "utf8")).toBe("export {};\n");
		expect([...readFileSync(join(dir, "image.bin"))]).toEqual([0, 1, 2, 255]);
	});

	it("treats a winner with the base tree as applied with nothing to change", async () => {
		const dir = repo();
		const base = await snapshotBase(dir, "bs-test");
		const wt = join(await gitCommonDir(dir), "apple-pi", "wt", "r0");
		await addWorktree(dir, wt, base.commit, []);
		const winner = await commitWorktree(dir, wt, "bs-test", "r0");
		await removeWorktrees(dir, [wt]);
		const patchPath = join(await gitCommonDir(dir), "apple-pi", "winner.patch");

		expect(await applyWinner(dir, { base, winner, patchPath })).toEqual({
			applied: true,
			workspaceTree: base.tree,
		});
		expect(readFileSync(join(dir, "app.ts"), "utf8")).toBe("export const value = 1;\n");
	});

	it("rolls back every file to its base content when the patch fails partway", async () => {
		const dir = repo({ "a.txt": "a base\n", "ro/b.txt": "b base\n", "z.txt": "z base\n" });
		const base = await snapshotBase(dir, "bs-test");
		const wt = join(await gitCommonDir(dir), "apple-pi", "wt", "r0");
		await addWorktree(dir, wt, base.commit, []);
		writeFileSync(join(wt, "a.txt"), "a winner\n");
		writeFileSync(join(wt, "added.txt"), "added\n");
		writeFileSync(join(wt, "ro", "b.txt"), "b winner\n");
		rmSync(join(wt, "z.txt"));
		const winner = await commitWorktree(dir, wt, "bs-test", "r0");
		await removeWorktrees(dir, [wt]);
		const patchPath = join(await gitCommonDir(dir), "apple-pi", "winner.patch");
		// A read-only directory makes git apply fail after it has written the writable files.
		chmodSync(join(dir, "ro"), 0o555);
		const index = readFileSync(join(dir, ".git", "index"));
		let result: Awaited<ReturnType<typeof applyWinner>>;
		try {
			result = await applyWinner(dir, { base, winner, patchPath });
		} finally {
			chmodSync(join(dir, "ro"), 0o755);
		}

		expect(result.applied).toBe(false);
		expect(result.reason).toMatch(/^git apply .*failed: .*; the workspace was restored to the base$/s);
		expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("a base\n");
		expect(readFileSync(join(dir, "ro", "b.txt"), "utf8")).toBe("b base\n");
		expect(readFileSync(join(dir, "z.txt"), "utf8")).toBe("z base\n");
		expect(existsSync(join(dir, "added.txt"))).toBe(false);
		expect(await snapshotTree(dir)).toBe(base.tree);
		expect(readFileSync(join(dir, ".git", "index"))).toEqual(index);
	});

	it("rolls back only the paths that still hold what the patch wrote", async () => {
		const dir = repo({ "a.txt": "a base\n", "b.txt": "b base\n", "z.txt": "z base\n" });
		const base = await snapshotBase(dir, "bs-test");
		const wt = join(await gitCommonDir(dir), "apple-pi", "wt", "r0");
		await addWorktree(dir, wt, base.commit, []);
		for (const name of ["a", "b"]) writeFileSync(join(wt, `${name}.txt`), `${name} winner\n`);
		writeFileSync(join(wt, "added.txt"), "added\n");
		writeFileSync(join(wt, "mine.txt"), "winner adds\n");
		rmSync(join(wt, "z.txt"));
		const winner = await commitWorktree(dir, wt, "bs-test", "r0");
		await removeWorktrees(dir, [wt]);
		// The patch wrote a.txt and added.txt; someone else then changed b.txt, recreated z.txt, and wrote mine.txt.
		writeFileSync(join(dir, "a.txt"), "a winner\n");
		writeFileSync(join(dir, "added.txt"), "added\n");
		writeFileSync(join(dir, "b.txt"), "b edited by the user\n");
		writeFileSync(join(dir, "z.txt"), "z edited by the user\n");
		writeFileSync(join(dir, "mine.txt"), "user's own file\n");
		const left = await restoreOwned(dir, base.commit, winner);

		expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("a base\n");
		expect(existsSync(join(dir, "added.txt"))).toBe(false);
		expect(readFileSync(join(dir, "b.txt"), "utf8")).toBe("b edited by the user\n");
		expect(readFileSync(join(dir, "z.txt"), "utf8")).toBe("z edited by the user\n");
		expect(readFileSync(join(dir, "mine.txt"), "utf8")).toBe("user's own file\n");
		expect(left.sort()).toEqual(["b.txt", "mine.txt", "z.txt"]);
	});

	it("leaves a workspace that changed during the search untouched", async () => {
		const { dir, base, winner, patchPath } = await searched();
		writeFileSync(join(dir, "keep.txt"), "edited during the search\n");
		const result = await applyWinner(dir, { base, winner, patchPath });

		expect(result.applied).toBe(false);
		expect(result.reason).toBe("the workspace changed during the search");
		expect(result.workspaceTree).not.toBe(base.tree);
		expect(readFileSync(join(dir, "app.ts"), "utf8")).toBe("export const value = 1;\n");
		expect(existsSync(join(dir, "added.ts"))).toBe(false);
		expect(readFileSync(join(dir, "keep.txt"), "utf8")).toBe("edited during the search\n");
		expect(existsSync(patchPath)).toBe(false);
	});

	it("leaves the workspace untouched when the search is cancelled before the patch lands", async () => {
		const { dir, base, winner, patchPath } = await searched();
		const controller = new AbortController();
		const applying = applyWinner(dir, { base, winner, patchPath, signal: controller.signal });
		controller.abort();

		await expect(applying).rejects.toThrow();
		expect(readFileSync(join(dir, "app.ts"), "utf8")).toBe("export const value = 1;\n");
		expect(existsSync(join(dir, "added.ts"))).toBe(false);
	});
});

describe("diff size", { timeout: 30_000 }, () => {
	it("counts added and deleted lines with binary rows as zero", async () => {
		const dir = repo({ "app.ts": "a\nb\nc\n" });
		const base = await snapshotBase(dir, "bs-test");
		const wt = join(await gitCommonDir(dir), "apple-pi", "wt", "r0");
		await addWorktree(dir, wt, base.commit, []);
		writeFileSync(join(wt, "app.ts"), "a\nB\nc\nd\n");
		writeFileSync(join(wt, "image.bin"), Buffer.from([0, 1, 2, 0, 255, 0, 3]));
		const commit = await commitWorktree(dir, wt, "bs-test", "r0");

		expect(await diffStat(dir, base.commit, commit)).toEqual({ added: 2, deleted: 1, files: 2 });
		await removeWorktrees(dir, [wt]);
	});
	it("counts real lines whatever textconv driver the repository configures", async () => {
		const dir = repo({ "app.ts": "a\nb\nc\n", ".gitattributes": "*.ts diff=blank\n" });
		gitOut(dir, "config", "diff.blank.textconv", "true");
		const base = await snapshotBase(dir, "bs-test");
		const wt = join(await gitCommonDir(dir), "apple-pi", "wt", "r0");
		await addWorktree(dir, wt, base.commit, []);
		writeFileSync(join(wt, "app.ts"), "a\nB\nc\nd\n");
		const commit = await commitWorktree(dir, wt, "bs-test", "r0");

		expect(await diffStat(dir, base.commit, commit)).toEqual({ added: 2, deleted: 1, files: 1 });
		await removeWorktrees(dir, [wt]);
	});
});

describe("worktree removal", { timeout: 30_000 }, () => {
	it("removes a locked worktree", async () => {
		const dir = repo();
		const base = await snapshotBase(dir, "bs-test");
		const wt = join(await gitCommonDir(dir), "apple-pi", "wt", "r0");
		await addWorktree(dir, wt, base.commit, []);
		gitOut(dir, "worktree", "lock", wt);

		await removeWorktrees(dir, [wt]);

		expect(existsSync(wt)).toBe(false);
		expect(gitOut(dir, "worktree", "list")).not.toContain(wt);
	});

	it("reports a worktree it could not remove", async () => {
		const dir = repo();
		const base = await snapshotBase(dir, "bs-test");
		const parent = join(await gitCommonDir(dir), "apple-pi", "wt");
		const wt = join(parent, "r0");
		await addWorktree(dir, wt, base.commit, []);
		chmodSync(parent, 0o555);
		try {
			await expect(removeWorktrees(dir, [wt])).rejects.toThrow(wt);
		} finally {
			chmodSync(parent, 0o755);
		}
	});
});
