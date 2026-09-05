import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { installSearchRootGuard, searchRootBlockReason } from "../src/index.js";

// This guard is deliberately dumb and best-effort: stop the obvious case of an agent grepping or
// globbing over a huge directory (home, "/", or a configured root) by no fault of its own. It is
// not a shell interpreter and does not try to resist deliberate evasion; anywhere a bash command
// gets genuinely ambiguous, it gives up and lets the command run.

const HOME = "/Users/example";
const CODE_PROJECTS = `${HOME}/code_projects`;
const WORK = `${CODE_PROJECTS}/work`;
const REPO = `${WORK}/repos/apple-pi`;
const BRACED_HOME = "$" + "{HOME}";
const POLICY = { home: HOME, protectedRoots: ["/", "~", "~/code_projects", "~/code_projects/work"] };

function harness() {
	let handler: ((event: any, ctx: ExtensionContext) => unknown) | undefined;
	const pi = {
		on(name: string, next: typeof handler) {
			if (name === "tool_call") handler = next;
		},
	};
	installSearchRootGuard(pi as unknown as ExtensionAPI, {
		home: HOME,
		loadConfig: () => ({ protectedRoots: POLICY.protectedRoots }),
	});
	if (!handler) throw new Error("Missing tool_call handler");
	return handler;
}

describe("search root guard: grep/find/glob tools", () => {
	it.each([
		["grep", { pattern: "needle", path: "/" }],
		["grep", { pattern: "needle", path: HOME }],
		["grep", { pattern: "needle", path: "~" }],
		["find", { pattern: "*.ts", path: "$HOME/" }],
		["glob", { pattern: "**/*.ts", root: BRACED_HOME }],
		["glob", { pattern: "**/*", path: HOME }],
		["glob", { pattern: "**/*", root: REPO, path: WORK }],
		["grep", { pattern: "needle", path: CODE_PROJECTS }],
		["find", { pattern: "release-candidate-*", path: "~/code_projects/work" }],
		["glob", { pattern: "**/*", root: `${BRACED_HOME}/code_projects/work` }],
		["glob", { pattern: "/**/*" }],
		["glob", { pattern: "../../../**/*" }],
		["grep", { pattern: "needle", path: `${HOME}/..` }],
		["grep", { pattern: "needle", path: "file:///" }],
	])("blocks %s when its search root is protected", (toolName, input) => {
		expect(searchRootBlockReason(toolName, input, REPO, POLICY)).toMatch(/protected root/i);
	});

	it("resolves relative glob pattern roots from the explicit glob base", () => {
		expect(searchRootBlockReason("glob", { pattern: "../..", root: REPO }, "/tmp/narrow", POLICY)).toBeDefined();
	});

	it("recognizes ancestors of protected roots whose next segment begins with dots", () => {
		expect(
			searchRootBlockReason("grep", { pattern: "needle", path: "/Users" }, REPO, {
				home: HOME,
				protectedRoots: ["/", "/Users/..collection"],
			}),
		).toBeDefined();
	});

	it.each([HOME, CODE_PROJECTS, WORK])("blocks an implicit tool root at %s", (cwd) => {
		expect(searchRootBlockReason("grep", { pattern: "needle" }, cwd, POLICY)).toBeDefined();
	});

	it.each([
		["grep", { pattern: "needle", path: REPO }],
		["find", { pattern: "*.ts", path: "." }],
		["glob", { pattern: "**/*.ts", root: `${WORK}/worktrees/feature` }],
	])("allows %s with a specific repository or subdirectory", (toolName, input) => {
		expect(searchRootBlockReason(toolName, input, REPO, POLICY)).toBeUndefined();
	});

	it("canonicalizes symlinks before lexical parent traversal", () => {
		const home = mkdtempSync(join(tmpdir(), "search-root-guard-"));
		try {
			const work = join(home, "code_projects/work");
			const alias = join(home, "work-alias");
			mkdirSync(work, { recursive: true });
			symlinkSync(work, alias, "dir");
			for (const path of [alias, `${alias}/..`]) {
				expect(
					searchRootBlockReason("grep", { pattern: "needle", path }, "/repo", {
						home,
						protectedRoots: ["/", "~", "~/code_projects", "~/code_projects/work"],
					}),
				).toBeDefined();
			}
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	it("registers a blocking tool_call hook", () => {
		const result = harness()({ toolName: "grep", input: { pattern: "needle", path: WORK } }, {
			cwd: REPO,
		} as ExtensionContext);
		expect(result).toEqual({
			block: true,
			reason: `Blocked grep: refusing to search from protected root ${WORK}. Choose a specific repository, worktree, or subdirectory.`,
		});
	});
});

describe("search root guard: bash, obvious direct invocations", () => {
	it.each([
		"rg needle /",
		"rg needle ~",
		"grep -r needle $HOME",
		`find "${BRACED_HOME}" -name '*.ts'`,
		"find ~/code_projects/work -name '*.ts'",
		"rg 'needle|other' ~/code_projects/work",
		"fd needle ~/code_projects/work",
		"grep -e needle ~/code_projects/work",
		"find -E / -regex '.*'",
	])("blocks a direct search command over a protected literal root: %s", (command) => {
		expect(searchRootBlockReason("bash", { command }, REPO, POLICY)).toMatch(/protected root/i);
	});

	it.each([HOME, WORK])("blocks an implicit bash search root at %s", (cwd) => {
		for (const command of ["rg needle", "grep -r needle .", "find . -name '*.ts'", "fd needle .", "fdfind needle ."]) {
			expect(searchRootBlockReason("bash", { command }, cwd, POLICY)).toMatch(/protected root/i);
		}
	});

	it.each([
		"grep -r needle .",
		"find /tmp -name '*.ts'",
		"fd needle .",
		"fdfind needle .",
		"ripgrep needle .",
		"egrep needle .",
		"fgrep needle .",
		"'rg' needle .",
		"rg '/' .",
		"rg '$HOME' .",
		"/usr/bin/grep -r needle .",
		"rg --version",
		"grep --help",
		"rg needle 2>/dev/null",
		"grep --color=never needle .",
		"grep -n needle src/*.ts",
		"find src -type f -exec wc -l {} +",
		"fd -tf needle src",
		"rg -c needle .",
		"gopls check $(find internal/runtime -name '*.go')", // nested $(...) isn't parsed; accepted
	])("allows a search command with a safe literal root: %s", (command) => {
		expect(searchRootBlockReason("bash", { command }, REPO, POLICY)).toBeUndefined();
	});
});

describe("search root guard: bash, heredocs stay inert", () => {
	it.each([
		["cat <<'EOF' > script.sh", "#!/bin/bash", "grep -r pattern /", "find / -name foo", "EOF"].join("\n"),
		["cat <<-EOF > doc.md", "\tRun `cd / && rg needle .` to search everything.", "\tEOF"].join("\n"),
		["cat <<A <<B", "first grep /", "A", "second find /", "B"].join("\n"),
		"mysql db <<< 'select 1'",
		["cat <<'EOF' > script.sh", `rg needle ${HOME}`, "EOF"].join("\n"),
	])("treats a heredoc body as inert data, even one naming a protected root: %s", (command) => {
		expect(searchRootBlockReason("bash", { command }, REPO, POLICY)).toBeUndefined();
	});

	it("allows a real search command with a literal safe root that also redirects stdin from a heredoc", () => {
		const command = "grep needle . <<'EOF'\nignored\nEOF";
		expect(searchRootBlockReason("bash", { command }, REPO, POLICY)).toBeUndefined();
	});

	it("still blocks a real search command over a protected root even when a heredoc shares the line", () => {
		const command = `grep needle ${HOME} <<'EOF'\nignored\nEOF`;
		expect(searchRootBlockReason("bash", { command }, REPO, POLICY)).toMatch(/protected root/i);
	});
});

describe("search root guard: bash, best-effort cd tracking", () => {
	it("follows a plain literal cd into a protected root before an implicit search", () => {
		expect(searchRootBlockReason("bash", { command: "cd ~/code_projects/work && rg needle" }, REPO, POLICY)).toMatch(
			/protected root/i,
		);
	});

	it("follows a plain literal cd via || before an implicit search", () => {
		expect(searchRootBlockReason("bash", { command: "cd / || true && rg needle" }, REPO, POLICY)).toMatch(
			/protected root/i,
		);
	});

	it("follows a relative cd against the invocation cwd", () => {
		expect(
			searchRootBlockReason("bash", { command: "cd repos/apple-pi && rg needle ." }, WORK, POLICY),
		).toBeUndefined();
	});

	it("gives up tracking once a cd target cannot be resolved, without blocking or crashing", () => {
		expect(searchRootBlockReason("bash", { command: 'cd "$SOME_DIR" && rg needle' }, REPO, POLICY)).toBeUndefined();
	});
});

describe("search root guard: bash, best-effort means giving up on real ambiguity", () => {
	// Each of these is a genuine, accepted limitation of a deliberately non-clever guard: a shell
	// variable, command substitution, pipeline, wrapper command, control-flow construct, or other
	// indirection that this guard does not try to resolve. It fails open rather than trying to be a
	// shell interpreter.
	it.each([
		`ROOT=${WORK}; rg needle "$ROOT"`,
		"rg needle ~someone-else",
		'rg needle "$(pwd)"',
		"rg needle `pwd`",
		"printf '/\\n' | xargs rg needle",
		"sudo rg needle /Users/example/",
		"if rg needle /; then echo found; fi",
		"nice -n 5 rg needle /", // wrapper commands (sudo/env/nice/timeout/...) aren't unwrapped
		"pushd ~; rg needle",
		"f() { cd /; }; f; rg needle",
		"source ./setup.sh; rg needle",
		"eval 'cd /; rg needle'",
		"CDPATH=/Users cd example; rg needle",
		'result="$(rg needle /)"',
	])("gives up rather than block: %s", (command) => {
		expect(searchRootBlockReason("bash", { command }, REPO, POLICY)).toBeUndefined();
	});

	it("still catches the common 'capture a search into a variable' pattern despite giving up on quoting", () => {
		expect(searchRootBlockReason("bash", { command: "result=$(rg needle /)" }, REPO, POLICY)).toMatch(
			/protected root/i,
		);
	});

	it("known imprecision: rg's -r/--replace value isn't tracked as a flag value, so it can look like a root", () => {
		// This is the one direction the imprecision runs the other way (over-cautious rather than
		// permissive). It is rare in practice (an agent's replacement text or file argument would
		// have to literally equal a protected path) and not worth reintroducing flag-value tracking.
		expect(searchRootBlockReason("bash", { command: "rg needle -r / ." }, REPO, POLICY)).toMatch(/protected root/i);
	});
});
