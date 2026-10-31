import { watch, writeFileSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { git } from "../../shared/src/git.js";
import { captureReview, verifyArtifact } from "../src/capture.js";

const directories: string[] = [];
afterEach(async () => {
	for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function repository() {
	const root = await mkdtemp(join(tmpdir(), "review-capture-"));
	directories.push(root);
	await git(root, ["init", "-q"]);
	await git(root, ["config", "user.name", "Capture test"]);
	await git(root, ["config", "user.email", "capture@example.invalid"]);
	await writeFile(join(root, "value.ts"), "export const value = 1;\n");
	await writeFile(join(root, "caller.ts"), 'import { value } from "./value.js";\nconsole.log(value);\n');
	await git(root, ["add", "."]);
	await git(root, ["commit", "-qm", "base"]);
	return root;
}

test("a staged review contains the index, not unstaged edits or untracked files", async () => {
	const cwd = await repository();
	await writeFile(join(cwd, "value.ts"), "export const value = 2;\n");
	await git(cwd, ["add", "value.ts"]);
	await writeFile(join(cwd, "value.ts"), "export const value = 3;\n");
	await writeFile(join(cwd, "untracked.txt"), "not staged\n");
	const index = await readFile(join(cwd, ".git/index"));
	const capture = await captureReview({ cwd, target: { kind: "staged" } }, await destination());
	expect(await readFile(join(capture.source, "value.ts"), "utf8")).toBe("export const value = 2;\n");
	expect(capture.files.map((file) => file.path).sort()).toEqual(["caller.ts", "value.ts"]);
	expect(capture.regions.map((region) => region.path)).toEqual(["value.ts"]);
	expect(await readFile(join(cwd, ".git/index"))).toEqual(index);
});

test("a commit review resolves its parent and retains the commit rather than the checkout", async () => {
	const cwd = await repository();
	const parent = await git(cwd, ["rev-parse", "HEAD"]);
	await writeFile(join(cwd, "value.ts"), "export const value = 2;\n");
	await git(cwd, ["commit", "-qam", "change"]);
	const commit = await git(cwd, ["rev-parse", "HEAD"]);
	await writeFile(join(cwd, "value.ts"), "uncommitted\n");
	const capture = await captureReview({ cwd, target: { kind: "commit", commit } }, await destination());
	expect(capture.baseCommit).toBe(parent);
	expect(capture.headCommit).toBe(commit);
	expect(await readFile(join(capture.source, "value.ts"), "utf8")).toBe("export const value = 2;\n");
	expect(await git(capture.source, ["show", `${capture.baseTree}:value.ts`])).toBe("export const value = 1;");
});

test("path scope narrows changed-region coverage without removing surrounding source", async () => {
	const cwd = await repository();
	await writeFile(join(cwd, "value.ts"), "changed value\n");
	await writeFile(join(cwd, "caller.ts"), "changed caller\n");
	const capture = await captureReview(
		{ cwd, target: { kind: "working-tree", base: "HEAD" }, paths: ["value.ts"] },
		await destination(),
	);
	expect(capture.regions.map((region) => region.path)).toEqual(["value.ts"]);
	expect(await readFile(join(capture.source, "caller.ts"), "utf8")).toBe("changed caller\n");
	expect(capture.omissions).toContainEqual({
		path: "caller.ts",
		reason: "Outside the requested review paths; retained as context",
	});
});

test("capture preserves odd paths, binary bytes, link text and executable modes, and identifies LFS pointers", async () => {
	const cwd = await repository();
	const name = 'tab\tline\n" spaced.txt';
	await writeFile(join(cwd, name), "leading and trailing \r\n");
	await writeFile(join(cwd, "image.bin"), Buffer.from([0, 255, 128, 10]));
	await chmod(join(cwd, "value.ts"), 0o755);
	await symlink("caller.ts", join(cwd, "caller-link"));
	await writeFile(
		join(cwd, "large.dat"),
		`version https://git-lfs.github.com/spec/v1\noid sha256:${"a".repeat(64)}\nsize 1234\n`,
	);
	const capture = await captureReview({ cwd, target: { kind: "working-tree", base: "HEAD" } }, await destination());
	expect(await readFile(join(capture.source, name), "utf8")).toBe("leading and trailing \r\n");
	expect(await readFile(join(capture.source, "image.bin"))).toEqual(Buffer.from([0, 255, 128, 10]));
	expect(await readlink(join(capture.source, "caller-link"))).toBe("caller.ts");
	expect((await lstat(join(capture.source, "value.ts"))).mode & 0o111).not.toBe(0);
	expect(capture.regions.find((region) => region.path === "image.bin")?.kind).toBe("non-text");
	expect(capture.omissions).toContainEqual({
		path: "large.dat",
		reason: "lfs pointer only; referenced content is not captured",
	});
});

test("a root commit compares with an empty tree", async () => {
	const cwd = await repository();
	const capture = await captureReview({ cwd, target: { kind: "commit", commit: "HEAD" } }, await destination());
	expect(capture.baseCommit).toBeNull();
	expect(await git(capture.source, ["ls-tree", capture.baseTree])).toBe("");
	expect(capture.regions.map((region) => region.path)).toEqual(["caller.ts", "value.ts"]);
});

test("branch and range targets differ explicitly at the merge base", async () => {
	const cwd = await repository();
	const base = await git(cwd, ["rev-parse", "HEAD"]);
	await git(cwd, ["checkout", "-qb", "feature"]);
	await writeFile(join(cwd, "value.ts"), "feature\n");
	await git(cwd, ["commit", "-qam", "feature"]);
	await git(cwd, ["checkout", "-qb", "upstream", base]);
	await writeFile(join(cwd, "caller.ts"), "upstream\n");
	await git(cwd, ["commit", "-qam", "upstream"]);
	const branch = await captureReview(
		{ cwd, target: { kind: "branch", base: "upstream", head: "feature" } },
		await destination(),
	);
	const range = await captureReview(
		{ cwd, target: { kind: "range", base: "upstream", head: "feature" } },
		await destination(),
	);
	expect(branch.baseCommit).toBe(base);
	expect(branch.regions.map((region) => region.path)).toEqual(["value.ts"]);
	expect(range.baseCommit).toBe(await git(cwd, ["rev-parse", "upstream"]));
	expect(range.regions.map((region) => region.path)).toEqual(["caller.ts", "value.ts"]);
	await git(cwd, ["merge", "-qm", "merge", "feature"]);
	await expect(captureReview({ cwd, target: { kind: "commit", commit: "HEAD" } }, await destination())).rejects.toThrow(
		"explicit parent",
	);
	const merge = await captureReview(
		{ cwd, target: { kind: "commit", commit: "HEAD", parent: "HEAD^2" } },
		await destination(),
	);
	expect(merge.regions.map((region) => region.path)).toEqual(["caller.ts"]);
});

test("the review directory supports ordinary Git inspection without the original repository", async () => {
	const cwd = await repository();
	await writeFile(join(cwd, "value.ts"), "export const value = 2;\n");
	const capture = await captureReview({ cwd, target: { kind: "working-tree", base: "HEAD" } }, await destination());
	await rm(cwd, { recursive: true });
	expect(await git(capture.source, ["status", "--porcelain=v1"])).toBe("");
	expect(await git(capture.source, ["diff", "base", "HEAD", "--", "value.ts"])).toContain("+export const value = 2;");
	expect(await git(capture.source, ["show", "base:caller.ts"])).toContain("console.log(value)");
});

test("verification detects changed captured bytes rather than falling back to live source", async () => {
	const cwd = await repository();
	const capture = await captureReview({ cwd, target: { kind: "staged" } }, await destination());
	await verifyArtifact(capture);
	await writeFile(join(cwd, "value.ts"), "a later live change\n");
	await verifyArtifact(capture);
	await writeFile(join(capture.source, "value.ts"), "tampered capture\n");
	await expect(verifyArtifact(capture)).rejects.toThrow("Captured source changed: value.ts");
});

test("file-backed intent is captured, and changed intent changes identity even with unchanged source", async () => {
	const cwd = await repository();
	const documents = await mkdtemp(join(tmpdir(), "review-intent-"));
	directories.push(documents);
	const path = join(documents, "task.md");
	await writeFile(path, "Keep tenant data separate.\n");
	const request = { cwd, target: { kind: "staged" as const }, intent: { path } };
	const first = await captureReview(request, await destination());
	await writeFile(path, "Keep viewer data separate.\n");
	const second = await captureReview(request, await destination());
	expect(first.intent?.text).toBe("Keep tenant data separate.\n");
	expect(second.intent?.text).toBe("Keep viewer data separate.\n");
	expect(first.digest).not.toBe(second.digest);
});

test("a concurrent source change fails capture and removes only its incomplete artifact", async () => {
	const cwd = await repository();
	const output = await destination();
	let changed = false;
	const watcher = watch(dirname(output), { recursive: true }, (_event, name) => {
		if (String(name).endsWith("source/value.ts") && !changed) {
			changed = true;
			writeFileSync(join(cwd, "value.ts"), "changed during capture\n");
		}
	});
	try {
		await expect(captureReview({ cwd, target: { kind: "working-tree", base: "HEAD" } }, output)).rejects.toThrow(
			"Source changed during capture",
		);
		expect(changed).toBe(true);
		await expect(lstat(output)).rejects.toMatchObject({ code: "ENOENT" });
		expect(await readFile(join(cwd, "value.ts"), "utf8")).toBe("changed during capture\n");
	} finally {
		watcher.close();
	}
});

test("Git diff drivers, clean filters and filesystem monitors do not run during capture", async () => {
	const cwd = await repository();
	const output = await destination();
	const marker = join(dirname(output), "invoked");
	const script = join(dirname(output), "trip.sh");
	await writeFile(script, `#!/bin/sh\nprintf invoked >> ${JSON.stringify(marker)}\nexit 0\n`, { mode: 0o755 });
	await writeFile(join(cwd, ".gitattributes"), "* filter=trip diff=trip\n");
	await git(cwd, ["config", "filter.trip.clean", script]);
	await git(cwd, ["config", "diff.external", script]);
	await git(cwd, ["config", "diff.trip.textconv", script]);
	await git(cwd, ["config", "core.fsmonitor", script]);
	await writeFile(join(cwd, "value.ts"), "  raw bytes\r\n");
	const capture = await captureReview({ cwd, target: { kind: "working-tree", base: "HEAD" } }, output);
	expect(await readFile(join(capture.source, "value.ts"), "utf8")).toBe("  raw bytes\r\n");
	await expect(lstat(marker)).rejects.toMatchObject({ code: "ENOENT" });
});

test("ambiguous merge bases and unresolved index conflicts are not guessed", async () => {
	const cwd = await repository();
	const root = await git(cwd, ["rev-parse", "HEAD"]);
	const tree = await git(cwd, ["rev-parse", "HEAD^{tree}"]);
	const a = await git(cwd, ["commit-tree", tree, "-p", root, "-m", "a"]);
	const b = await git(cwd, ["commit-tree", tree, "-p", root, "-m", "b"]);
	const left = await git(cwd, ["commit-tree", tree, "-p", a, "-p", b, "-m", "left"]);
	const right = await git(cwd, ["commit-tree", tree, "-p", b, "-p", a, "-m", "right"]);
	await expect(
		captureReview({ cwd, target: { kind: "branch", base: left, head: right } }, await destination()),
	).rejects.toThrow("unambiguous merge base");
	const blob = await git(cwd, ["rev-parse", "HEAD:value.ts"]);
	await git(cwd, ["update-index", "--index-info"], {
		input: `0 ${"0".repeat(40)}\tvalue.ts\n100644 ${blob} 1\tvalue.ts\n100644 ${blob} 2\tvalue.ts\n100644 ${blob} 3\tvalue.ts\n`,
	});
	await expect(captureReview({ cwd, target: { kind: "staged" } }, await destination())).rejects.toThrow(
		"Resolve index conflicts",
	);
});

test("unknown paths and missing objects fail rather than silently narrowing the review", async () => {
	const cwd = await repository();
	await expect(
		captureReview({ cwd, target: { kind: "commit", commit: "missing-ref" } }, await destination()),
	).rejects.toThrow();
	await expect(
		captureReview({ cwd, target: { kind: "staged" }, paths: ["missing.ts"] }, await destination()),
	).rejects.toThrow("does not exist");
});

test("non-UTF8 data remains an explicit binary obligation rather than a lossy text hunk", async () => {
	const cwd = await repository();
	await writeFile(join(cwd, "legacy.dat"), Buffer.from([255, 254, 65]));
	const capture = await captureReview({ cwd, target: { kind: "working-tree", base: "HEAD" } }, await destination());
	expect(capture.regions.find((region) => region.path === "legacy.dat")?.kind).toBe("non-text");
	expect(await readFile(join(capture.source, "legacy.dat"))).toEqual(Buffer.from([255, 254, 65]));
});

test("rename and deletion records remain visible beside the region inventory", async () => {
	const cwd = await repository();
	await rename(join(cwd, "value.ts"), join(cwd, "renamed.ts"));
	await rm(join(cwd, "caller.ts"));
	const capture = await captureReview({ cwd, target: { kind: "working-tree", base: "HEAD" } }, await destination());
	expect(capture.changes).toContainEqual({ status: "R100", path: "renamed.ts", previousPath: "value.ts" });
	expect(capture.changes).toContainEqual({ status: "D", path: "caller.ts" });
});

test("an uninitialized submodule keeps its recorded pointer rather than borrowing the parent repository HEAD", async () => {
	const cwd = await repository();
	const pointer = "a".repeat(40);
	await git(cwd, ["update-index", "--add", "--cacheinfo", `160000,${pointer},module`]);
	await mkdir(join(cwd, "module"));
	const capture = await captureReview({ cwd, target: { kind: "working-tree", base: "HEAD" } }, await destination());
	expect(capture.files.find((entry) => entry.path === "module")?.blob).toBe(pointer);
	expect(capture.omissions).toContainEqual({
		path: "module",
		reason: "submodule pointer only; referenced content is not captured",
	});
});

test("an external symlink retains its text and declares that its destination is not frozen", async () => {
	const cwd = await repository();
	const outside = await mkdtemp(join(tmpdir(), "review-external-link-"));
	directories.push(outside);
	const target = join(outside, "live.txt");
	await writeFile(target, "outside\n");
	await symlink(target, join(cwd, "linked.txt"));
	const capture = await captureReview({ cwd, target: { kind: "working-tree", base: "HEAD" } }, await destination());
	expect(await readlink(join(capture.source, "linked.txt"))).toBe(target);
	expect(capture.omissions).toContainEqual({
		path: "linked.txt",
		reason: "Symlink destination is outside the capture; only its link text is frozen",
	});
});

async function destination() {
	const root = await mkdtemp(join(tmpdir(), "review-artifact-"));
	directories.push(root);
	return join(root, "capture");
}

test("a working-tree review retains changed, unchanged and untracked bytes without staging the author's work", async () => {
	const cwd = await repository();
	await writeFile(join(cwd, "value.ts"), "export const value = 2;\n");
	await git(cwd, ["add", "value.ts"]);
	await writeFile(join(cwd, "value.ts"), "export const value = 3;\n");
	await writeFile(join(cwd, "new file.txt"), "  not committed\r\n");
	const index = await readFile(join(cwd, ".git/index"));
	const status = await git(cwd, ["status", "--porcelain=v1"]);
	const capture = await captureReview({ cwd, target: { kind: "working-tree", base: "HEAD" } }, await destination());
	await writeFile(join(cwd, "value.ts"), "export const value = 4;\n");
	expect(await readFile(join(capture.source, "value.ts"), "utf8")).toBe("export const value = 3;\n");
	expect(await readFile(join(capture.source, "caller.ts"), "utf8")).toBe(
		'import { value } from "./value.js";\nconsole.log(value);\n',
	);
	expect(await readFile(join(capture.source, "new file.txt"), "utf8")).toBe("  not committed\r\n");
	expect(await git(capture.source, ["show", `${capture.baseTree}:value.ts`])).toBe("export const value = 1;");
	expect(capture.regions.map((region) => region.path).sort()).toEqual(["new file.txt", "value.ts"]);
	expect(await readFile(join(cwd, ".git/index"))).toEqual(index);
	expect(await git(cwd, ["status", "--porcelain=v1"])).toBe(status);
});
