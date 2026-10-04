import { readFileSync } from "node:fs";
import { type BranchSearchConfig, configProblems, validateBranchSearchConfig } from "../src/config.js";
import type { TaskOverride } from "./tasks.js";

/**
 * The operator's evaluation configuration. It carries no built-in values: a missing file or key stops
 * the evaluation with the list of what to fix.
 *
 * ```json
 * {
 *   "model": "coding",
 *   "tasks": ["202610031016-subagent-outcome-framing"],
 *   "oracle": { "timeoutSec": 900 },
 *   "overrides": { "<task id>": { "base": "<commit>", "final": "<commit>", "tests": ["path/to/a.test.ts"] } },
 *   "search": { ...every required key of branch-search.json... }
 * }
 * ```
 */
export interface EvalConfig {
	/** The model profile every arm runs on (`model-profiles.json`). */
	model: string;
	/** Closed ledger task ids to evaluate. */
	tasks: string[];
	/** Per oracle test run, in extraction and in scoring. */
	oracle: { timeoutSec: number };
	/** Optional explicit boundaries per task id, used instead of the commits its bundle cites. */
	overrides?: Record<string, TaskOverride>;
	/** The search configuration of arms B and C; each arm sets `draw` itself. */
	search: BranchSearchConfig;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export function loadEvalConfig(path: string): { ok: true; config: EvalConfig } | { ok: false; text: string } {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		return {
			ok: false,
			text: `Cannot read the evaluation configuration ${path}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	const value = isRecord(raw) ? raw : {};
	const problems: string[] = [];
	if (value.model === undefined) problems.push("model: missing");
	else if (typeof value.model !== "string" || value.model === "") problems.push("model: must be a model profile name");
	if (
		!Array.isArray(value.tasks) ||
		value.tasks.length === 0 ||
		!value.tasks.every((id) => typeof id === "string" && id !== "")
	)
		problems.push("tasks: must list at least one closed task id");
	const timeout = isRecord(value.oracle) ? value.oracle.timeoutSec : undefined;
	if (timeout === undefined) problems.push("oracle.timeoutSec: missing");
	else if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0)
		problems.push("oracle.timeoutSec: must be a positive number");
	if (value.overrides !== undefined) {
		if (!isRecord(value.overrides)) problems.push("overrides: must map task ids to overrides");
		else
			for (const [id, override] of Object.entries(value.overrides)) {
				const valid =
					isRecord(override) &&
					typeof override.base === "string" &&
					typeof override.final === "string" &&
					(override.tests === undefined ||
						(Array.isArray(override.tests) && override.tests.every((path) => typeof path === "string")));
				if (!valid)
					problems.push(`overrides.${id}: needs a base and a final commit, and tests must be a list of paths`);
			}
	}
	if (value.search === undefined) problems.push("search: missing");
	else problems.push(...configProblems(value.search).map((problem) => `search.${problem}`));
	if (problems.length > 0)
		return {
			ok: false,
			text: `The evaluation configuration ${path} is incomplete. Fix these keys:\n${problems.map((p) => `  ${p}`).join("\n")}`,
		};
	// The search block as the branch-search validator normalizes it (an omitted `draw` is "random").
	const search = validateBranchSearchConfig(value.search);
	if (!search.ok) return { ok: false, text: search.text };
	return { ok: true, config: { ...value, search: search.config } as unknown as EvalConfig };
}
