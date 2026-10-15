import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lintContext } from "../src/lint.js";

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function repository(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "apple-pi-context-lint-"));
	directories.push(root);
	execFileSync("git", ["init", "-q"], { cwd: root });
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	}
	return root;
}

describe("lintContext", () => {
	it("passes a sidecar whose sections, paths, and wiki links resolve", async () => {
		const root = repository({
			"app/main.py": "class Router:\n    def get(self): pass\n",
			"app/auth.py": "",
			"tests/test_main.py": "",
			".wiki/application-bootstrap.md": "# Bootstrap\n",
			"app/main.py.context": [
				"## file",
				"",
				"See [[Application-Bootstrap#Order|bootstrap]].",
				"",
				"## symbol:Router.get",
				"",
				"Invariant: x.",
				"Coupled: app/auth.py",
				"Verify: tests/test_main.py",
				"",
				"```",
				"# not a heading",
				"```",
			].join("\n"),
		});

		await expect(lintContext(join(root, "app"))).resolves.toEqual({ sidecarCount: 1, findings: [] });
	});

	it("reports every kind of broken sidecar", async () => {
		const root = repository({
			"app/main.py": "def create_app(): pass\n",
			"app/gone.py.context": "## file\n",
			"app/main.py.context": [
				"## file",
				"### Notes",
				"## symbol:create_app",
				"## symbol:create_app",
				"## symbol:Server.missing",
				"Coupled: app/auth.py, app/main.py",
				"Verify: tests/none.py",
				"See [[nowhere]].",
			].join("\n"),
		});

		const { sidecarCount, findings } = await lintContext(root);
		expect(sidecarCount).toBe(2);
		expect(findings.map((finding) => [finding.kind, finding.path, finding.line])).toEqual([
			["orphaned-sidecar", "app/gone.py.context", undefined],
			["invalid-heading", "app/main.py.context", 2],
			["duplicate-heading", "app/main.py.context", 4],
			["missing-symbol", "app/main.py.context", 5],
			["broken-coupled", "app/main.py.context", 6],
			["broken-verify", "app/main.py.context", 7],
			["broken-wiki-link", "app/main.py.context", 8],
		]);
	});
});
