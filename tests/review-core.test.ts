import { execFileSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	materializeReviewTree,
	previewReviewInput,
	resolveReviewInput,
	resolveReviewTargetRoot,
	ReviewInputError,
	reviewRepositoryRoot,
} from "../components/review/src/git.js";
import { resolveReviewAnchor } from "../components/review/src/location.js";
import { compileReviewWorkGraph, ReviewGraphError } from "../components/review/src/work-graph.js";

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
	it("requires an exact semantic partition and applies the profile tier", () => {
		const root = initRepository();
		writeFileSync(join(root, "source.ts"), "export const value = 2;\n");
		writeFileSync(join(root, "source.test.ts"), "test('value', () => expect(2).toBe(2));\n");
		const items = previewReviewInput(root, { mode: "workspace" }).reviewable;
		const graph = compileReviewWorkGraph(
			{
				summary: "Implementation and test form one behavior change.",
				groups: [
					{
						id: "value-contract",
						title: "Value contract",
						objective: "Falsify the changed value behavior and its test oracle.",
						itemIds: items.map((item) => item.id),
						contextPaths: [],
						tier: "fast",
						rationale: "The test directly specifies the implementation change.",
					},
				],
			},
			items,
			"thorough",
			8,
		);
		expect(graph.groups[0].tier).toBe("strong");
		expect(graph.graphHash).toMatch(/^[a-f0-9]{64}$/);
		try {
			compileReviewWorkGraph(
				{ summary: "bad", groups: [{ ...graph.groups[0], itemIds: [items[0].id] }] },
				items,
				"balanced",
				8,
			);
			throw new Error("expected omitted item failure");
		} catch (error) {
			expect(error).toBeInstanceOf(ReviewGraphError);
			expect((error as ReviewGraphError).code).toBe("missing_items");
		}
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
	});
});
