import { execFileSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clusterFindings, extractSealedHunk } from "../src/evidence.js";
import {
	assertReviewInputUnchanged,
	isLedgerHistoryPath,
	materializeReviewTree,
	previewReviewInput,
	ReviewInputError,
	resolveReviewInput,
	resolveReviewTargetRoot,
	reviewRepositoryRoot,
} from "../src/git.js";
import { groundReportedAnchor, resolveReviewAnchor } from "../src/location.js";
import { appendReviewReceipt, loadReviewRun } from "../src/receipts.js";
import { plannerPrompt } from "../src/roles.js";
import type { ReviewItem, ReviewRun } from "../src/types.js";
import { compileReviewCycle, ReviewGraphError } from "../src/work-graph.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function initRepository(withCommit = true): string {
	const root = mkdtempSync(join(tmpdir(), "apple-review-core-"));
	roots.push(root);
	execFileSync("git", ["init", "-q", root]);
	execFileSync("git", ["-C", root, "config", "user.email", "review@example.test"]);
	execFileSync("git", ["-C", root, "config", "user.name", "Review Test"]);
	if (withCommit) {
		writeFileSync(join(root, "source.ts"), "export const value = 1;\n");
		execFileSync("git", ["-C", root, "add", "."]);
		execFileSync("git", ["-C", root, "commit", "-qm", "baseline"]);
	}
	return root;
}

function coverItems(files: string[]) {
	return [
		{
			title: "Change",
			files,
			focuses: [
				{
					title: "Change focus",
					question: "Does the selected change hold?",
					checks: ["Inspect the selected items."],
				},
			],
		},
	];
}

function stubItem(overrides: Pick<ReviewItem, "id" | "path" | "status">): ReviewItem {
	return {
		diff: "",
		insertions: 0,
		deletions: 0,
		fingerprint: overrides.id,
		binary: false,
		...overrides,
	};
}

describe("review input", () => {
	it("seals tracked, untracked, and binary workspace changes", () => {
		const root = initRepository();
		writeFileSync(join(root, "source.ts"), "export const value = 2;\n");
		writeFileSync(join(root, "new.ts"), "export const added = true;\n");
		writeFileSync(join(root, "asset.bin"), Buffer.from([0, 1, 2]));
		const preview = previewReviewInput(root, { mode: "workspace" });
		expect(preview.reviewable.map((item) => [item.status, item.path])).toEqual(
			[
				["modified", "source.ts"],
				["untracked", "asset.bin"],
				["untracked", "new.ts"],
			].filter(([, path]) => path !== "asset.bin"),
		);
		expect(preview.waived.map(({ item }) => item.path)).toEqual(["asset.bin"]);
		expect(preview.reviewable.find((item) => item.path === "new.ts")?.diff).toContain("+export const added = true;");
		expect(preview.inputHash).toMatch(/^[a-f0-9]{64}$/);
		const firstHash = preview.inputHash;
		chmodSync(join(root, "new.ts"), 0o755);
		expect(previewReviewInput(root, { mode: "workspace" }).inputHash).not.toBe(firstHash);
		const binaryHash = previewReviewInput(root, { mode: "workspace" }).inputHash;
		writeFileSync(join(root, "asset.bin"), Buffer.from([0, 9, 9]));
		expect(previewReviewInput(root, { mode: "workspace" }).inputHash).not.toBe(binaryHash);
	});

	it("seals dangling symlinks and invalid UTF-8 bytes without following or normalizing them", () => {
		const root = initRepository();
		symlinkSync("missing-target", join(root, "dangling-link"));
		writeFileSync(join(root, "non-utf8.dat"), Buffer.from([0x80]));
		const first = previewReviewInput(root, { mode: "workspace" });
		expect(first.reviewable.find((item) => item.path === "dangling-link")?.diff).toContain("new file mode 120000");
		expect(first.waived.map(({ item }) => item.path)).toContain("non-utf8.dat");
		const firstHash = first.inputHash;
		writeFileSync(join(root, "non-utf8.dat"), Buffer.from([0x81]));
		expect(previewReviewInput(root, { mode: "workspace" }).inputHash).not.toBe(firstHash);
	});

	it("authorizes agent-selected nested repositories and linked worktrees without opening arbitrary sibling repositories", () => {
		const parent = mkdtempSync(join(tmpdir(), "apple-review-parent-"));
		roots.push(parent);
		const nested = join(parent, "nested-repository");
		execFileSync("git", ["init", "-q", nested]);
		execFileSync("git", ["-C", nested, "config", "user.email", "review@example.test"]);
		execFileSync("git", ["-C", nested, "config", "user.name", "Review Test"]);
		writeFileSync(join(nested, "source.ts"), "export const nested = true;\n");
		execFileSync("git", ["-C", nested, "add", "."]);
		execFileSync("git", ["-C", nested, "commit", "-qm", "baseline"]);
		expect(resolveReviewTargetRoot(parent, "nested-repository")).toBe(reviewRepositoryRoot(nested));
		const externalWorktreeParent = mkdtempSync(join(tmpdir(), "apple-review-external-worktree-"));
		roots.push(externalWorktreeParent);
		const externalWorktree = join(externalWorktreeParent, "linked-from-child");
		execFileSync("git", ["-C", nested, "worktree", "add", "-q", "-b", "nested-review-target", externalWorktree]);
		expect(resolveReviewTargetRoot(parent, externalWorktree)).toBe(reviewRepositoryRoot(externalWorktree));

		const main = initRepository();
		const worktreeParent = mkdtempSync(join(tmpdir(), "apple-review-worktree-parent-"));
		roots.push(worktreeParent);
		const worktree = join(worktreeParent, "linked-worktree");
		execFileSync("git", ["-C", main, "worktree", "add", "-q", "-b", "review-target", worktree]);
		expect(resolveReviewTargetRoot(main, worktree)).toBe(reviewRepositoryRoot(worktree));

		const unrelated = initRepository();
		try {
			resolveReviewTargetRoot(main, unrelated);
			throw new Error("expected unrelated repository rejection");
		} catch (error) {
			expect(error).toBeInstanceOf(ReviewInputError);
			expect((error as ReviewInputError).code).toBe("unauthorized_root");
		}
	});

	it("supports an unborn repository by treating cached and untracked files as additions", () => {
		const root = initRepository(false);
		writeFileSync(join(root, "cached.ts"), "export const cached = 1;\n");
		writeFileSync(join(root, "loose.ts"), "export const loose = 2;\n");
		execFileSync("git", ["-C", root, "add", "cached.ts"]);
		const input = resolveReviewInput(root, { mode: "workspace" });
		expect(input.resolvedHead).toBeUndefined();
		expect(input.items.map((item) => item.path).sort()).toEqual(["cached.ts", "loose.ts"]);
		expect(input.items.every((item) => item.status === "untracked")).toBe(true);
	});

	it("freezes merge-base ranges and root commits", () => {
		const root = initRepository();
		const base = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
		writeFileSync(join(root, "source.ts"), "export const value = 3;\n");
		execFileSync("git", ["-C", root, "add", "."]);
		execFileSync("git", ["-C", root, "commit", "-qm", "change"]);
		const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
		const range = resolveReviewInput(root, { mode: "range", from: base, to: head });
		expect(range.resolvedBase).toBe(base);
		expect(range.resolvedHead).toBe(head);
		expect(range.items).toHaveLength(1);
		writeFileSync(join(root, "source.ts"), "export const value = 999;\n");
		const tree = materializeReviewTree(range);
		expect(readFileSync(join(tree.root, "source.ts"), "utf8")).toBe("export const value = 3;\n");
		const treeRoot = tree.root;
		tree.cleanup();
		expect(existsSync(treeRoot)).toBe(false);
		const first = execFileSync("git", ["-C", root, "rev-list", "--max-parents=0", "HEAD"], { encoding: "utf8" }).trim();
		const rootCommit = resolveReviewInput(root, { mode: "commit", commit: first });
		expect(rootCommit.items.map((item) => item.path)).toEqual(["source.ts"]);
		expect(rootCommit.items[0].status).toBe("added");
	});
});

describe("review graph and anchors", () => {
	it("resolves planner path aliases and still rejects unknown hashes", () => {
		const root = initRepository();
		writeFileSync(join(root, "source.ts"), "export const value = 2;\n");
		writeFileSync(join(root, "source.test.ts"), "test('value', () => expect(2).toBe(2));\n");
		const items = previewReviewInput(root, { mode: "workspace" }).reviewable;
		const source = items.find((item) => item.path === "source.ts")!;
		const test = items.find((item) => item.path === "source.test.ts")!;
		const cycle = compileReviewCycle(coverItems([source.path, test.path]), items, 1, { maxFocuses: 6 }, new Set());
		expect(cycle.partitions[0].itemIds).toEqual([source.id, test.id]);
		expect(cycle.focuses[0].itemIds).toEqual([source.id, test.id]);
		const typo = `${source.id.slice(0, -1)}${source.id.endsWith("0") ? "1" : "0"}`;
		expect(() => compileReviewCycle(coverItems([typo, test.path]), items, 1, { maxFocuses: 6 }, new Set())).toThrow(
			ReviewGraphError,
		);
	});

	it("disambiguates two selected items that share a path", () => {
		const deleted = stubItem({ id: "a".repeat(64), path: "source.ts", status: "deleted" });
		const added = stubItem({ id: "b".repeat(64), path: "source.ts", status: "added" });
		const cycle = compileReviewCycle(
			coverItems(["source.ts (deleted)", "source.ts (added)"]),
			[deleted, added],
			1,
			{ maxFocuses: 6 },
			new Set(),
		);
		expect(cycle.partitions[0].itemIds).toEqual([deleted.id, added.id]);
		expect(() =>
			compileReviewCycle(coverItems(["source.ts"]), [deleted, added], 1, { maxFocuses: 6 }, new Set()),
		).toThrow(ReviewGraphError);
	});

	it("rejects empty checks and repeated investigations", () => {
		const root = initRepository();
		writeFileSync(join(root, "source.ts"), "export const value = 2;\n");
		const items = previewReviewInput(root, { mode: "workspace" }).reviewable;
		expect(() =>
			compileReviewCycle(
				[{ files: [items[0].path], focuses: [{ title: "X", question: "Y?", checks: [] }] }],
				items,
				1,
				{ maxFocuses: 3 },
				new Set(),
			),
		).toThrow(/empty checks/i);
		const first = compileReviewCycle(coverItems([items[0].path]), items, 1, { maxFocuses: 3 }, new Set());
		const prior = new Set([
			`${first.focuses[0].itemIds.slice().sort().join("\0")}\0${first.focuses[0].question.toLowerCase()}`,
		]);
		expect(() => compileReviewCycle(coverItems([items[0].path]), items, 2, { maxFocuses: 3 }, prior)).toThrow(
			/repeats a previous/i,
		);
	});

	it("gives every planner item a short excerpt and forbids complete-diff reconstruction", () => {
		const root = initRepository();
		writeFileSync(join(root, "source.ts"), `export const value = "${"é".repeat(10_000)}";\n`);
		writeFileSync(join(root, "removed.ts"), "remove me\n");
		execFileSync("git", ["-C", root, "add", "."]);
		execFileSync("git", ["-C", root, "commit", "-qm", "add removable file"]);
		execFileSync("git", ["-C", root, "rm", "removed.ts"]);
		writeFileSync(join(root, "source.ts"), `export const value = "${"é".repeat(10_001)}";\n`);
		const input = resolveReviewInput(root, { mode: "workspace" });
		const prompt = plannerPrompt(input, input.items, {
			background: "Changing the public value contract.",
			reviewRoot: root,
			cycle: 1,
			maxCycles: 1,
			maxFocuses: 6,
			excerptBytes: 120,
		});
		for (const item of input.items) {
			expect(prompt).toContain(`id: ${item.path}`);
			expect(prompt).not.toContain(item.id);
		}
		expect(prompt).toContain("Use the item IDs shown in the manifest exactly");
		expect(prompt).toContain("Maximum focuses this cycle: 6");
		expect(prompt).toContain("Changing the public value contract.");
		expect(prompt).toMatch(/This is not the review/);
		expect(prompt).not.toContain("read_sealed_review_diff");
		expect(prompt).toContain("[excerpt truncated; do not reconstruct the rest]");
		expect(prompt).toContain(".ledger/ is shaping history");
	});

	it("locates unique changed-side evidence and preserves ambiguity", () => {
		const root = initRepository();
		writeFileSync(join(root, "source.ts"), "export const value = 2;\nexport const other = 2;\n");
		const item = previewReviewInput(root, { mode: "workspace" }).reviewable[0];
		expect(resolveReviewAnchor(root, item, "export const value = 2;", "new")).toMatchObject({
			startLine: 1,
			endLine: 1,
			provenance: "exact_hunk",
			matchCount: 1,
		});
		const duplicate = { ...item, diff: item.diff.replace("export const other = 2;", "export const value = 2;") };
		expect(resolveReviewAnchor(root, duplicate, "export const value = 2;", "new").provenance).toBe("ambiguous");
		expect(resolveReviewAnchor(root, item, "not in patch", "new")).toEqual({ provenance: "unresolved", matchCount: 0 });
		expect(
			groundReportedAnchor(root, item, "export const value = 2;", "new", { startLine: 1, endLine: 1 }),
		).toMatchObject({ startLine: 1, endLine: 1, provenance: "exact_file" });
		expect(groundReportedAnchor(root, item, "paraphrase", "new", { startLine: 1, endLine: 1 })).toMatchObject({
			startLine: 1,
			endLine: 1,
			provenance: "exact_file",
		});
		expect(groundReportedAnchor(root, item, "", "new", { startLine: 99, endLine: 99 }).provenance).toBe("unresolved");
	});

	it("extracts deleted-side hunks from the sealed diff without densifying gaps", () => {
		const root = initRepository();
		writeFileSync(join(root, "gone.ts"), "export const gone = 1;\n");
		execFileSync("git", ["-C", root, "add", "gone.ts"]);
		execFileSync("git", ["-C", root, "commit", "-qm", "add gone"]);
		execFileSync("git", ["-C", root, "rm", "-q", "gone.ts"]);
		const item = previewReviewInput(root, { mode: "workspace" }).reviewable.find((entry) => entry.path === "gone.ts");
		expect(item?.status).toBe("deleted");
		const hunk = extractSealedHunk(root, item!, "old", 1, 40);
		expect(hunk).toContain("1| export const gone = 1;");
		expect(hunk.split("\n").every((line) => /^\d+\| /.test(line) && !line.endsWith("| "))).toBe(true);
	});

	it("clusters nearby findings on the same path and side", () => {
		expect(
			clusterFindings([
				{ id: "a", path: "src/a.ts", side: "new", startLine: 10, endLine: 12 },
				{ id: "b", path: "src/a.ts", side: "new", startLine: 14, endLine: 15 },
				{ id: "c", path: "src/b.ts", side: "new", startLine: 1, endLine: 1 },
				{ id: "d", path: "src/a.ts", side: "old", startLine: 11, endLine: 13 },
			]).map((cluster) => cluster.findingIds),
		).toEqual([["a", "b"], ["d"], ["c"]]);
	});

	it("keeps ledger history sealed and out of coverage", () => {
		const root = initRepository();
		writeFileSync(join(root, "source.ts"), "export const value = 2;\n");
		mkdirSync(join(root, ".ledger"), { recursive: true });
		writeFileSync(join(root, ".ledger", "task.md"), "# history\n");
		const preview = previewReviewInput(root, { mode: "workspace" });
		expect(preview.items.some((item) => isLedgerHistoryPath(item.path))).toBe(true);
		expect(preview.reviewable.some((item) => isLedgerHistoryPath(item.path))).toBe(false);
		expect(
			preview.waived.some(({ item, reason }) => item.path === ".ledger/task.md" && reason === "ledger history"),
		).toBe(true);
	});

	it("limits the sealed change to caller files, folders, and globs", () => {
		const root = initRepository();
		mkdirSync(join(root, "src"), { recursive: true });
		mkdirSync(join(root, "docs"), { recursive: true });
		writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
		writeFileSync(join(root, "src", "b.ts"), "export const b = 1;\n");
		writeFileSync(join(root, "docs", "note.md"), "note\n");
		writeFileSync(join(root, "extra.ts"), "export const extra = 1;\n");
		execFileSync("git", ["-C", root, "add", "src/a.ts", "src/b.ts", "docs/note.md"]);
		execFileSync("git", ["-C", root, "commit", "-qm", "add tree"]);
		writeFileSync(join(root, "src", "a.ts"), "export const a = 2;\n");
		writeFileSync(join(root, "src", "b.ts"), "export const b = 2;\n");
		writeFileSync(join(root, "docs", "note.md"), "changed\n");
		writeFileSync(join(root, "extra.ts"), "export const extra = 2;\n");

		const folder = previewReviewInput(root, { mode: "workspace" }, ["src"]);
		expect(folder.paths).toEqual(["src"]);
		expect(folder.reviewable.map((item) => item.path).sort()).toEqual(["src/a.ts", "src/b.ts"]);

		const file = previewReviewInput(root, { mode: "workspace" }, ["src/a.ts"]);
		expect(file.reviewable.map((item) => item.path)).toEqual(["src/a.ts"]);

		const glob = previewReviewInput(root, { mode: "workspace" }, ["**/*.ts"]);
		expect(glob.reviewable.map((item) => item.path).sort()).toEqual(["extra.ts", "src/a.ts", "src/b.ts"]);

		const scoped = resolveReviewInput(root, { mode: "workspace" }, ["src/a.ts"]);
		writeFileSync(join(root, "docs", "note.md"), "unrelated\n");
		writeFileSync(join(root, "extra.ts"), "export const extra = 3;\n");
		expect(previewReviewInput(root, { mode: "workspace" }, ["src/a.ts"]).inputHash).toBe(scoped.inputHash);
		assertReviewInputUnchanged(scoped);
		writeFileSync(join(root, "src", "a.ts"), "export const a = 3;\n");
		expect(previewReviewInput(root, { mode: "workspace" }, ["src/a.ts"]).inputHash).not.toBe(scoped.inputHash);
		expect(() => assertReviewInputUnchanged(scoped)).toThrow(ReviewInputError);
	});

	it("matches a rename when either path is in scope and rejects unsafe pathspecs", () => {
		const root = initRepository();
		execFileSync("git", ["-C", root, "mv", "source.ts", "renamed.ts"]);
		expect(previewReviewInput(root, { mode: "workspace" }, ["renamed.ts"]).reviewable.map((item) => item.path)).toEqual(
			["renamed.ts"],
		);
		expect(previewReviewInput(root, { mode: "workspace" }, ["source.ts"]).reviewable.map((item) => item.path)).toEqual([
			"renamed.ts",
		]);
		expect(() => previewReviewInput(root, { mode: "workspace" }, ["../outside.ts"])).toThrow(ReviewInputError);
		expect(() => previewReviewInput(root, { mode: "workspace" }, [":(exclude)src"])).toThrow(ReviewInputError);
	});

	it("rejects a persisted work graph that repeats a partition ID", async () => {
		const root = initRepository();
		writeFileSync(join(root, "source.ts"), "export const value = 2;\n");
		const item = previewReviewInput(root, { mode: "workspace" }).reviewable[0];
		const agentDir = mkdtempSync(join(tmpdir(), "apple-review-receipt-"));
		roots.push(agentDir);
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		try {
			const partition = {
				id: "same",
				cycle: 1,
				title: "Same",
				itemIds: [item.id],
			};
			const run: ReviewRun = {
				schemaVersion: 1,
				runId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
				projectRoot: root,
				source: { mode: "workspace" },
				profile: "fast",
				state: "planning",
				startedAt: "2026-08-16T00:00:00.000Z",
				updatedAt: "2026-08-16T00:00:00.000Z",
				inputHash: "a".repeat(64),
				selected: [{ ...item, diff: undefined } as ReviewRun["selected"][number]],
				waived: [],
				completedItemIds: [],
				failures: [],
				findings: [],
				residualRisk: [],
				totalTokens: 0,
				budgets: {
					timeoutSeconds: 60,
					maxConcurrency: 1,
					maxFocuses: 4,
					maxCycles: 1,
				},
				routing: { plannerMode: "review-planner", fastMode: "review-routine", strongMode: "review-rigorous" },
				agents: [],
				workGraph: {
					cycles: [
						{
							index: 1,
							partitions: [partition, { ...partition }],
							focuses: [
								{
									id: "same-focus",
									partitionId: "same",
									cycle: 1,
									title: "Same",
									question: "Did the selected item change?",
									checks: ["Inspect the selected item."],
									itemIds: [item.id],
								},
							],
						},
					],
					graphHash: "b".repeat(64),
				},
			};
			await expect(appendReviewReceipt(run, { stage: "planner", outcome: "graph_sealed" })).rejects.toThrow(
				/invalid work-graph coverage/i,
			);
			await expect(async () => loadReviewRun(root, run.runId)).rejects.toThrow();
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
		}
	});
});
