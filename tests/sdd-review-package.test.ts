import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
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
	it("creates unique packages without overwriting or recursively packaging prior evidence", () => {
		const { root, plan } = createRepository();
		mkdirSync(join(root, "src"));
		mkdirSync(join(root, "assets"));
		writeFileSync(join(root, "src", "new file.ts"), "export const created = true;\n");
		writeFileSync(join(root, "assets", "new blob.bin"), Uint8Array.from([0, 1, 2, 255]));
		const sentinel = join(root, "src", "untracked sentinel.ts");
		writeFileSync(sentinel, "do not overwrite\n");
		const packageDir = join(root, ".ledger", "demo", "evidence", "sdd", "demo");
		const packageLikeText = join(packageDir, "review-user-worktree.notes");
		const packageLikeBinary = join(packageDir, "review-user-worktree.bin");
		writeFileSync(packageLikeText, "caller-owned package-like file\n");
		writeFileSync(packageLikeBinary, Uint8Array.from([0, 4, 8, 255]));

		const packagePath = (stdout: string): string => {
			const match = stdout.match(/^wrote (.*): \d+ bytes$/m);
			if (!match) throw new Error(`unexpected review-package output: ${stdout}`);
			return match[1];
		};

		const first = packagePath(run(root, "bash", [reviewPackageScript, plan, "HEAD"]));
		const firstContents = readFileSync(first, "utf8");
		expect(firstContents).toContain("export const created = true;");
		expect(firstContents).toContain("src/new file.ts");
		expect(firstContents).toContain("assets/new blob.bin");
		expect(firstContents).toContain("do not overwrite");
		expect(firstContents).toContain("caller-owned package-like file");
		expect(firstContents).toContain("review-user-worktree.bin");
		expect(firstContents).toMatch(/GIT binary patch|Binary files .* differ/);
		const firstRelative = relative(realpathSync(root), first);
		expect(firstContents).not.toContain(firstRelative);

		const second = packagePath(run(root, "bash", [reviewPackageScript, plan, "HEAD"]));
		expect(second).not.toBe(first);
		expect(readFileSync(first, "utf8")).toBe(firstContents);
		expect(readFileSync(second, "utf8")).not.toContain(firstRelative);

		const rejected = spawnSync("bash", [reviewPackageScript, plan, "HEAD", sentinel], {
			cwd: root,
			encoding: "utf8",
		});
		expect(rejected.status).toBe(2);
		expect(rejected.stderr).toContain("usage: review-package PLAN_FILE BASE");
		expect(readFileSync(sentinel, "utf8")).toBe("do not overwrite\n");
	});

	it("packages a prior helper path when its recorded identity no longer matches", () => {
		const { root, plan } = createRepository();
		const packagePath = (stdout: string): string => {
			const match = stdout.match(/^wrote (.*): \d+ bytes$/m);
			if (!match) throw new Error(`unexpected review-package output: ${stdout}`);
			return match[1];
		};

		const first = packagePath(run(root, "bash", [reviewPackageScript, plan, "HEAD"]));
		const firstRelative = relative(realpathSync(root), first);
		writeFileSync(first, "# Review package: forged replacement\ncaller-owned replacement\n");
		const second = packagePath(run(root, "bash", [reviewPackageScript, plan, "HEAD"]));
		const secondContents = readFileSync(second, "utf8");
		expect(secondContents).toContain(firstRelative);
		expect(secondContents).toContain("caller-owned replacement");

		unlinkSync(first);
		const sentinel = join(root, "package identity sentinel.txt");
		writeFileSync(sentinel, "# Review package: caller sentinel\n");
		symlinkSync(sentinel, first);
		const third = packagePath(run(root, "bash", [reviewPackageScript, plan, "HEAD"]));
		const thirdContents = readFileSync(third, "utf8");
		expect(thirdContents).toContain(firstRelative);
		expect(thirdContents).toContain("package identity sentinel.txt");
		expect(readFileSync(sentinel, "utf8")).toBe("# Review package: caller sentinel\n");
	});

	it("does not treat a self-hashed package-like file outside this plan workspace as helper-owned", () => {
		const { root, plan } = createRepository();
		mkdirSync(join(root, "src"));
		const content =
			"# Review package: HEAD..WORKTREE\n# Package ID: .review-package.tmp.caller\n\ncaller-owned external package\n";
		const digest = createHash("sha256").update(content).digest("hex");
		const callerFile = join(root, "src", `review-deadbeef-worktree-${digest}.diff`);
		writeFileSync(callerFile, content);

		const stdout = run(root, "bash", [reviewPackageScript, plan, "HEAD"]);
		const match = stdout.match(/^wrote (.*): \d+ bytes$/m);
		if (!match) throw new Error(`unexpected review-package output: ${stdout}`);
		const reviewPackage = readFileSync(match[1], "utf8");
		expect(reviewPackage).toContain(relative(realpathSync(root), realpathSync(callerFile)));
		expect(reviewPackage).toContain("caller-owned external package");
	});

	it("rejects a symlinked evidence directory before creating an external workspace", () => {
		const { root, plan } = createRepository();
		const evidence = join(root, ".ledger", "demo", "evidence");
		rmSync(evidence, { recursive: true, force: true });
		const external = mkdtempSync(join(tmpdir(), "apple-pi-sdd-external-evidence-"));
		tempDirs.push(external);
		symlinkSync(external, evidence);

		const result = spawnSync("bash", [reviewPackageScript, plan, "HEAD"], {
			cwd: root,
			encoding: "utf8",
		});
		expect(result.status).toBe(2);
		expect(result.stderr).toContain("refusing unsafe SDD workspace path");
		expect(existsSync(join(external, "sdd"))).toBe(false);
	});

	it("rejects a plan outside the current repository before creating evidence", () => {
		const { root } = createRepository();
		const externalRoot = mkdtempSync(join(tmpdir(), "apple-pi-sdd-external-plan-"));
		tempDirs.push(externalRoot);
		const externalPlan = join(externalRoot, ".ledger", "external", "plans", "plan.md");
		mkdirSync(join(externalRoot, ".ledger", "external", "plans"), { recursive: true });
		writeFileSync(externalPlan, "Status: active\n\n# External plan\n");

		const result = spawnSync("bash", [reviewPackageScript, externalPlan, "HEAD"], {
			cwd: root,
			encoding: "utf8",
		});
		expect(result.status).toBe(2);
		expect(result.stderr).toContain("plan file must be under this repository");
		expect(existsSync(join(externalRoot, ".ledger", "external", "evidence"))).toBe(false);
	});
});
