import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveToolPath } from "../../shared/src/tool-path.js";
import { runApalache } from "./apalache.js";
import { runTlc } from "./tlc.js";
import type { TlaResult } from "./toolchain.js";

export const TLC_TOOL_NAME = "tlc_check";
export const SYMBOLIC_TOOL_NAME = "tla_symbolic_check";

function report(engine: string, result: TlaResult, spec: string): string {
	const lines = [`${engine} ${result.version} on ${spec}: ${result.verdict.toUpperCase()}. ${result.message}`];
	const stats = result.stats;
	if (stats)
		lines.push(
			[
				`${stats.generated} states generated`,
				stats.distinct === undefined ? "" : `${stats.distinct} distinct`,
				stats.left === undefined ? "" : `${stats.left} left on queue`,
				stats.depth === undefined ? "" : `depth ${stats.depth}`,
			]
				.filter(Boolean)
				.join(", ") + ".",
		);
	if (result.seed) lines.push(`Seed ${result.seed}.`);
	if (result.unused.length)
		lines.push(
			`Never took a step (the check is vacuous for these; widen the model or fix their guards): ${result.unused.join("; ")}.`,
		);
	if (result.trace.length) {
		lines.push("", "Counterexample:");
		for (const state of result.trace) {
			lines.push(`State ${state.number}: ${state.action}`);
			for (const [name, value] of Object.entries(state.variables)) lines.push(`  ${name} = ${value}`);
		}
	}
	if (result.verdict === "error") lines.push("", `${engine} output:`, result.output.trimEnd());
	return lines.join("\n");
}

export function createTlcTool() {
	return defineTool({
		name: TLC_TOOL_NAME,
		label: "TLC model check",
		description:
			"Model-check a TLA+ specification with TLC and get a structured verdict: pass (every reachable state checked), violation (with the violated invariant or property), deadlock, incomplete (a time limit, simulation or depth bound stopped the search first, with the counts reached), or error. A failure returns the counterexample as numbered states, each with its action and variable values. Every run lists the actions that never took a step. The spec may extend other modules in its directory and the TLA+ Community Modules (SequencesExt, FiniteSetsExt, Functions, Folds, Relation, Graphs and more). Downloads pinned, checksummed tools on first use; needs Java.",
		parameters: Type.Object({
			spec: Type.String({ description: "Path to the .tla file" }),
			config: Type.Optional(Type.String({ description: "Path to the .cfg file; defaults to the spec's .cfg" })),
			mode: Type.Optional(
				Type.Union([Type.Literal("exhaustive"), Type.Literal("simulate"), Type.Literal("depth-first")], {
					description:
						"exhaustive (default): breadth-first over every reachable state. simulate: random behaviors. depth-first: every behavior up to `depth` steps",
				}),
			),
			constants: Type.Optional(
				Type.Record(Type.String(), Type.String(), {
					description:
						"Constant values in .cfg syntax (a number, string, model value, or set of them), replacing the .cfg's",
				}),
			),
			invariants: Type.Optional(Type.Array(Type.String(), { description: "Extra invariants to check" })),
			properties: Type.Optional(Type.Array(Type.String(), { description: "Extra temporal properties to check" })),
			checkDeadlock: Type.Optional(
				Type.Boolean({ description: "Report deadlock; overrides the .cfg's CHECK_DEADLOCK" }),
			),
			timeLimit: Type.Optional(
				Type.Integer({ minimum: 1, description: "Seconds before TLC stops and reports what it reached" }),
			),
			workers: Type.Optional(
				Type.Integer({
					minimum: 1,
					description: "TLC worker threads; defaults to every core (depth-first supports only 1)",
				}),
			),
			depth: Type.Optional(
				Type.Integer({
					minimum: 1,
					description: "depth-first: the bound on behavior length. simulate: the longest behavior (TLC default 100)",
				}),
			),
			traces: Type.Optional(Type.Integer({ minimum: 1, description: "simulate: how many behaviors to generate" })),
			seed: Type.Optional(Type.Integer({ description: "simulate: the random seed, to repeat a run" })),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const result = await runTlc({
				...params,
				spec: resolveToolPath(params.spec, ctx.cwd),
				config: params.config ? resolveToolPath(params.config, ctx.cwd) : undefined,
				signal,
				onLine: (line) => {
					if (/^Progress|^Starting|states generated|Computing initial states/.test(line))
						onUpdate?.({ content: [{ type: "text", text: line }], details: undefined });
				},
			});
			const { output: _output, ...details } = result;
			return { content: [{ type: "text", text: report("TLC", result, params.spec) }], details };
		},
	});
}

export function createSymbolicTool() {
	return defineTool({
		name: SYMBOLIC_TOOL_NAME,
		label: "Apalache symbolic check",
		description:
			"Check a TLA+ specification symbolically with Apalache (SMT), without enumerating states: integers need no bounds, constants can range over whole sets such as Nat, and an inductive invariant proves a property for behaviors of any length. Returns the same verdicts as tlc_check: pass, violation with its counterexample trace, deadlock, incomplete, or error. Downloads a pinned, checksummed Apalache (192 MB) on first use; needs Java 17.",
		parameters: Type.Object({
			spec: Type.String({ description: "Path to the .tla file" }),
			config: Type.Optional(
				Type.String({ description: "Path to a TLC-format .cfg; defaults to the spec's .cfg when it exists" }),
			),
			mode: Type.Optional(
				Type.Union([Type.Literal("bounded"), Type.Literal("inductive")], {
					description: "bounded (default): every behavior up to `length` steps. inductive: a proof for every length",
				}),
			),
			invariants: Type.Optional(
				Type.Array(Type.String(), { description: "Invariants to check or prove; defaults to the .cfg's INVARIANT" }),
			),
			inductive: Type.Optional(Type.String({ description: "inductive: the inductive invariant operator" })),
			length: Type.Optional(Type.Integer({ minimum: 0, description: "bounded: the most steps to check (default 10)" })),
			constInit: Type.Optional(
				Type.String({ description: "Operator that assigns the constants, such as ConstInit == N \\in Nat" }),
			),
			constants: Type.Optional(
				Type.Record(Type.String(), Type.String(), { description: "Fixed constant values in .cfg syntax" }),
			),
			init: Type.Optional(Type.String({ description: "Initial-state operator (default Init)" })),
			next: Type.Optional(Type.String({ description: "Next-state operator (default Next)" })),
			temporal: Type.Optional(Type.Array(Type.String(), { description: "bounded: temporal properties to check" })),
			checkDeadlock: Type.Optional(
				Type.Boolean({ description: "bounded: report deadlock; defaults to the .cfg's CHECK_DEADLOCK, else on" }),
			),
			timeLimit: Type.Optional(Type.Integer({ minimum: 1, description: "Seconds before the check stops" })),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const result = await runApalache({
				...params,
				spec: resolveToolPath(params.spec, ctx.cwd),
				config: params.config ? resolveToolPath(params.config, ctx.cwd) : undefined,
				signal,
				onLine: (line) => {
					if (/^Downloading|^State \d+: Checking|^PASS #\d+: BoundedChecker/.test(line))
						onUpdate?.({ content: [{ type: "text", text: line.replace(/\s+I@[\d:.]+$/, "") }], details: undefined });
				},
			});
			const { output: _output, ...details } = result;
			return { content: [{ type: "text", text: report("Apalache", result, params.spec) }], details };
		},
	});
}

export default function installTla(pi: ExtensionAPI): void {
	pi.registerTool(createTlcTool());
	pi.registerTool(createSymbolicTool());
}
