import { describe, expect, it } from "bun:test";
import { buildSections } from "../src/core/build-sections.js";
import { pathsModifiedByBash } from "../src/extract/bash-files.js";
import type { NormalizedBlock } from "../src/types.js";

describe("pathsModifiedByBash", () => {
	it("collects git add / rm / mv paths", () => {
		expect(pathsModifiedByBash("git add src/a.ts src/b.ts")).toEqual(["src/a.ts", "src/b.ts"]);
		expect(pathsModifiedByBash("git rm src/old.ts")).toEqual(["src/old.ts"]);
		expect(pathsModifiedByBash("git mv src/a.ts src/b.ts")).toEqual(["src/a.ts", "src/b.ts"]);
	});

	it("collects rm, mv, cp, tee, and redirects", () => {
		expect(pathsModifiedByBash("rm -rf src/old.ts")).toEqual(["src/old.ts"]);
		expect(pathsModifiedByBash("mv src/a.ts src/b.ts")).toEqual(["src/a.ts", "src/b.ts"]);
		expect(pathsModifiedByBash("cp src/a.ts dest/a.ts")).toEqual(["src/a.ts", "dest/a.ts"]);
		expect(pathsModifiedByBash("npm test | tee tmp/out.log")).toEqual(["tmp/out.log"]);
		expect(pathsModifiedByBash("echo x > foo.ts")).toEqual(["foo.ts"]);
		expect(pathsModifiedByBash("echo x >> foo.ts")).toEqual(["foo.ts"]);
	});

	it("strips cd prefixes and quoted paths", () => {
		expect(pathsModifiedByBash('cd pkg && git add "src/my file.ts"')).toEqual(["src/my file.ts"]);
	});

	it("ignores non-write commands and non-paths", () => {
		expect(pathsModifiedByBash("npm test")).toEqual([]);
		expect(pathsModifiedByBash("git status")).toEqual([]);
		expect(pathsModifiedByBash("git add -A")).toEqual([]);
		expect(pathsModifiedByBash("cat src/a.ts")).toEqual([]);
		expect(pathsModifiedByBash("cat rm src/a.ts")).toEqual([]);
		expect(pathsModifiedByBash("echo git add src/a.ts")).toEqual([]);
		expect(pathsModifiedByBash("echo x > /dev/null")).toEqual([]);
		expect(pathsModifiedByBash('git commit -m "feat: x"')).toEqual([]);
	});

	it("treats sudo rm as a write command", () => {
		expect(pathsModifiedByBash("sudo rm src/legacy.ts")).toEqual(["src/legacy.ts"]);
	});
});

describe("buildSections file activity from bash", () => {
	it("records bash tool_call writes as Modified", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "tool_call", name: "Bash", args: { command: "git add src/auth.ts" } },
			{ kind: "tool_result", name: "Bash", text: "ok", isError: false },
		];
		const r = buildSections({ blocks });
		expect(r.filesAndChanges.some((l) => l.includes("Modified") && l.includes("src/auth.ts"))).toBe(true);
	});

	it("records bashExecution writes as Modified", () => {
		const blocks: NormalizedBlock[] = [{ kind: "bash", command: "rm src/legacy.ts", output: "", exitCode: 0 }];
		const r = buildSections({ blocks });
		expect(r.filesAndChanges.some((l) => l.includes("Modified") && l.includes("src/legacy.ts"))).toBe(true);
	});
});
