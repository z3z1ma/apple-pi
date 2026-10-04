import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	checkScorerSpec,
	lastNumber,
	measureObjective,
	median,
	type ScorerSpec,
	scoreBranches,
	validateScorer,
} from "../src/scorer.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "apple-pi-branch-scorer-")));
	dirs.push(dir);
	return dir;
}

type Objective = ScorerSpec["objectives"][number];

function objective(run: string, overrides: Partial<Objective> = {}): Objective {
	return { id: "o", run, better: "lower", timeoutSec: 10, ...overrides };
}

function spec(overrides: Partial<ScorerSpec> = {}): ScorerSpec {
	return {
		version: 1,
		goal: "g",
		files: [],
		protect: [],
		gates: [{ id: "ok", run: "test ! -e broken", onBase: "fail", timeoutSec: 10 }],
		objectives: [],
		...overrides,
	};
}

describe("objective values", () => {
	it("reads one finite number from the last non-empty stdout line", () => {
		expect(lastNumber("warming up\n12.5\n\n")).toBe(12.5);
		expect(lastNumber("-3e2\n")).toBe(-300);
		expect(lastNumber("12.5 ms\n")).toBeUndefined();
		expect(lastNumber("Infinity\n")).toBeUndefined();
		expect(lastNumber("NaN\n")).toBeUndefined();
		expect(lastNumber("\n\n")).toBeUndefined();
		expect(lastNumber("4\ndone\n")).toBeUndefined();
	});

	it("takes the median, averaging the middle pair for an even count", () => {
		expect(median([5, 1, 3])).toBe(3);
		expect(median([4, 1, 3, 2])).toBe(2.5);
		expect(median([7])).toBe(7);
	});
});

describe("objective measurement", { timeout: 30_000 }, () => {
	it("runs an objective repeat times and keeps the median", async () => {
		const dir = tempDir();
		// Prints 5, then 1, then 3 on successive runs.
		const run =
			"n=$(cat count 2>/dev/null || echo 0); echo $((n + 1)) > count; echo noise; echo $(( (n * 4 + 5) % 6 ))";
		const result = await measureObjective(dir, objective(run, { repeat: 3 }), "bs-test");
		expect(result.values).toEqual([5, 3, 1]);
		expect(result.value).toBe(3);
		expect(result.failure).toBeUndefined();
	});

	it("fails an objective that exits non-zero, times out, or prints no finite number", async () => {
		const dir = tempDir();
		const exited = await measureObjective(dir, objective("echo 4; exit 3"), "bs-test");
		expect(exited.value).toBeUndefined();
		expect(exited.failure).toMatch(/exited with code 3/);

		const timedOut = await measureObjective(dir, objective("sleep 5; echo 1", { timeoutSec: 0.2 }), "bs-test");
		expect(timedOut.value).toBeUndefined();
		expect(timedOut.failure).toMatch(/timed out/);

		const notNumber = await measureObjective(dir, objective("echo fast"), "bs-test");
		expect(notNumber.value).toBeUndefined();
		expect(notNumber.failure).toMatch(/no finite number/);
	});

	it("stops repeating at the first failed run", async () => {
		const dir = tempDir();
		const run = "echo x >> runs; exit 1";
		const result = await measureObjective(dir, objective(run, { repeat: 3 }), "bs-test");
		expect(result.failure).toBeDefined();
		expect(readFileSync(join(dir, "runs"), "utf8")).toBe("x\n");
	});
});

describe("branch scoring", { timeout: 30_000 }, () => {
	function branches(count: number) {
		return Array.from({ length: count }, (_, i) => {
			const worktree = join(tempDir(), `r${i}`);
			mkdirSync(worktree);
			return { key: `r${i}`, worktree };
		});
	}

	it("runs serial objectives one branch at a time after every other scoring command has finished", async () => {
		const log = join(tempDir(), "log");
		const note = (what: string) => `echo "${what} $(basename "$PWD")" >> ${log}`;
		const scorer = spec({
			gates: [{ id: "ok", run: `${note("gate")}; sleep 0.1`, onBase: "fail", timeoutSec: 10 }],
			objectives: [
				objective(`${note("serial-start")}; sleep 0.2; ${note("serial-end")}; echo 2`, { id: "timed", serial: true }),
				objective(`${note("parallel")}; sleep 0.2; echo 1`, { id: "load" }),
			],
		});
		const diffSize = async (key: string) => {
			appendFileSync(log, `diff_size ${key}\n`);
			return 4;
		};
		const scored = await scoreBranches(branches(3), "unused", scorer, "bs-test", diffSize);

		const lines = readFileSync(log, "utf8").trim().split("\n");
		const firstSerial = lines.findIndex((line) => line.startsWith("serial"));
		const before = lines.slice(0, firstSerial);
		expect(before.every((line) => /^(gate|parallel|diff_size) /.test(line))).toBe(true);
		// Within each branch: gate, then the non-serial objective, then diff_size.
		for (const key of ["r0", "r1", "r2"])
			expect(before.filter((line) => line.endsWith(` ${key}`))).toEqual([
				`gate ${key}`,
				`parallel ${key}`,
				`diff_size ${key}`,
			]);
		expect(lines.slice(firstSerial)).toEqual([
			"serial-start r0",
			"serial-end r0",
			"serial-start r1",
			"serial-end r1",
			"serial-start r2",
			"serial-end r2",
		]);
		for (const key of ["r0", "r1", "r2"]) {
			const branch = scored.get(key);
			expect(branch?.survived).toBe(true);
			expect(branch?.diffSize).toBe(4);
			// Declared order, whatever the run order.
			expect(branch?.objectives.map(({ id, value }) => [id, value])).toEqual([
				["timed", 2],
				["load", 1],
			]);
		}
	});

	it("kills a branch whose objective fails, and runs no objective on a branch that failed a gate", async () => {
		const [failsGate, failsObjective, survives] = branches(3) as { key: string; worktree: string }[];
		writeFileSync(join(failsGate.worktree, "broken"), "");
		writeFileSync(join(failsObjective.worktree, "value"), "not a number\n");
		writeFileSync(join(survives.worktree, "value"), "7\n");
		const scorer = spec({
			objectives: [
				objective("echo ran >> ran; cat value", { id: "v" }),
				objective("echo ran >> ran; echo 1", { id: "last", serial: true }),
			],
		});
		const scored = await scoreBranches(
			[failsGate, failsObjective, survives],
			"unused",
			scorer,
			"bs-test",
			async () => 1,
		);

		expect(scored.get("r0")?.survived).toBe(false);
		expect(scored.get("r0")?.objectives).toEqual([]);
		expect(scored.get("r0")?.diffSize).toBe(1);
		expect(() => readFileSync(join(failsGate.worktree, "ran"))).toThrow();
		expect(scored.get("r1")?.survived).toBe(false);
		expect(scored.get("r1")?.objectives.map((o) => o.failure)).toEqual([expect.stringMatching(/no finite number/)]);
		expect(readFileSync(join(failsObjective.worktree, "ran"), "utf8")).toBe("ran\n");
		expect(scored.get("r2")?.survived).toBe(true);
		expect(scored.get("r2")?.objectives.map((o) => o.value)).toEqual([7, 1]);
	});
});

describe("scorer validation on the base", { timeout: 30_000 }, () => {
	const failGate = { id: "fixed", run: "test -e fixed", onBase: "fail" as const, timeoutSec: 10 };
	const passGate = { id: "builds", run: "true", onBase: "pass" as const, timeoutSec: 10 };

	it("accepts a spec whose gates match onBase twice and records each objective's median base value", async () => {
		const dir = tempDir();
		const scorer = spec({
			files: [{ path: "hidden/value.sh", content: "echo 41\necho 42\n" }],
			gates: [failGate, passGate],
			objectives: [objective("bash hidden/value.sh", { id: "v", repeat: 3 })],
		});
		const validation = await validateScorer(dir, "unused", scorer, "bs-test");
		expect(validation.ok).toBe(true);
		expect(validation.baseValues).toEqual({ v: 42 });
		expect(validation.report).toContain("objective v: base value 42");
	});

	it("rejects a gate declared onBase fail that passes on the base", async () => {
		const dir = tempDir();
		writeFileSync(join(dir, "fixed"), "");
		const validation = await validateScorer(dir, "unused", spec({ gates: [failGate] }), "bs-test");
		expect(validation.ok).toBe(false);
		expect(validation.report).toMatch(/gate fixed: declared onBase "fail" but passed on the base/);
	});

	it("rejects a gate declared onBase pass that fails on the base", async () => {
		const dir = tempDir();
		const gate = { ...passGate, run: "echo missing dependency >&2; exit 1" };
		const validation = await validateScorer(dir, "unused", spec({ gates: [failGate, gate] }), "bs-test");
		expect(validation.ok).toBe(false);
		expect(validation.report).toMatch(/gate builds: declared onBase "pass" but failed on the base/);
		expect(validation.report).toContain("missing dependency");
	});

	it("rejects a gate whose two base runs disagree", async () => {
		const dir = tempDir();
		const flaky = { ...failGate, run: "test -e seen && exit 0; touch seen; exit 1" };
		const validation = await validateScorer(dir, "unused", spec({ gates: [flaky] }), "bs-test");
		expect(validation.ok).toBe(false);
		expect(validation.report).toMatch(/gate fixed: the two base runs disagree \(fail, then pass\)/);
	});

	it("rejects an objective that prints no finite number or exits non-zero on the base", async () => {
		const dir = tempDir();
		const scorer = spec({
			gates: [failGate],
			objectives: [objective("echo fast", { id: "words" }), objective("exit 2", { id: "crash" })],
		});
		const validation = await validateScorer(dir, "unused", scorer, "bs-test");
		expect(validation.ok).toBe(false);
		expect(validation.report).toMatch(/objective words: printed no finite number/);
		expect(validation.report).toMatch(/objective crash: exited with code 2/);
		expect(validation.baseValues).toEqual({});
	});

	it("needs an objective when no gate fails on the base", async () => {
		const dir = tempDir();
		const validation = await validateScorer(dir, "unused", spec({ gates: [passGate] }), "bs-test");
		expect(validation.ok).toBe(false);
		expect(validation.report).toMatch(/no gate has onBase "fail", so the spec needs at least one objective/);

		const withObjective = spec({ gates: [passGate], objectives: [objective("echo 3", { id: "ms" })] });
		expect((await validateScorer(dir, "unused", withObjective, "bs-test")).ok).toBe(true);
	});

	it("rejects scorer files that cannot be installed on the base", async () => {
		const dir = tempDir();
		mkdirSync(join(dir, "src"));
		const scorer = spec({ gates: [failGate], files: [{ path: "src", content: "x" }] });
		const validation = await validateScorer(dir, "unused", scorer, "bs-test");
		expect(validation.ok).toBe(false);
		expect(validation.report).toMatch(/could not install the scorer/);
	});
});

describe("scorer spec schema", () => {
	it("rejects a repeat that is not a positive integer", () => {
		for (const repeat of [0, 1.5, -1])
			expect(checkScorerSpec(spec({ objectives: [objective("echo 1", { repeat })] }))).toEqual([
				'objective "o" repeat must be a positive integer',
			]);
		expect(checkScorerSpec(spec({ objectives: [objective("echo 1", { repeat: 2 })] }))).toEqual([]);
	});
});
