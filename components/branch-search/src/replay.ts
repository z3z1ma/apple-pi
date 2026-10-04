import { checkShapeValue, type SearchShape, SHAPE_KEYS, type ShapeKey } from "./config.js";
import { constraintPool } from "./draw.js";
import { type NodeKey, type ObservedNode, type ObservedTree, planStep, type Step, selectWinner } from "./plan.js";
import { isWorld, type StoredSearch, type TokenCost } from "./record.js";

/**
 * Replay tuning (spec 18.1): evaluate a tree shape on a stored search record by reading each requested
 * node's recorded outcome instead of running the model or the scorer. It calls the same `planStep`
 * and `selectWinner` as the online search and reads nothing but the stored search it is given: the
 * record and its frozen scorer.
 */

export type ReplayResult =
	| {
			evaluable: true;
			steps: Step[];
			/** A survivor won selection. */
			solved: boolean;
			winner: NodeKey | null;
			winnerObjectives: Record<string, number> | null;
			/** The world's search-level cost (author and review) plus the enumerations and nodes this shape used. */
			tokens: number;
			/** Per generation, the longest `runMs + scoreMs`, summed. */
			wallClockMs: number;
	  }
	| { evaluable: false; reason: string };

function tokensOf(cost: TokenCost | null | undefined): number {
	if (!cost) return 0;
	return cost.inputTokens + cost.cacheReadTokens + cost.cacheWriteTokens + cost.outputTokens;
}

/** Replay `shape` on a world under the world's seed and draw mode (spec 18.1). */
export function replay({ record: world, spec }: StoredSearch, shape: SearchShape): ReplayResult {
	const seed = Uint8Array.from(Buffer.from(world.seed, "hex"));
	const draw = world.config.draw ?? "random";
	const recorded = new Map(world.enumerations.map((enumeration) => [enumeration.key, enumeration]));
	const branches = new Map(world.branches.map((branch) => [branch.key, branch]));
	const root = recorded.get("root");
	// An empty root list would plan the same empty generation 0 forever.
	if (!root || root.candidates.length === 0) return { evaluable: false, reason: "the record has no root candidates" };

	const tree: ObservedTree = {
		enumerations: { root },
		nodes: [],
		constraints: constraintPool(world.config.constraints),
	};
	const steps: Step[] = [];
	let tokens = tokensOf(world.cost.author) + tokensOf(world.cost.review) + tokensOf(root.cost);
	let wallClockMs = 0;
	for (let generation = 0; ; ) {
		const step = planStep(tree, shape, draw, seed);
		steps.push(step);
		if (step.kind === "stop") break;
		if (step.kind === "enumerate") {
			for (const key of step.parents) {
				const enumeration = recorded.get(key);
				if (!enumeration) return { evaluable: false, reason: `no enumeration of ${key}` };
				tree.enumerations[key] = enumeration;
				tokens += tokensOf(enumeration.cost);
			}
			continue;
		}
		let longest = 0;
		for (const entry of step.batch) {
			const branch = branches.get(entry.key);
			if (!branch || branch.status === undefined) return { evaluable: false, reason: `no node ${entry.key}` };
			// Keyed draws give a key the same approach and constraint under every shape (spec 6.5).
			if (
				branch.candidate !== entry.candidate ||
				branch.constraint !== entry.constraint ||
				branch.parent !== entry.parent
			)
				return { evaluable: false, reason: `node ${entry.key} ran a different draw` };
			tree.nodes.push({
				key: entry.key,
				parent: entry.parent,
				generation,
				status: branch.status,
				gatesPassed: branch.gatesPassed as number,
				diffSize: branch.objectives?.diff_size as number,
				objectives: branch.objectives ?? {},
			});
			tokens += tokensOf(branch.cost);
			longest = Math.max(longest, branch.cost.runMs + branch.cost.scoreMs);
		}
		wallClockMs += longest;
		generation++;
	}

	const last = steps.at(-1) as Extract<Step, { kind: "stop" }>;
	let winner: ObservedNode | undefined;
	if (last.outcome === "survivor") {
		if (!spec) return { evaluable: false, reason: "no frozen scorer" };
		winner = selectWinner(tree.nodes, { ...spec, baseValues: world.spec?.baseValues ?? {} });
	}
	return {
		evaluable: true,
		steps,
		solved: winner !== undefined,
		winner: winner?.key ?? null,
		winnerObjectives: winner?.objectives ?? null,
		tokens,
		wallClockMs,
	};
}

/** One tree shape of a tuning grid; `label` names the keys it changes from the current configuration. */
export interface Configuration {
	label: string;
	shape: SearchShape;
	current: boolean;
}

function shapeValue(shape: SearchShape, key: ShapeKey): number {
	const [group, name] = key.split(".") as [keyof SearchShape, string];
	return (shape[group] as Record<string, number>)[name] as number;
}

function withValue(shape: SearchShape, key: ShapeKey, value: number): SearchShape {
	const [group, name] = key.split(".") as [keyof SearchShape, string];
	return { ...shape, [group]: { ...shape[group], [name]: value } };
}

/**
 * The configurations of a grid file: every combination of the listed values, each unlisted key at its
 * current value, with the current configuration first and once (spec 18.1). An unknown key or an
 * invalid value makes the whole grid unusable.
 */
export function parseGrid(
	raw: unknown,
	current: SearchShape,
): { ok: true; configurations: Configuration[] } | { ok: false; problems: string[] } {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw))
		return { ok: false, problems: ["The grid must be a JSON object that maps tunable keys to lists of values."] };
	const tunable = Object.keys(SHAPE_KEYS) as ShapeKey[];
	const problems: string[] = [];
	const lists: [ShapeKey, number[]][] = [];
	for (const [key, values] of Object.entries(raw)) {
		if (!tunable.includes(key as ShapeKey)) {
			problems.push(`${key}: not a tunable key (tunable: ${tunable.join(", ")})`);
			continue;
		}
		if (!Array.isArray(values) || values.length === 0) {
			problems.push(`${key}: must be a non-empty list of values`);
			continue;
		}
		for (const value of values) {
			const problem = checkShapeValue(key as ShapeKey, value);
			if (problem) problems.push(`${key}: ${JSON.stringify(value)} ${problem}`);
		}
		lists.push([key as ShapeKey, [...new Set(values as number[])]]);
	}
	if (problems.length > 0) return { ok: false, problems };

	lists.sort(([a], [b]) => tunable.indexOf(a) - tunable.indexOf(b));
	let shapes = [current];
	for (const [key, values] of lists) shapes = shapes.flatMap((shape) => values.map((v) => withValue(shape, key, v)));
	const label = (shape: SearchShape) =>
		tunable
			.filter((key) => shapeValue(shape, key) !== shapeValue(current, key))
			.map((key) => `${key}=${shapeValue(shape, key)}`)
			.join(" ");
	const others = shapes.filter((shape) => label(shape) !== "");
	return {
		ok: true,
		configurations: [
			{ label: "current", shape: current, current: true },
			...others.map((shape) => ({ label: label(shape), shape, current: false })),
		],
	};
}

/** A configuration's tuning result: totals over the worlds every configuration can replay. */
export interface TuningRow {
	configuration: Configuration;
	unevaluable: { world: string; reason: string }[];
	solved: number;
	tokens: number;
	wallClockMs: number;
}

export interface Tuning {
	/** Records read, worlds or not. */
	records: number;
	/** IDs of the records that are worlds. */
	worlds: string[];
	/** IDs of the worlds on which every configuration is evaluable. */
	compared: string[];
	/** In rank order. */
	rows: TuningRow[];
}

/**
 * Solved count (more first), then tokens, then wall-clock (lower first). The current configuration wins
 * ties, so tuning never adopts a configuration that replays worse; other ties keep grid order.
 */
export function rankRows(rows: readonly TuningRow[]): TuningRow[] {
	return [...rows].sort(
		(a, b) =>
			b.solved - a.solved ||
			a.tokens - b.tokens ||
			a.wallClockMs - b.wallClockMs ||
			Number(b.configuration.current) - Number(a.configuration.current),
	);
}

/** Replay every configuration on every world among `records` (spec 18.1 tuning steps 2 and 3). */
export function tune(records: readonly StoredSearch[], configurations: readonly Configuration[]): Tuning {
	const worlds = records.filter(({ record }) => isWorld(record));
	const results = configurations.map((configuration) => worlds.map((world) => replay(world, configuration.shape)));
	const compared = worlds.filter((_, w) => results.every((perWorld) => perWorld[w]?.evaluable));
	const rows = configurations.map((configuration, c) => {
		const perWorld = results[c] as ReplayResult[];
		const row: TuningRow = { configuration, unevaluable: [], solved: 0, tokens: 0, wallClockMs: 0 };
		perWorld.forEach((result, w) => {
			if (!result.evaluable)
				row.unevaluable.push({ world: (worlds[w] as StoredSearch).record.id, reason: result.reason });
			else if (compared.includes(worlds[w] as StoredSearch)) {
				row.solved += Number(result.solved);
				row.tokens += result.tokens;
				row.wallClockMs += result.wallClockMs;
			}
		});
		return row;
	});
	return {
		records: records.length,
		worlds: worlds.map((world) => world.record.id),
		compared: compared.map((world) => world.record.id),
		rows: rankRows(rows),
	};
}

function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The tuning table (spec 18.1). `unreadable` names records that could not be read. */
export function formatTuning(tuning: Tuning, current: SearchShape, unreadable: readonly string[]): string {
	const tunable = Object.keys(SHAPE_KEYS) as ShapeKey[];
	const lines = [
		`Replay tuning over ${plural(tuning.records, "record")}, ${plural(tuning.worlds.length, "world")}.`,
		`Current: ${tunable.map((key) => `${key}=${shapeValue(current, key)}`).join(" ")}`,
	];
	for (const problem of unreadable) lines.push(`Unreadable: ${problem}`);
	lines.push(`Compared on ${plural(tuning.compared.length, "world")} where every configuration is evaluable.`);
	const table = [
		["Rank", "Solved", "Tokens", "Wall-clock", "Configuration"],
		...tuning.rows.map((row, i) => [
			String(i + 1),
			`${row.solved}/${tuning.compared.length}`,
			String(row.tokens),
			`${(row.wallClockMs / 1000).toFixed(1)}s`,
			row.configuration.label,
		]),
	];
	const widths = (table[0] as string[]).map((_, c) => Math.max(...table.map((cells) => (cells[c] as string).length)));
	for (const cells of table)
		lines.push(
			cells
				.map((cell, c) => cell.padEnd(widths[c] as number))
				.join("  ")
				.trimEnd(),
		);
	const unevaluable = tuning.rows.filter((row) => row.unevaluable.length > 0);
	lines.push(unevaluable.length === 0 ? "Unevaluable: none." : "Unevaluable:");
	for (const row of unevaluable)
		lines.push(
			`  ${row.configuration.label}: ${row.unevaluable.map(({ world, reason }) => `${world} (${reason})`).join(", ")}`,
		);
	return lines.join("\n");
}
