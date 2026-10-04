import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Each trap puzzle is a tiny repository (`repo/`) with a goal (`goal.md`), a hidden oracle (`oracle.test.mjs`, outside
 * the repository), the obvious fix (`wrong/`), and a correct fix (`right/`). The overlays hold only the files that
 * differ from `repo/`. The oracle reads the repository to judge from `TRAP_DIR`.
 */
const trapsRoot = fileURLToPath(new URL("../eval/traps/", import.meta.url));
const puzzles = existsSync(trapsRoot)
	? readdirSync(trapsRoot, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort()
	: [];

const scratch = mkdtempSync(join(tmpdir(), "branch-search-traps-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function assemble(puzzle: string, variant: "base" | "wrong" | "right"): string {
	const dir = join(scratch, `${puzzle}-${variant}`);
	cpSync(join(trapsRoot, puzzle, "repo"), dir, { recursive: true });
	if (variant !== "base") cpSync(join(trapsRoot, puzzle, variant), dir, { recursive: true });
	return dir;
}

function runNodeTest(cwd: string, args: string[], env: Record<string, string> = {}) {
	const started = Date.now();
	const result = spawnSync(process.execPath, ["--test", ...args], {
		cwd,
		env: { PATH: process.env.PATH ?? "", ...env },
		encoding: "utf8",
		timeout: 60_000,
	});
	return { passed: result.status === 0, ms: Date.now() - started, output: `${result.stdout}${result.stderr}` };
}

const visible = (dir: string) => runNodeTest(dir, []);
const oracle = (puzzle: string, dir: string) =>
	runNodeTest(dir, [join(trapsRoot, puzzle, "oracle.test.mjs")], { TRAP_DIR: dir });

describe("trap puzzles", () => {
	it("stages at least three puzzles", () => {
		expect(puzzles.length).toBeGreaterThanOrEqual(3);
	});

	for (const puzzle of puzzles) {
		describe(puzzle, () => {
			it("has a goal, an oracle, and both reference solutions", () => {
				for (const part of ["goal.md", "oracle.test.mjs", "repo/package.json", "wrong", "right"]) {
					expect(existsSync(join(trapsRoot, puzzle, part)), part).toBe(true);
				}
			});

			it("fails the oracle on the base", () => {
				const run = oracle(puzzle, assemble(puzzle, "base"));
				expect(run.passed, run.output).toBe(false);
				expect(run.ms).toBeLessThan(5000);
			}, 30_000);

			it("passes the visible tests and fails the oracle with the known-wrong solution", () => {
				const dir = assemble(puzzle, "wrong");
				const shown = visible(dir);
				expect(shown.passed, shown.output).toBe(true);
				const run = oracle(puzzle, dir);
				expect(run.passed, run.output).toBe(false);
				expect(run.ms).toBeLessThan(5000);
			}, 30_000);

			it("passes the visible tests and the oracle with the known-right solution", () => {
				const dir = assemble(puzzle, "right");
				const shown = visible(dir);
				expect(shown.passed, shown.output).toBe(true);
				const run = oracle(puzzle, dir);
				expect(run.passed, run.output).toBe(true);
				expect(run.ms).toBeLessThan(5000);
			}, 30_000);
		});
	}
});
