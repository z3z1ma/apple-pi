import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveToolPath } from "../../shared/src/tool-path.js";
import { runTlc, type TlcResult } from "./tlc.js";

export const TLC_TOOL_NAME = "tlc_check";

function report(result: TlcResult, spec: string): string {
	const lines = [`TLC ${result.version} on ${spec}: ${result.verdict.toUpperCase()}. ${result.message}`];
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
	if (result.verdict === "error") lines.push("", "TLC output:", result.output.trimEnd());
	return lines.join("\n");
}

export function createTlcTool() {
	return defineTool({
		name: TLC_TOOL_NAME,
		label: "TLC model check",
		description:
			"Model-check a TLA+ specification with TLC and get a structured verdict: pass (every reachable state checked), violation (with the violated invariant or property), deadlock, incomplete (a time limit, simulation or depth bound stopped the search first, with the counts reached), or error. A failure returns the counterexample as numbered states, each with its action and variable values. Every run lists the actions that never took a step. The spec may extend other modules in its directory and the TLA+ Community Modules (SequencesExt, FiniteSetsExt, Functions, Folds, Relation, Graphs and more). Downloads pinned, checksummed tools on first use; needs Java.",
		promptSnippet: "Model-check a TLA+ spec with TLC; returns the verdict and any counterexample trace",
		promptGuidelines: [
			"Use tlc_check to search a finite TLA+ model of a state machine for an ordering of events that breaks a named invariant. Load the formal-verification skill for how to derive the model from the code and turn a counterexample into a test against the real implementation.",
			"Pass `spec` as the `.tla` file; `config` defaults to the `.cfg` beside it. Other modules in the spec's directory are found by their declared names, whatever their file names.",
			'To grow a model\'s bounds without editing files, pass `constants` (for example `{"Workers": "{w1, w2, w3}", "MaxRetries": "4"}`) and raise them run by run under a `timeLimit`; most bugs show at small bounds, and each larger bound that passes adds confidence.',
			'Use `mode: "simulate"` with `traces` or `timeLimit` for state spaces too large to exhaust, and `mode: "depth-first"` with `depth` to search every behavior up to a length. Both return `incomplete`, never `pass`.',
			"Only `pass` means every reachable state was checked. Treat a listed action that never took a step as a modelling error: an invariant that holds because nothing happens proves nothing.",
			"Runs use every core by default; pass `workers: 1` for the guaranteed shortest counterexample.",
		],
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
			return { content: [{ type: "text", text: report(result, params.spec) }], details };
		},
	});
}

export default function installTlc(pi: ExtensionAPI): void {
	pi.registerTool(createTlcTool());
}
