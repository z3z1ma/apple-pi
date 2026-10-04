import { readFileSync } from "node:fs";
import { relativePathsProblem } from "../../shared/src/relative-paths.js";
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
 *   "limits": { "wallClockSec": 1800 },
 *   "cloneIgnored": ["node_modules"],
 *   "overrides": { "<task id>": { "base": "<commit>", "final": "<commit>", "tests": ["path/to/a.test.ts"] } }
 * }
 * ```
 */
export interface EvalConfig {
	/** The model profile every run uses (`model-profiles.json`). */
	model: string;
	/** Closed ledger task ids to evaluate. */
	tasks: string[];
	/** Per oracle test run, in extraction and in scoring. */
	oracle: { timeoutSec: number };
	/** The budget of one run; at least one field. */
	limits: { wallClockSec?: number; outputTokens?: number };
	/** Ignored directories (dependencies) cloned into every clone. */
	cloneIgnored: string[];
	/** The repository whose ledger history holds the tasks; this checkout when absent. */
	repo?: string;
	/** Optional explicit boundaries per task id, used instead of the commits its bundle cites. */
	overrides?: Record<string, TaskOverride>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const positive = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0;

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
	else if (!positive(timeout)) problems.push("oracle.timeoutSec: must be a positive number");
	const limits = value.limits;
	if (limits === undefined) problems.push("limits: missing");
	else if (
		!isRecord(limits) ||
		(limits.wallClockSec === undefined && limits.outputTokens === undefined) ||
		![limits.wallClockSec, limits.outputTokens].every((limit) => limit === undefined || positive(limit))
	)
		problems.push("limits: must set wallClockSec or outputTokens to a positive number");
	const cloneIgnored = relativePathsProblem(value.cloneIgnored);
	if (cloneIgnored) problems.push(`cloneIgnored: ${cloneIgnored}`);
	if (value.repo !== undefined && (typeof value.repo !== "string" || value.repo === ""))
		problems.push("repo: must be a path");
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
	if (problems.length > 0)
		return {
			ok: false,
			text: `The evaluation configuration ${path} is incomplete. Fix these keys:\n${problems.map((p) => `  ${p}`).join("\n")}`,
		};
	return { ok: true, config: value as unknown as EvalConfig };
}
