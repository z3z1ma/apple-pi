import { readFile } from "node:fs/promises";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveToolPath } from "../../shared/src/tool-path.js";
import { ALLOY_SOLVERS, type AlloyResult, runAlloy } from "./alloy.js";
import { runApalache } from "./apalache.js";
import { type LeanResult, runLean } from "./lean.js";
import { runTlc } from "./tlc.js";
import type { TlaResult } from "./toolchain.js";

export const TLC_TOOL_NAME = "tlc_check";
export const SYMBOLIC_TOOL_NAME = "tla_symbolic_check";
export const ALLOY_TOOL_NAME = "alloy_check";
export const LEAN_TOOL_NAME = "lean_check";

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

function alloyReport(result: AlloyResult, spec: string): string {
	const lines = [`Alloy ${result.version} on ${spec}: ${result.verdict.toUpperCase()}. ${result.message}`];
	for (const command of result.commands) {
		const expected = command.expected ? ` (expected ${command.expected === "instance" ? "one" : "none"})` : "";
		lines.push(`${command.index}. ${command.source}: ${command.outcome}${expected}`);
	}
	for (const command of result.commands)
		if (command.instance)
			lines.push(
				"",
				`${command.outcome === "counterexample" ? "Counterexample" : "Instance"} for ${command.name}:`,
				command.instance,
			);
	if (result.verdict === "error" && !result.commands.length) lines.push("", "Alloy output:", result.output.trimEnd());
	return lines.join("\n");
}

function leanReport(result: LeanResult, file: string): string {
	const lines = [`${result.toolchain} on ${file}: ${result.verdict.toUpperCase()}. ${result.message}`];
	if (result.project) lines.push(`Project: ${result.project}.`);
	for (const theorem of result.theorems)
		lines.push(
			theorem.problem
				? `${theorem.name}: not audited: ${theorem.problem}`
				: `${theorem.name}: axioms ${theorem.axioms?.length ? theorem.axioms.join(", ") : "none"}`,
		);
	for (const diagnostic of result.diagnostics)
		lines.push(`${file}:${diagnostic.line}:${diagnostic.column + 1}: ${diagnostic.severity}: ${diagnostic.text}`);
	if (result.verdict === "error" && !result.diagnostics.length) lines.push("", "Lean output:", result.output.trimEnd());
	return lines.join("\n");
}

export function createAlloyTool() {
	return defineTool({
		name: ALLOY_TOOL_NAME,
		label: "Alloy check",
		description:
			"Run the check and run commands of an Alloy 6 model and get a structured verdict, each within its command's scope. pass: every property check found no counterexample, every `expect` held, and some run found an instance, which shows the facts are satisfiable. violation: a counterexample, or a result its `expect` did not predict. incomplete: no run found an instance, a run without `expect` found none, no property was checked, or the time limit stopped it. A check with `expect 1` is a control that must find its counterexample; it never counts as a property. Counterexamples and instances come back as atoms, relations and skolems, state by state for temporal models. Downloads a pinned, checksummed Alloy on first use; needs Java 17.",
		parameters: Type.Object({
			spec: Type.String({ description: "Path to the .als file" }),
			commands: Type.Optional(
				Type.Array(Type.String(), { description: "Command names or indices to run; defaults to every command" }),
			),
			solver: Type.Optional(
				Type.Union(
					ALLOY_SOLVERS.map((solver) => Type.Literal(solver)),
					{ description: "SAT solver; sat4j by default" },
				),
			),
			timeLimit: Type.Optional(Type.Integer({ minimum: 1, description: "Seconds before the remaining commands stop" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const result = await runAlloy({ ...params, spec: resolveToolPath(params.spec, ctx.cwd), signal });
			const { output: _output, ...details } = result;
			return { content: [{ type: "text", text: alloyReport(result, params.spec) }], details };
		},
	});
}

export function createLeanTool() {
	return defineTool({
		name: LEAN_TOOL_NAME,
		label: "Lean check",
		description:
			"Check a Lean 4 file and audit what it declares, from Lean's own environment. pass: the file has no errors, no declaration depends on sorry, and every audited theorem depends only on the standard axioms (propext, Classical.choice, Quot.sound). incomplete: sorry, another axiom (including native_decide's trust in the compiler), no theorem, a requested name that is not a theorem of the file, or the time limit. error: Lean's diagnostics, such as a proof that does not go through, or a failed process. Inside a Lake project the project's toolchain and dependencies are used; a lone file uses a pinned Lean. Installs elan (pinned, checksummed) on first use when none is present; toolchains download through it.",
		parameters: Type.Object({
			file: Type.String({ description: "Path to the .lean file" }),
			theorems: Type.Optional(
				Type.Array(Type.String(), {
					description: "Full names of the theorems to audit; defaults to every theorem the file declares",
				}),
			),
			build: Type.Optional(
				Type.Boolean({ description: "Run `lake build` first, for a file that imports the project's own modules" }),
			),
			timeLimit: Type.Optional(Type.Integer({ minimum: 1, description: "Seconds before the check stops" })),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const file = resolveToolPath(params.file, ctx.cwd);
			const result = await runLean({
				...params,
				file,
				source: await readFile(file, "utf8"),
				signal,
				onLine: (line) => {
					if (/^info: (downloading|installing)|^[✔✖]? ?\[\d+\/\d+\]/.test(line))
						onUpdate?.({ content: [{ type: "text", text: line }], details: undefined });
				},
			});
			const { output: _output, ...details } = result;
			return { content: [{ type: "text", text: leanReport(result, params.file) }], details };
		},
	});
}

export default function installFormalVerification(pi: ExtensionAPI): void {
	pi.registerTool(createTlcTool());
	pi.registerTool(createSymbolicTool());
	pi.registerTool(createAlloyTool());
	pi.registerTool(createLeanTool());
}
