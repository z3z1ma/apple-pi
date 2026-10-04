import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	checkScorerSpec,
	diffStat,
	installScorer,
	OUTPUT_TAIL_BYTES,
	runCommand,
	type ScorerSpec,
} from "../src/scorer.js";
import {
	addWorktree,
	applyWinner,
	baseRef,
	branchRef,
	commitWorktree,
	gitCommonDir,
	hasHead,
	removeWorktrees,
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

function spec(overrides: Partial<ScorerSpec> = {}): ScorerSpec {
	return {
		version: 1,
		goal: "value is 2",
		files: [{ path: "checks/value.test.sh", content: "grep -q 'value = 2' app.ts\n" }],
		protect: ["app.test.ts"],
		gates: [{ id: "value", run: "bash checks/value.test.sh", onBase: "fail", timeoutSec: 10 }],
		objectives: [],
		...overrides,
	};
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
		const result = await applyWinner(dir, { base, winner, mode: "auto", patchPath });

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
		const result = await applyWinner(dir, { base, winner, mode: "auto", patchPath });

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

		expect(await applyWinner(dir, { base, winner, mode: "auto", patchPath })).toEqual({
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
			result = await applyWinner(dir, { base, winner, mode: "auto", patchPath });
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

	it("leaves a workspace that changed during the search untouched", async () => {
		const { dir, base, winner, patchPath } = await searched();
		writeFileSync(join(dir, "keep.txt"), "edited during the search\n");
		const result = await applyWinner(dir, { base, winner, mode: "auto", patchPath });

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
		const applying = applyWinner(dir, { base, winner, mode: "auto", patchPath, signal: controller.signal });
		controller.abort();

		await expect(applying).rejects.toThrow();
		expect(readFileSync(join(dir, "app.ts"), "utf8")).toBe("export const value = 1;\n");
		expect(existsSync(join(dir, "added.ts"))).toBe(false);
	});

	it("leaves the workspace untouched in report mode", async () => {
		const { dir, base, winner, patchPath } = await searched();
		const result = await applyWinner(dir, { base, winner, mode: "report", patchPath });

		expect(result).toEqual({ applied: false, workspaceTree: base.tree, reason: "apply mode is report" });
		expect(readFileSync(join(dir, "app.ts"), "utf8")).toBe("export const value = 1;\n");
		expect(existsSync(join(dir, "added.ts"))).toBe(false);
		expect(existsSync(patchPath)).toBe(false);
	});
});

describe("scorer overlay", { timeout: 30_000 }, () => {
	it("installs scorer files and restores protected paths to their base content", async () => {
		const dir = repo({ "app.ts": "export const value = 1;\n", "app.test.ts": "original test\n" });
		const base = await snapshotBase(dir, "bs-test");
		const wt = join(await gitCommonDir(dir), "apple-pi", "wt", "r0");
		await addWorktree(dir, wt, base.commit, []);
		writeFileSync(join(wt, "app.test.ts"), "weakened test\n");
		await commitWorktree(dir, wt, "bs-test", "r0");

		await installScorer(wt, base.commit, spec());

		expect(readFileSync(join(wt, "app.test.ts"), "utf8")).toBe("original test\n");
		expect(readFileSync(join(wt, "checks", "value.test.sh"), "utf8")).toBe("grep -q 'value = 2' app.ts\n");
		await removeWorktrees(dir, [wt]);
	});

	it("restores a protected path from base even when the scorer installs a file there", async () => {
		const dir = repo({ "app.ts": "x\n", "app.test.ts": "original test\n" });
		const base = await snapshotBase(dir, "bs-test");
		const wt = join(await gitCommonDir(dir), "apple-pi", "wt", "r0");
		await addWorktree(dir, wt, base.commit, []);
		await installScorer(wt, base.commit, spec({ files: [{ path: "app.test.ts", content: "scorer\n" }] }));
		expect(readFileSync(join(wt, "app.test.ts"), "utf8")).toBe("original test\n");
		await removeWorktrees(dir, [wt]);
	});

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

describe("scorer spec schema", () => {
	it("accepts a well-formed spec", () => {
		expect(checkScorerSpec(spec())).toEqual([]);
	});

	it("rejects a reserved id, a duplicate id, a path that leaves the worktree, and a spec without gates", () => {
		const gate = { id: "diff_size", run: "true", onBase: "pass" as const, timeoutSec: 1 };
		expect(checkScorerSpec(spec({ gates: [gate] })).join()).toContain("diff_size");
		expect(
			checkScorerSpec(
				spec({
					gates: [{ ...gate, id: "same" }],
					objectives: [{ id: "same", run: "echo 1", better: "lower", timeoutSec: 1 }],
				}),
			).join(),
		).toContain("same");
		expect(checkScorerSpec(spec({ files: [{ path: "../escape.sh", content: "" }] })).join()).toContain("../escape.sh");
		expect(checkScorerSpec(spec({ protect: ["/etc/passwd"] })).join()).toContain("/etc/passwd");
		expect(checkScorerSpec(spec({ gates: [] })).join()).toContain("gate");
	});
});

describe("scorer file destinations", () => {
	it("refuses a scorer file whose final component is a symlink out of the worktree", async () => {
		const dir = repo({ "app.ts": "x\n" });
		const outside = realpathSync(mkdtempSync(join(tmpdir(), "apple-pi-branch-outside-")));
		dirs.push(outside);
		writeFileSync(join(outside, "target.sh"), "untouched\n");
		const base = await snapshotBase(dir, "bs-test");
		const wt = join(await gitCommonDir(dir), "apple-pi", "wt", "r0");
		await addWorktree(dir, wt, base.commit, []);
		symlinkSync(join(outside, "target.sh"), join(wt, "gate.sh"));

		const refused = await installScorer(
			wt,
			base.commit,
			spec({ files: [{ path: "gate.sh", content: "x\n" }], protect: [] }),
		);

		expect(refused).toContain("outside the worktree");
		expect(readFileSync(join(outside, "target.sh"), "utf8")).toBe("untouched\n");
		await removeWorktrees(dir, [wt]);
	});
});

describe("scorer file destinations through dangling links", { timeout: 30_000 }, () => {
	it("refuses a scorer file whose final component is a dangling symlink out of the worktree", async () => {
		const dir = repo({ "app.ts": "x\n" });
		const outside = realpathSync(mkdtempSync(join(tmpdir(), "apple-pi-branch-outside-")));
		dirs.push(outside);
		const base = await snapshotBase(dir, "bs-test");
		const wt = join(await gitCommonDir(dir), "apple-pi", "wt", "r0");
		await addWorktree(dir, wt, base.commit, []);
		symlinkSync(join(outside, "new-file.sh"), join(wt, "gate.sh"));
		symlinkSync(join(outside, "missing-dir", "deeper"), join(wt, "nested"));

		for (const path of ["gate.sh", "nested/gate.sh"]) {
			const refused = await installScorer(wt, base.commit, spec({ files: [{ path, content: "x\n" }], protect: [] }));
			expect(refused).toContain("outside the worktree");
		}
		expect(existsSync(join(outside, "new-file.sh"))).toBe(false);
		expect(existsSync(join(outside, "missing-dir"))).toBe(false);
		await removeWorktrees(dir, [wt]);
	});
	it("refuses a scorer file behind a link whose target climbs out through another link", async () => {
		const dir = repo({ "app.ts": "x\n" });
		const outside = realpathSync(mkdtempSync(join(tmpdir(), "apple-pi-branch-outside-")));
		dirs.push(outside);
		mkdirSync(join(outside, "child"));
		const base = await snapshotBase(dir, "bs-test");
		const wt = join(await gitCommonDir(dir), "apple-pi", "wt", "r0");
		await addWorktree(dir, wt, base.commit, []);
		symlinkSync(join(outside, "child"), join(wt, "pivot"));
		symlinkSync("pivot/../hidden.sh", join(wt, "gate.sh"));

		const refused = await installScorer(
			wt,
			base.commit,
			spec({ files: [{ path: "gate.sh", content: "x\n" }], protect: [] }),
		);

		expect(refused).toContain("outside the worktree");
		expect(existsSync(join(outside, "hidden.sh"))).toBe(false);
		await removeWorktrees(dir, [wt]);
	});
});

describe("scorer commands", () => {
	const alive = (pid: number) => {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	};
	const gone = async (pid: number) => {
		for (let i = 0; i < 50 && alive(pid); i++) await new Promise((resolve) => setTimeout(resolve, 20));
		return !alive(pid);
	};

	it("kills what a command left running in its process group when it settles", async () => {
		for (const command of [
			"sleep 20 </dev/null >/dev/null 2>&1 & echo $!",
			"sleep 20 </dev/null >/dev/null 2>&1 & echo $!; exit 3",
		]) {
			const result = await runCommand(command, tmpdir(), 10, {});
			const pid = Number(result.stdout.trim().split("\n").at(-1));
			expect(pid).toBeGreaterThan(0);
			expect(await gone(pid)).toBe(true);
		}
	});

	it("kills the process group on timeout", async () => {
		const result = await runCommand("sleep 20 </dev/null >/dev/null 2>&1 & echo $!; sleep 20", tmpdir(), 0.5, {});
		expect(result.timedOut).toBe(true);
		expect(await gone(Number(result.stdout.trim()))).toBe(true);
	});

	it("kills at once when the signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const started = Date.now();
		await runCommand("sleep 20", tmpdir(), 30, {}, controller.signal);
		expect(Date.now() - started).toBeLessThan(5000);
	});

	it("keeps only the last 64 KiB of stdout and stderr", async () => {
		const result = await runCommand(
			"head -c 200000 /dev/zero | tr '\\0' a; printf END; head -c 200000 /dev/zero | tr '\\0' b >&2; printf END >&2",
			tmpdir(),
			30,
			{},
		);
		expect(result.stdout.length).toBe(OUTPUT_TAIL_BYTES);
		expect(result.stdout.endsWith("aaaEND")).toBe(true);
		expect(result.stderr.length).toBe(OUTPUT_TAIL_BYTES);
		expect(result.stderr.endsWith("bbbEND")).toBe(true);
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
