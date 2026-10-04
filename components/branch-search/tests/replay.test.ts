import { cpSync, mkdtempSync, rmSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import registerTasks from "../../tasks/src/index.js";
import type { SearchShape } from "../src/config.js";
import { runBranchSearch, type SearchOptions } from "../src/orchestrator.js";
import { type Enumeration, planStep, type Step } from "../src/plan.js";
import { readRecords, type SearchRecord, type StoredSearch, type TokenCost } from "../src/record.js";
import { formatTuning, parseGrid, rankRows, replay, type TuningRow, tune } from "../src/replay.js";
import type { ScorerSpec } from "../src/scorer.js";
import {
	type Behavior,
	candidateList,
	childEnumerator,
	FIX,
	finish,
	initFixtureRepo,
	scriptedModel,
	validConfig,
	WRONG,
	withOutput,
} from "./fixtures.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const dispose of cleanup.splice(0)) dispose();
});

const SEED = new Uint8Array(32).fill(7);

const ONE_GATE: ScorerSpec = {
	version: 1,
	goal: "value is 2",
	files: [{ path: "hidden/gate.sh", content: "bash check.sh\n" }],
	protect: ["check.sh"],
	gates: [{ id: "value", run: "bash hidden/gate.sh", onBase: "fail", timeoutSec: 30 }],
	objectives: [],
};

/** Run one real search on the fixture repository and read it back as replay reads it (a world). */
async function world(
	behaviors: Record<string, Behavior>,
	options: {
		config?: Record<string, unknown>;
		scorer?: ScorerSpec;
		enumerator?: () => Reply;
		other?: (context: Context) => Reply | undefined;
		review?: SearchOptions["review"];
	} = {},
): Promise<StoredSearch & { dir: string }> {
	const model = scriptedModel(behaviors, options.enumerator, [], options.other);
	const run = await fauxSession([registerTasks], (context) => model(context), ["read", "write", "edit", "ls", "bash"]);
	cleanup.push(run.dispose);
	const cwd = realpathSync(run.cwd);
	initFixtureRepo(cwd);
	await run.session.prompt("Make value equal 2.");
	const result = await runBranchSearch({
		mode: "human",
		session: run.session,
		cwd,
		config: { ...validConfig(), ...options.config },
		scorer: options.scorer ?? ONE_GATE,
		review: options.review,
		exclusive: async () => () => {},
		goal: "Make value equal 2.",
		signal: new AbortController().signal,
		onStatus: () => undefined,
		seed: SEED,
	});
	const dir = dirname(dirname(result.recordPath as string));
	const { records, unreadable } = readRecords(dir);
	expect(unreadable).toEqual([]);
	return { ...(records[0] as StoredSearch), dir };
}

function shapeOf(record: SearchRecord): SearchShape {
	return { branches: record.config.branches, generations: record.config.generations };
}

/** Replaying a record's own configuration reproduces its steps and outcome (A8). */
function expectReproduced(stored: StoredSearch) {
	const { record } = stored;
	const result = replay(stored, shapeOf(record));
	if (!result.evaluable) throw new Error(`unevaluable: ${result.reason}`);
	expect(result.steps).toEqual(record.steps.map(({ step }) => step));
	expect(result.solved).toBe(record.outcome !== "no survivor");
	expect(result.winner).toBe(record.winner);
	return result;
}

describe("replay of a record's own configuration (A8)", { timeout: 60_000 }, () => {
	it("reproduces a generation-0 survivor's steps, winner, and outcome", async () => {
		const stored = await world({ c1: [WRONG, finish("done", "three")], c2: [FIX, finish("done", "two")] });
		const { record } = stored;
		expect(record.outcome).toBe("ready");

		const result = expectReproduced(stored);
		const winner = record.branches.find((branch) => branch.key === record.winner);
		expect(result.winnerObjectives).toEqual(winner?.objectives);
		// Selection reads the frozen spec.json beside the record; the record keeps no copy of it.
		expect(stored.spec?.gates).toEqual(ONE_GATE.gates);
		expect(record.spec).not.toHaveProperty("selection");
	});

	it("reports a world whose spec.json is missing or does not match the record's hash as unreadable", async () => {
		const stored = await world({ c1: [WRONG, finish("done", "three")], c2: [FIX, finish("done", "two")] });
		const dir = mkdtempSync(join(tmpdir(), "apple-pi-replay-"));
		cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
		const id = stored.record.id;
		for (const copy of ["bs-missing", "bs-changed", "bs-intact", "bs-empty"])
			cpSync(join(stored.dir, id), join(dir, copy), { recursive: true });
		rmSync(join(dir, "bs-missing", "spec.json"));
		// An empty root enumeration would leave replay planning the same empty generation forever.
		const empty = structuredClone(stored.record);
		(empty.enumerations[0] as SearchRecord["enumerations"][0]).candidates = [];
		writeFileSync(join(dir, "bs-empty", "record.json"), JSON.stringify(empty));
		expect(replay({ record: empty, spec: stored.spec }, shapeOf(empty))).toEqual({
			evaluable: false,
			reason: "the record has no root candidates",
		});
		writeFileSync(join(dir, "bs-changed", "spec.json"), JSON.stringify({ ...ONE_GATE, objectives: [] }));

		const { records, unreadable } = readRecords(dir);

		expect(records.map((entry) => entry.record.id)).toEqual([id]);
		expect(unreadable).toEqual([
			expect.stringMatching(new RegExp(`^${join(dir, "bs-changed", "record.json")}: .*spec\\.json.*hash`)),
			`${join(dir, "bs-empty", "record.json")}: enumerations are malformed`,
			expect.stringMatching(new RegExp(`^${join(dir, "bs-missing", "record.json")}: .*spec\\.json`)),
		]);
	});

	it("reproduces a later-generation winner: the dead parent's enumeration and its child", async () => {
		const stored = await laterWorld([FIX, finish("done", "two works")]);
		const { record } = stored;
		expect(record.outcome).toBe("ready");
		expect(record.branches.find((branch) => branch.key === record.winner)?.generation).toBe(1);

		expectReproduced(stored);
	});

	it("reproduces a no-survivor search that stopped at maxDepth", async () => {
		const stored = await laterWorld([WRONG, finish("done", "still three")]);
		const { record } = stored;
		expect(record.outcome).toBe("no survivor");
		expect(record.steps.at(-1)?.step).toEqual({ kind: "stop", outcome: "no survivor" });

		expectReproduced(stored);
	});

	it("reproduces a no-survivor search whose survivors failed to beat the first objective's base value", async () => {
		const stored = await world(
			{ c1: [FIX, finish("done", "zero")], c2: [FIX, finish("done", "zero")] },
			{
				scorer: {
					...ONE_GATE,
					gates: [{ id: "runs", run: "true", onBase: "pass", timeoutSec: 30 }],
					objectives: [{ id: "score", run: "echo 0", better: "higher", timeoutSec: 30 }],
				},
			},
		);
		const { record } = stored;
		expect(record.outcome).toBe("no survivor");
		expect(record.steps.at(-1)?.step).toEqual({ kind: "stop", outcome: "survivor" });

		expectReproduced(stored);
	});
});

describe("replay of another configuration", { timeout: 60_000 }, () => {
	it("evaluates a smaller configuration on a larger world from the nodes it used, and a larger one is unevaluable", async () => {
		const stored = await laterWorld([WRONG, finish("done", "still three")]);
		const { record } = stored;
		const smaller: SearchShape = {
			branches: { perGeneration: 1, maxTotal: 6 },
			generations: { maxDepth: 1, rootsPerGeneration: 0, parentsPerGeneration: 1, childrenPerParent: 1 },
		};
		const result = replay(stored, smaller);
		if (!result.evaluable) throw new Error(result.reason);
		expect(result.steps).toEqual([
			{ kind: "run", batch: [expect.objectContaining({ key: "r0" })] },
			{ kind: "enumerate", parents: ["r0"] },
			{ kind: "run", batch: [expect.objectContaining({ key: "r0.c0", parent: "r0" })] },
			{ kind: "stop", outcome: "no survivor" },
		]);
		expect(result.solved).toBe(false);

		// Tokens: the world's search-level cost plus the enumerations and nodes this configuration used.
		const tokens = (cost: TokenCost | null | undefined) =>
			cost ? cost.inputTokens + cost.cacheReadTokens + cost.cacheWriteTokens + cost.outputTokens : 0;
		const enumeration = (key: string) => record.enumerations.find((e) => e.key === key)?.cost;
		const node = (key: string) =>
			record.branches.find((b) => b.key === key)?.cost as SearchRecord["branches"][0]["cost"];
		const used = tokens(enumeration("root")) + tokens(enumeration("r0")) + tokens(node("r0")) + tokens(node("r0.c0"));
		expect(used).toBeGreaterThan(0);
		expect(result.tokens).toBe(tokens(record.cost.author) + used);
		// Wall-clock: per generation the longest run plus scoring, summed.
		const ms = (key: string) => node(key).runMs + node(key).scoreMs;
		expect(result.wallClockMs).toBe(ms("r0") + ms("r0.c0"));

		expect(
			replay(stored, { ...LATER_SHAPE, generations: { ...LATER_SHAPE.generations, childrenPerParent: 2 } }),
		).toEqual({ evaluable: false, reason: "no node r0.c1" });
		// Keyed draws: r2 ran as a generation-1 root, and its outcome serves a generation-0 r2 as well.
		expect(replay(stored, { ...LATER_SHAPE, branches: { perGeneration: 3, maxTotal: 6 } }).evaluable).toBe(true);
		expect(replay(stored, { ...LATER_SHAPE, generations: { ...LATER_SHAPE.generations, maxDepth: 2 } })).toEqual({
			evaluable: false,
			reason: expect.stringMatching(/^no enumeration of /),
		});
	});
});

describe("search-level cost", { timeout: 60_000 }, () => {
	it("counts the scorer review's tokens in the record and in every replay's fixed cost", async () => {
		const usage = { input: 120, output: 30, cacheRead: 7, cacheWrite: 3 };
		const stored = await world(
			{ c1: [WRONG, finish("done", "three")], c2: [FIX, finish("done", "two")] },
			{
				config: { scorer: { validationRetries: 1, reviewProfile: "deep" } },
				review: async () => ({ text: '{"verdict":"confirm"}', usage }),
			},
		);
		const { record } = stored;
		expect(record.cost.review).toEqual(
			expect.objectContaining({ inputTokens: 120, outputTokens: 30, cacheReadTokens: 7, cacheWriteTokens: 3 }),
		);
		expect(record.cost.total.inputTokens).toBeGreaterThanOrEqual(120);

		const tokens = (cost: TokenCost) =>
			cost.inputTokens + cost.cacheReadTokens + cost.cacheWriteTokens + cost.outputTokens;
		const used = [...record.enumerations.map((e) => e.cost), ...record.branches.map((b) => b.cost)];
		const result = replay(stored, shapeOf(record));
		if (!result.evaluable) throw new Error(result.reason);
		expect(result.tokens).toBe(160 + used.reduce((total, cost) => total + tokens(cost), 0));
	});
});

describe("draw mode", { timeout: 60_000 }, () => {
	it("replays a draw: model record under draw: model, whatever the configuration", async () => {
		const three = [WRONG, finish("done", "three")];
		const stored = await world(
			{ c1: three, c2: [FIX, finish("done", "two")], c3: three },
			{ config: { draw: "model" }, enumerator: () => candidateList(["c1", "c2", "c3"], "c2") },
		);
		const { record } = stored;
		const modelOrder = ["c2", "c1"];
		const randomOrder = planStep(
			{ enumerations: { root: record.enumerations[0] as Enumeration }, nodes: [], constraints: ["none"] },
			shapeOf(record),
			"random",
			SEED,
		);
		const candidates = (step: Step | undefined) => (step?.kind === "run" ? step.batch.map((e) => e.candidate) : []);
		// The two draw modes would run different roots on this world.
		expect(candidates(randomOrder)).not.toEqual(modelOrder);

		const own = expectReproduced(stored);
		expect(candidates(own.steps[0])).toEqual(modelOrder);
		const narrower = replay(stored, { ...shapeOf(record), branches: { perGeneration: 1, maxTotal: 6 } });
		if (!narrower.evaluable) throw new Error(narrower.reason);
		expect(candidates(narrower.steps[0])).toEqual(["c2"]);
		expect(narrower.solved).toBe(true);

		// A record whose draws no longer give its nodes' approach or constraint serves no outcome.
		const edited = structuredClone(stored);
		edited.record.config.constraints = ["Something else."];
		expect(replay(edited, shapeOf(edited.record))).toEqual({
			evaluable: false,
			reason: expect.stringMatching(/^node r\d ran a different draw$/),
		});
	});
});

const LATER_SHAPE = {
	branches: { perGeneration: 2, maxTotal: 6 },
	generations: { maxDepth: 1, rootsPerGeneration: 1, parentsPerGeneration: 2, childrenPerParent: 1 },
};

/**
 * Three roots that all fail, then generation 1: the unused root r2 and one child of each of the two
 * dead roots, which run `child` whichever approach they draw.
 */
function laterWorld(child: Behavior, config: Record<string, unknown> = {}) {
	const three = [withOutput(WRONG, 11), finish("done", "three")];
	const children = childEnumerator(["k1", "k2"]);
	return world(
		{ c1: three, c2: three, c3: three, k1: child, k2: child },
		{
			config: { ...LATER_SHAPE, ...config },
			enumerator: () => withOutput(candidateList(["c1", "c2", "c3"]), 5),
			other: (context) => {
				const reply = children(context);
				return reply && withOutput(reply, 3);
			},
		},
	);
}

const CURRENT: SearchShape = {
	branches: { perGeneration: 2, maxTotal: 6 },
	generations: { maxDepth: 0, rootsPerGeneration: 0, parentsPerGeneration: 1, childrenPerParent: 1 },
};

describe("grid", () => {
	it("crosses the value lists with the current configuration first, once", () => {
		const grid = parseGrid({ "branches.perGeneration": [1, 2], "generations.maxDepth": [0, 1] }, CURRENT);
		if (!grid.ok) throw new Error(grid.problems.join("\n"));
		expect(grid.configurations.map(({ label, current }) => ({ label, current }))).toEqual([
			{ label: "current", current: true },
			{ label: "branches.perGeneration=1", current: false },
			{ label: "branches.perGeneration=1 generations.maxDepth=1", current: false },
			{ label: "generations.maxDepth=1", current: false },
		]);
		expect(grid.configurations[2]?.shape).toEqual({
			branches: { perGeneration: 1, maxTotal: 6 },
			generations: { ...CURRENT.generations, maxDepth: 1 },
		});
	});

	it("includes the current configuration even when no list holds its value", () => {
		const grid = parseGrid({ "generations.childrenPerParent": [3] }, CURRENT);
		if (!grid.ok) throw new Error(grid.problems.join("\n"));
		expect(grid.configurations.map(({ label }) => label)).toEqual(["current", "generations.childrenPerParent=3"]);
	});

	it("names unknown keys and invalid values", () => {
		expect(parseGrid([1], CURRENT)).toEqual({ ok: false, problems: [expect.stringContaining("JSON object")] });
		const grid = parseGrid(
			{
				draw: ["model"],
				"enumerate.count": [3],
				"branches.maxTotal": 4,
				"generations.parentsPerGeneration": [],
				"generations.maxDepth": [1, -1, 1.5],
			},
			CURRENT,
		);
		expect(grid).toEqual({
			ok: false,
			problems: [
				expect.stringMatching(/^draw: not a tunable key/),
				expect.stringMatching(/^enumerate\.count: not a tunable key/),
				"branches.maxTotal: must be a non-empty list of values",
				"generations.parentsPerGeneration: must be a non-empty list of values",
				"generations.maxDepth: -1 must be an integer ≥ 0",
				"generations.maxDepth: 1.5 must be an integer ≥ 0",
			],
		});
	});
});

function row(label: string, solved: number, tokens: number, wallClockMs: number, current = false): TuningRow {
	return {
		configuration: { label, shape: CURRENT, current },
		unevaluable: [],
		solved,
		tokens,
		wallClockMs,
	};
}

describe("ranking", () => {
	it("ranks by solved count, then tokens, then wall-clock, and the current configuration wins ties", () => {
		const ranked = rankRows([
			row("a", 2, 100, 10),
			row("current", 3, 500, 50, true),
			row("b", 3, 400, 90),
			row("c", 3, 500, 40),
			row("d", 3, 500, 50),
			row("e", 3, 500, 50),
		]);
		expect(ranked.map((entry) => entry.configuration.label)).toEqual(["b", "c", "current", "d", "e", "a"]);
	});
});

describe("tuning over stored records", { timeout: 60_000 }, () => {
	it("reports unevaluable worlds per configuration and compares on the worlds every configuration can replay", async () => {
		const three = [WRONG, finish("done", "three")];
		const ready = await world({ c1: [FIX, finish("done", "two")], c2: [FIX, finish("done", "two")], c3: three });
		const dead = await laterWorld([WRONG, finish("done", "still three")]);
		const aborted = {
			record: { ...structuredClone(dead.record), id: "bs-aborted", outcome: "aborted: cancelled" },
			spec: null,
		};
		const grid = parseGrid({ "branches.perGeneration": [1, 3] }, CURRENT);
		if (!grid.ok) throw new Error(grid.problems.join("\n"));

		const tuning = tune([ready, dead, aborted], grid.configurations);

		expect(tuning.worlds).toEqual([ready.record.id, dead.record.id]);
		expect(tuning.compared).toEqual([dead.record.id]);
		const byLabel = new Map(tuning.rows.map((entry) => [entry.configuration.label, entry]));
		expect(byLabel.get("branches.perGeneration=3")?.unevaluable).toEqual([
			{ world: ready.record.id, reason: "no node r2" },
		]);
		expect(byLabel.get("current")?.unevaluable).toEqual([]);
		for (const entry of tuning.rows) {
			const result = replay(dead, entry.configuration.shape);
			if (!result.evaluable) throw new Error(result.reason);
			expect(entry).toEqual(
				expect.objectContaining({ solved: 0, tokens: result.tokens, wallClockMs: result.wallClockMs }),
			);
		}
		// Fewer roots cost fewer tokens on the compared world, and nothing solved it.
		expect(tuning.rows.map((entry) => entry.configuration.label)).toEqual([
			"branches.perGeneration=1",
			"current",
			"branches.perGeneration=3",
		]);

		const text = formatTuning(tuning, CURRENT, []);
		expect(text).toContain("3 records, 2 worlds");
		expect(text).toContain("Compared on 1 world where every configuration is evaluable.");
		expect(text).toMatch(/^1 +0\/1 +\d+ +\d+(\.\d)?s +branches\.perGeneration=1$/m);
		expect(text).toContain(`branches.perGeneration=3: ${ready.record.id} (no node r2)`);
	});
});
