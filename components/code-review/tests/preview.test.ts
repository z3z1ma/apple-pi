import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { git } from "../../shared/src/git.js";
import { previewLines } from "../src/presentation.js";
import { previewReview } from "../src/preview.js";

const directories: string[] = [];
afterEach(async () => {
	vi.unstubAllEnvs();
	for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

test("preview returns resolved identity and explicit limits without retaining scratch source", async () => {
	const cwd = await fs.mkdtemp(join(tmpdir(), "preview-source-"));
	directories.push(cwd);
	await git(cwd, ["init", "-q"]);
	await fs.writeFile(join(cwd, "value.ts"), "export const value = 1;\n");
	await git(cwd, ["add", "."]);
	await git(cwd, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base"]);
	await fs.writeFile(join(cwd, "value.ts"), "export const value = 2;\n");
	const scratch = await fs.mkdtemp(join(tmpdir(), "preview-scratch-"));
	directories.push(scratch);
	vi.stubEnv("TMPDIR", scratch);
	const request = { cwd, target: { kind: "working-tree" as const, base: "HEAD" }, intent: { text: "Export two." } };
	const preview = await previewReview(request);
	expect(preview.baseCommit).toBe(await git(cwd, ["rev-parse", "HEAD"]));
	expect(preview.headTree).not.toBe(preview.baseTree);
	expect(preview.intent).toMatchObject({ origin: "request", hash: expect.any(String) });
	expect(preview.changes).toEqual([{ status: "M", path: "value.ts" }]);
	expect(previewLines(preview).join("\n")).toContain(preview.digest);
	expect(previewLines(preview).join("\n")).toContain(preview.headTree);
	expect(await fs.readdir(scratch)).toEqual([]);
	expect((await previewReview(request)).digest).toBe(preview.digest);
	await expect(previewReview({ ...request, target: { kind: "commit", commit: "missing" } })).rejects.toThrow();
	expect(await fs.readdir(scratch)).toEqual([]);
	const controller = new AbortController();
	controller.abort();
	await expect(previewReview(request, controller.signal)).rejects.toThrow();
	expect(await fs.readdir(scratch)).toEqual([]);
	const empty = await previewReview({ cwd, target: { kind: "range", base: "HEAD", head: "HEAD" } });
	expect(empty.changes).toEqual([]);
	expect(previewLines(empty).join("\n")).toContain("intent compliance stays unassessed");
	expect(await fs.readdir(scratch)).toEqual([]);
});
