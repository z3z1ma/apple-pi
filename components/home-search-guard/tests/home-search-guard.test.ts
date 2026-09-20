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
		for (const command of [
			"rg needle",
			"grep -r needle .",
			"find . -name '*.ts'",
			"find -name '*.ts'",
			"fd needle .",
			"fdfind needle .",
		]) {
			expect(searchRootBlockReason("bash", { command }, cwd, POLICY)).toMatch(/protected root/i);
		}
	});

	it.each([
		`find ${HOME}/.bun/install/global/node_modules -path '*/@aws-sdk/credential-provider-node/package.json' -o -path '*/@aws-sdk/client-sts/package.json' -o -path '*/@aws-sdk/client-bedrock-runtime/package.json' | head -30`,
		`find ${HOME}/.bun/install/global/node_modules/@earendil-works -path '*/@aws-sdk/credential-provider-node/package.json' -o -path '*/@aws-sdk/client-sts/package.json' -o -path '*/@aws-sdk/client-bedrock-runtime/package.json' | head -30`,
		`find /tmp -path ${WORK} -o -name package.json`,
		"find -E /tmp -regex '.*'",
		"find -EXdsx /tmp -name '*.ts'",
		"find -- /tmp -name '*.ts'",
	])("allows find expression operands that name or normalize to a protected root: %s", (command) => {
		expect(searchRootBlockReason("bash", { command }, WORK, POLICY)).toBeUndefined();
	});

	it.each([
		String.raw`rg -n --hidden --glob '*.{ts,js,json,mjs,cjs}' 'oneOf|anyOf|allOf|Type\.Union|Type\.Intersect|Schema\.Union|prompt.*command|command.*prompt' ~/.pi/agent | head -250`,
		String.raw`find ~/.pi/agent -maxdepth 3 -type f \( -name '*.ts' -o -name '*.js' -o -name '*.json' \) -print | sort | head -250`,
	])("allows a search over a specific home subdirectory with expression options: %s", (command) => {
		expect(searchRootBlockReason("bash", { command }, WORK, POLICY)).toBeUndefined();
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

	it.each(["rg needle -r / .", "rg needle --replace / ."])(
		"allows an rg replacement value that resembles a protected root: %s",
		(command) => {
			expect(searchRootBlockReason("bash", { command }, REPO, POLICY)).toBeUndefined();
		},
	);
});

describe("search root guard: bash, pipeline and standard input handling", () => {
	it.each([
		"git status | grep modified",
		"git status | rg modified",
		"cat file.txt | grep -i needle",
		"cat file.txt | rg -i needle",
		"ps aux | grep node",
		"echo 'hello' | ripgrep hello",
		"echo 'hello' | egrep hello",
		"echo 'hello' | fgrep hello",
		"git log --oneline | grep fix | rg -v test",
		"git status 2>&1 | grep modified",
		"git status |& grep modified",
		["git status |", "  grep modified"].join("\n"),
		"cd ~ && git status | grep modified",
		"git status | grep needle -",
		"git status | rg needle -",
		"grep needle -",
		'echo "hello | world" | grep hello',
	])("allows stdin search commands piped without filesystem root arguments in protected cwd: %s", (command) => {
		expect(searchRootBlockReason("bash", { command }, HOME, POLICY)).toBeUndefined();
	});

	it.each([
		"echo 'test' | fd needle",
		"echo 'test' | fdfind needle",
		"echo 'test' | find . -name '*.ts'",
		"cat file.txt | grep needle /",
		"cat file.txt | rg needle ~",
		"cat file.txt | grep needle ~/code_projects/work",
		"echo 'hello' | grep needle - /",
		"git status | grep modified && rg needle",
		"git status | grep modified || rg needle",
		"git status | grep modified ; rg needle",
		["git status | grep modified", "rg needle"].join("\n"),
		"cd ~ && git status | grep modified && rg needle",
	])("still blocks searches that touch protected filesystem roots despite pipes: %s", (command) => {
		expect(searchRootBlockReason("bash", { command }, HOME, POLICY)).toMatch(/protected root/i);
	});
});
