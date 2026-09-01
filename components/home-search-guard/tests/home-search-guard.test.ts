import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { installSearchRootGuard, searchRootBlockReason } from "../src/index.js";

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

describe("search root guard", () => {
	it.each([
		["grep", { pattern: "needle", path: "/" }],
		["grep", { pattern: "needle", path: HOME }],
		["grep", { pattern: "needle", path: "~" }],
		["find", { pattern: "*.ts", path: "$HOME/" }],
		["glob", { pattern: "**/*.ts", root: BRACED_HOME }],
		["glob", { pattern: "**/*", path: HOME }],
		["glob", { pattern: "**/*", root: REPO, path: WORK }],
		["grep", { pattern: "needle", path: CODE_PROJECTS }],
		["grep", { pattern: "needle", path: WORK, glob: "**/*" }],
		["find", { pattern: "release-candidate-*", path: "~/code_projects/work" }],
		["glob", { pattern: "**/*", root: `${BRACED_HOME}/code_projects/work` }],
		["glob", { pattern: "/**/*" }],
		["glob", { pattern: "../../../**/*" }],
		["grep", { pattern: "needle", path: `${HOME}/..` }],
		["grep", { pattern: "needle", path: "file:///" }],
	])("blocks %s when its search root is protected", (toolName, input) => {
		expect(searchRootBlockReason(toolName, input, REPO, POLICY)).toMatch(/protected root/i);
	});

	it.each([`{${HOME},${REPO}}/**/*`, `@(src/**|${HOME}/**)`])(
		"blocks alternative-expanded glob roots that cannot be verified independently: %s",
		(pattern) => {
			expect(searchRootBlockReason("glob", { pattern }, REPO, POLICY)).toMatch(/cannot verify/i);
		},
	);

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

	it.each([
		"rg needle /",
		"rg needle ~",
		"grep -r needle $HOME",
		`find "${BRACED_HOME}" -name '*.ts'`,
		"find ~/code_projects/work -name '*.ts'",
		"rg 'needle|other' ~/code_projects/work",
		"fd needle ~/code_projects/work",
		"rg --files ~/code_projects/work",
		"grep -e needle ~/code_projects/work",
		"fd --base-directory=~/code_projects/work needle",
		"cd ~/code_projects/work && rg needle",
		"sudo rg needle /Users/example/",
		"if rg needle /; then echo found; fi",
		"! rg needle /",
		"nice -n 5 rg needle /",
		"{ rg needle /; }",
		'result="$(rg needle /)"',
		"find -E / -regex '.*'",
		"find -X / -name '*.ts'",
		"find -s / -name '*.ts'",
		"find -x / -name '*.ts'",
		"find -f / -name '*.ts'",
		"cd / || true && rg needle",
	])("blocks bash searches rooted at a protected directory: %s", (command) => {
		expect(searchRootBlockReason("bash", { command }, REPO, POLICY)).toMatch(/protected root/i);
	});

	it.each([HOME, WORK])("blocks an implicit bash search root at %s", (cwd) => {
		for (const command of ["rg needle", "grep -r needle .", "find . -name '*.ts'", "fd needle .", "git grep needle"]) {
			expect(searchRootBlockReason("bash", { command }, cwd, POLICY)).toMatch(/protected root/i);
		}
	});

	it.each([
		`ROOT=${WORK}; rg needle "$ROOT"`,
		`find ${WORK}* -name '*.ts'`,
		`find ${CODE_PROJECTS}/{work} -name '*.ts'`,
		"rg needle ~someone-else",
		'rg needle "$(pwd)"',
		"rg needle `pwd`",
		"printf '/\\n' | xargs rg needle",
		`printf 'needle\\n' | xargs -I{} rg '{}' ${REPO}`,
		'cd "$ROOT" && rg needle',
		`cd ~; (cd ${REPO}); rg needle`,
	])("blocks a bash search when its root cannot be verified: %s", (command) => {
		expect(searchRootBlockReason("bash", { command }, REPO, POLICY)).toMatch(
			/(cannot.*(?:verif|resolv)|protected root)/i,
		);
	});

	it.each([
		["grep -r needle /", REPO],
		["rg needle 2>/dev/null", WORK],
		["echo $(cd -- $HOME; rg needle)", REPO],
		["env -C / rg needle", REPO],
		["f(){ rg needle /; }; f", REPO],
		["< /dev/null rg needle /", REPO],
		["pushd ~; rg needle", REPO],
		['"cd" "$HOME"; rg needle', REPO],
		['git -C "$HOME" grep needle', REPO],
		["find . -exec rg needle / {} \\;", REPO],
		["fd pattern --exec rg .", WORK],
		["rg pattern --ignore-file foo", WORK],
		["grep pattern --exclude-from foo", WORK],
		["timeout 5 rg needle /", REPO],
		["stdbuf -oL grep needle /", REPO],
		["bash -c 'rg needle /'", REPO],
		['sh -c "rg needle /"', REPO],
		["find -D search / -name '*.ts'", REPO],
		["find -O 2 / -name '*.ts'", REPO],
		["rg needle /$HOME", REPO],
		["rg needle $" + "{HOME:-/}", REPO],
		["echo `pushd ~; rg needle`", REPO],
		["echo <(rg needle /)", REPO],
		["env --split-string='rg needle /'", REPO],
		["env -S'rg needle /'", REPO],
		["bash -c='rg needle /'", REPO],
		["grep needle --color /", REPO],
		["find . -exec sh -c 'rg needle /' \\;", REPO],
		["builtin cd /; rg needle", REPO],
		["eval 'cd /; rg needle'", REPO],
		['echo ok || cd /tmp && echo "$(rg needle)"', WORK],
		[`rg needle "${HOME}/.."`, REPO],
		["find . -ok sh -c 'rg needle /' \\;", REPO],
		["find . -name '*.ts' -exec sh -c 'rg needle /' \\;", REPO],
		["f() { cd /; }; f; rg needle", REPO],
		["env -iS'rg needle /'", REPO],
		["sudo -D$HOME rg needle", REPO],
		["env -C$HOME rg needle", REPO],
		["env -iC$HOME rg needle", REPO],
		["source ./setup.sh; rg needle", REPO],
		[". ./setup.sh; rg needle", REPO],
		["printf 'cd /; rg needle' | xargs sh -c", REPO],
		["CMD='rg needle /'; $CMD", REPO],
		["search=rg; $search needle /", REPO],
		["case x in x) cd /;; esac; rg needle", REPO],
		["rg needle $HOME>/tmp/result", REPO],
		["rg needle />/tmp/result", REPO],
		["builtin eval 'cd /; rg needle'", REPO],
		["rg --pre 'rg needle /' pattern .", REPO],
		["shopt -s extglob; rg needle @(../../../../*)", REPO],
		["rg --follow needle .", REPO],
		["grep -R needle .", REPO],
		["find -L . -name '*.ts'", REPO],
		["fd --follow needle .", REPO],
		["x=rep; g$x -R needle /", REPO],
		["eval 'cd /'; rg needle", REPO],
		["CDPATH=/Users cd example; rg needle", REPO],
		["env -iS 'rg needle /'", REPO],
		['find /dev/fd/99/. -name "*.ts" 99<"$HOME"', REPO],
	])("blocks shell bypass or unverifiable root syntax: %s", (command, cwd) => {
		expect(searchRootBlockReason("bash", { command }, cwd, POLICY)).toBeDefined();
	});

	it.each([
		[`rg needle ${REPO}`, HOME],
		["rg needle code_projects/work/repos/apple-pi", HOME],
		["rg needle ~/code_projects/work/repos/apple-pi", REPO],
		["grep -r needle .", REPO],
		["find /tmp -name '*.ts'", REPO],
		["fd needle .", REPO],
		["fdfind needle .", REPO],
		["ripgrep needle .", REPO],
		["egrep needle .", REPO],
		["fgrep needle .", REPO],
		["git grep needle", REPO],
		["'rg' needle .", REPO],
		["cd repos/apple-pi && rg needle .", WORK],
		[`cd ~; rg needle ${REPO}`, REPO],
		[`nice -n 5 rg needle ${REPO}`, WORK],
		[`if rg needle ${REPO}; then echo found; fi`, WORK],
		["rg '/' .", REPO],
		["rg '$HOME' .", REPO],
		['rg "$ROOT" .', REPO],
		["gopls check $(find internal/runtime -name '*.go')", REPO],
		["/usr/bin/grep -r needle .", REPO],
		["echo rg $HOME", REPO],
		["sudo echo rg needle /", REPO],
		["rg needle -r / .", REPO],
		[`{ rg needle ${REPO}; }`, REPO],
		[`result="$(rg needle ${REPO})"`, REPO],
		[`find -E ${REPO} -regex '.*'`, REPO],
		[`cd ${REPO} || true && rg needle`, REPO],
		[`rg needle ${BRACED_HOME}/code_projects/work/repos/apple-pi`, REPO],
		["rg --version", WORK],
		["grep --help", WORK],
		["command -v rg", WORK],
		["echo cd; rg needle src", REPO],
		["rg needle . 2>/dev/null", REPO],
		["grep --color=never needle .", REPO],
		[`bash -c 'rg needle ${REPO}'`, REPO],
		[`env -S "rg needle ${REPO}"`, REPO],
		[`eval 'rg needle ${REPO}'`, REPO],
		[`echo <(rg needle ${REPO})`, REPO],
		["rg -c needle .", REPO],
		["grep -n needle src/*.ts", REPO],
		["find src -type f -exec wc -l {} +", REPO],
		["fd -tf needle src", REPO],
		["cd repos/apple-pi || exit 1; rg needle .", WORK],
		[`env -iS "rg needle ${REPO}"`, REPO],
	])("allows bash commands with a specific search root: %s", (command, cwd) => {
		expect(searchRootBlockReason("bash", { command }, cwd, POLICY)).toBeUndefined();
	});

	it("keeps a narrow search independent from a later cwd change", () => {
		const command =
			"cd worktrees/repo/apps/server && gopls check $(find internal/runtime -name '*.go') && cd ../../.. && git diff";
		expect(searchRootBlockReason("bash", { command }, WORK, POLICY)).toBeUndefined();
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
