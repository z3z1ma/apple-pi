import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { resolveRalphRoots } from "../components/ralph/src/roots.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0).reverse()) rmSync(root, { recursive: true, force: true });
});

function repository(prefix: string): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	roots.push(root);
	execFileSync("git", ["init", "-q", root]);
	execFileSync("git", ["-C", root, "config", "user.email", "ralph@example.test"]);
	execFileSync("git", ["-C", root, "config", "user.name", "Ralph Test"]);
	writeFileSync(join(root, "source.txt"), "baseline\n");
	execFileSync("git", ["-C", root, "add", "."]);
	execFileSync("git", ["-C", root, "commit", "-qm", "baseline"]);
	return root;
}

describe("Ralph worktree and ledger roots", () => {
	it("defaults ledger authority to the selected worktree and permits an explicit main-checkout ledger", () => {
		const main = repository("ralph-roots-main-");
		const worktree = join(tmpdir(), `ralph-roots-linked-${randomUUID()}`);
		execFileSync("git", ["-C", main, "worktree", "add", "-q", "-b", `roots-${randomUUID()}`, worktree]);
		roots.push(worktree);

		expect(resolveRalphRoots(main, worktree)).toEqual({
			workspaceRoot: realpathSync(worktree),
			ledgerRoot: realpathSync(worktree),
		});
		expect(resolveRalphRoots(main, worktree, main)).toEqual({
			workspaceRoot: realpathSync(worktree),
			ledgerRoot: realpathSync(main),
		});
	});

	it("rejects roots from an unrelated repository", () => {
		const trusted = repository("ralph-roots-trusted-");
		const unrelated = repository("ralph-roots-unrelated-");
		expect(() => resolveRalphRoots(trusted, unrelated)).toThrowError(/not a linked worktree/);
		expect(() => resolveRalphRoots(trusted, trusted, unrelated)).toThrowError(/not a linked worktree/);
	});
});
