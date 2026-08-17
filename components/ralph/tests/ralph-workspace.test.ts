import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createExecutorAuthorityPolicy, explainBashDenial } from "../src/authority-policy.js";
import { assertWorkspaceReady, renderWorkspaceChanges, WorkspaceError } from "../src/workspace.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repository(): string {
	const root = mkdtempSync(join(tmpdir(), "ralph-workspace-"));
	roots.push(root);
	execFileSync("git", ["init", "-q", root]);
	execFileSync("git", ["-C", root, "config", "user.email", "ralph@example.test"]);
	execFileSync("git", ["-C", root, "config", "user.name", "Ralph Test"]);
	writeFileSync(join(root, "source.txt"), "before\n");
	execFileSync("git", ["-C", root, "add", "."]);
	execFileSync("git", ["-C", root, "commit", "-qm", "baseline"]);
	return root;
}

describe("Ralph workspace readiness", () => {
	it("allows a dirty checkout and renders status plus diff", () => {
		const root = repository();
		expect(() => assertWorkspaceReady(root)).not.toThrow();
		writeFileSync(join(root, "source.txt"), "after\n");
		writeFileSync(join(root, "new.txt"), "new\n");
		expect(() => assertWorkspaceReady(root)).not.toThrow();
		const rendered = renderWorkspaceChanges(root);
		expect(rendered).toContain("source.txt");
		expect(rendered).toContain("new.txt");
		expect(rendered).toContain("+after");
	});

	it("refuses merge-in-progress and Git submodules", () => {
		const merging = repository();
		writeFileSync(join(merging, ".git", "MERGE_HEAD"), "a".repeat(40));
		expect(() => assertWorkspaceReady(merging)).toThrow(WorkspaceError);
		expect(() => assertWorkspaceReady(merging)).toThrowError(/MERGE_HEAD/);

		const submodule = repository();
		const head = execFileSync("git", ["-C", submodule, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
		execFileSync("git", ["-C", submodule, "update-index", "--add", "--cacheinfo", `160000,${head},vendor/submodule`]);
		expect(() => assertWorkspaceReady(submodule)).toThrowError(/Git submodules/);
	});
});

describe("Ralph executor authority policy", () => {
	it("permits read-only access to an external authoritative ledger and nothing else there", async () => {
		const workspace = repository();
		const ledgerRoot = mkdtempSync(join(tmpdir(), "ralph-ledger-root-"));
		roots.push(ledgerRoot);
		mkdirSync(join(ledgerRoot, ".ledger", "202608151200-work"), { recursive: true });
		writeFileSync(join(ledgerRoot, ".ledger", "202608151200-work", "task.md"), "Status: active\n");
		writeFileSync(join(ledgerRoot, "unrelated.txt"), "not ledger authority\n");
		const canonicalLedgerRoot = realpathSync(ledgerRoot);
		const policy = createExecutorAuthorityPolicy(workspace, () => {}, canonicalLedgerRoot);
		expect(
			await policy({
				toolName: "read",
				args: { path: join(canonicalLedgerRoot, ".ledger", "202608151200-work", "task.md") },
			}),
		).toBeUndefined();
		expect(
			await policy({
				toolName: "edit",
				args: { path: join(canonicalLedgerRoot, ".ledger", "202608151200-work", "task.md") },
			}),
		).toMatchObject({ block: true, terminate: true });
		expect(
			await policy({ toolName: "bash", args: { command: "npm test", cwd: join(canonicalLedgerRoot, ".ledger") } }),
		).toMatchObject({ block: true, terminate: true });
		expect(
			await policy({ toolName: "read", args: { path: join(canonicalLedgerRoot, "unrelated.txt") } }),
		).toMatchObject({ block: true, terminate: true });
	});

	it("blocks external, destructive, and Git mutation commands while allowing local validation", async () => {
		expect(explainBashDenial("npm test")).toBeUndefined();
		expect(explainBashDenial("git diff --check")).toBeUndefined();
		expect(explainBashDenial("git push origin main")).toMatch(/Git mutation/);
		expect(explainBashDenial("/usr/bin/git commit -am nope")).toMatch(/project boundary/);
		expect(explainBashDenial("/usr/bin/curl https://example.test")).toMatch(/project boundary/);
		expect(explainBashDenial("cat ~/.ssh/id_rsa")).toMatch(/project boundary/);
		expect(explainBashDenial("grep secret ../outside.txt")).toMatch(/project boundary/);
		expect(explainBashDenial("printenv")).toMatch(/environment-dumping/);
		expect(explainBashDenial("python -c 'import os; os.remove(\"x\")'")).toMatch(/one command|Inline or indirect/);
		expect(explainBashDenial("find . -delete")).toMatch(/project boundary|filesystem mutation/);
		expect(explainBashDenial("npm install unsafe")).toMatch(/Publishing/);
		expect(explainBashDenial("npm test;rm -rf build")).toMatch(/one command/);
		expect(explainBashDenial("printf x > linked.txt")).toMatch(/redirection/);
		expect(explainBashDenial("ln -s /tmp/outside linked.txt")).toMatch(/project boundary|filesystem mutation/);
		expect(explainBashDenial("sh -c 'git commit -am nope'")).toMatch(/Inline, indirect/);
		expect(explainBashDenial("git branch feature/escape")).toMatch(/branch mutation/);
		expect(explainBashDenial("git branch --show-current")).toBeUndefined();
		expect(explainBashDenial("rm -rf build")).toMatch(/filesystem mutation/);
		expect(explainBashDenial("curl https://example.test")).toMatch(/Network/);
		expect(explainBashDenial("npm publish")).toMatch(/Publishing/);

		const root = repository();
		const denials: string[] = [];
		const policy = createExecutorAuthorityPolicy(root, (denial) => denials.push(denial.reason));
		expect(await policy({ toolName: "write", args: { path: "src/new.ts" } })).toBeUndefined();
		expect(await policy({ toolName: "write", args: { path: "../outside.ts" } })).toMatchObject({
			block: true,
			terminate: true,
		});
		expect(await policy({ toolName: "edit", args: { path: ".git/config" } })).toMatchObject({ block: true });
		expect(await policy({ toolName: "edit", args: { path: ".ledger/202608151200-work/task.md" } })).toMatchObject({
			block: true,
		});
		expect(
			await policy({
				toolName: "bash",
				args: { command: "sed -i s/active/done/ task.md", cwd: ".ledger/202608151200-work" },
			}),
		).toMatchObject({ block: true });
		const outside = mkdtempSync(join(tmpdir(), "ralph-policy-outside-"));
		roots.push(outside);
		mkdirSync(join(root, "links"), { recursive: true });
		symlinkSync(outside, join(root, "links", "outside"));
		expect(await policy({ toolName: "write", args: { path: "links/outside/escaped.ts" } })).toMatchObject({
			block: true,
		});
		mkdirSync(join(root, "nested", ".git"), { recursive: true });
		expect(await policy({ toolName: "read", args: { path: "nested/file.ts" } })).toMatchObject({ block: true });
		expect(await policy({ toolName: "read", args: { path: "nested/.git/config" } })).toMatchObject({ block: true });
		expect(denials).toHaveLength(7);
	});
});
