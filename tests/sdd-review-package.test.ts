import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const reviewPackageScript = resolve("skills/ledger-subagent-driven-development/scripts/review-package");
const tempDirs: string[] = [];

function run(cwd: string, command: string, args: string[]): string {
	return execFileSync(command, args, { cwd, encoding: "utf8" });
}

function createRepository(): { root: string; plan: string } {
	const root = mkdtempSync(join(tmpdir(), "apple-pi-sdd-review-"));
	tempDirs.push(root);
	run(root, "git", ["init", "-q"]);
	run(root, "git", ["config", "user.email", "test@example.invalid"]);
	run(root, "git", ["config", "user.name", "Test"]);

	const taskRoot = join(root, ".ledger", "demo");
	mkdirSync(join(taskRoot, "plans"), { recursive: true });
	mkdirSync(join(taskRoot, "evidence", "sdd", "demo"), { recursive: true });
	writeFileSync(join(taskRoot, "task.md"), "Status: active\n\n# Demo\n");
	const plan = join(taskRoot, "plans", "demo.md");
	writeFileSync(plan, "Status: active\n\n# Demo plan\n\n### WI-001: Add source\n");
	writeFileSync(join(root, "tracked.txt"), "base\n");
	run(root, "git", ["add", "."]);
	run(root, "git", ["commit", "-qm", "baseline"]);
	return { root, plan };
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("SDD review package", () => {
	it("includes spaced and binary untracked files while excluding its output artifact", () => {
		const { root, plan } = createRepository();
		mkdirSync(join(root, "src"));
		mkdirSync(join(root, "assets"));
		writeFileSync(join(root, "src", "new file.ts"), "export const created = true;\n");
		writeFileSync(join(root, "assets", "new blob.bin"), Uint8Array.from([0, 1, 2, 255]));

		const shortBase = run(root, "git", ["rev-parse", "--short", "HEAD"]).trim();
		const output = join(root, ".ledger", "demo", "evidence", "sdd", "demo", `review-${shortBase}-worktree.diff`);
		writeFileSync(output, "stale output must be excluded\n");

		run(root, "bash", [reviewPackageScript, plan, "HEAD", output]);
		const reviewPackage = readFileSync(output, "utf8");

		expect(reviewPackage).toContain("export const created = true;");
		expect(reviewPackage).toContain("src/new file.ts");
		expect(reviewPackage).toContain("assets/new blob.bin");
		expect(reviewPackage).toMatch(/GIT binary patch|Binary files .* differ/);
		expect(reviewPackage).not.toContain("stale output must be excluded");
		expect(reviewPackage).not.toContain(`review-${shortBase}-worktree.diff`);
	});
});
