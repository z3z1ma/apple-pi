import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveToolPath } from "../../shared/src/tool-path.js";
import { runTlc, type TlcResult } from "./tlc.js";

export const TLC_TOOL_NAME = "tlc_check";

function report(result: TlcResult, spec: string): string {
	const lines = [`TLC ${result.version} on ${spec}: ${result.verdict.toUpperCase()}. ${result.message}`];
	if (result.stats)
		lines.push(
			`${result.stats.generated} states generated, ${result.stats.distinct} distinct, ${result.stats.left} left on queue${
				result.stats.depth === undefined ? "" : `, depth ${result.stats.depth}`
			}.`,
		);
	if (result.verdict === "pass" && result.stats && result.stats.left > 0)
		lines.push("The search did not finish: states remain on the queue.");
	if (result.trace.length) {
		lines.push("", "Counterexample:");
		for (const state of result.trace) {
			lines.push(`State ${state.number}: ${state.action}`);
			for (const [name, value] of Object.entries(state.variables)) lines.push(`  ${name} = ${value}`);
		}
	}
	if (result.verdict === "error")
		lines.push("", "TLC output (end):", result.output.trimEnd().split("\n").slice(-30).join("\n"));
	return lines.join("\n");
}

export function createTlcTool() {
	return defineTool({
		name: TLC_TOOL_NAME,
		label: "TLC model check",
		description:
			"Model-check a TLA+ specification with TLC and get a structured verdict: pass, violation (with the violated invariant or property), deadlock, or error. A failure returns the counterexample as numbered states, each with its action and variable values, plus state counts and search depth. Downloads a pinned, checksummed tla2tools.jar on first use; needs Java.",
		promptSnippet: "Model-check a TLA+ spec with TLC; returns the verdict and any counterexample trace",
		promptGuidelines: [
			"Use tlc_check to search a finite TLA+ model of a state machine for an ordering of events that breaks a named invariant. Load the formal-verification skill for how to derive the model from the code and turn a counterexample into a test against the real implementation.",
			"Pass `spec` as the `.tla` file; `config` defaults to the `.cfg` beside it. One module plus the standard TLA+ modules; the declared module name may differ from the file name.",
			"A pass with states left on the queue is an unfinished search, not a pass.",
		],
		parameters: Type.Object({
			spec: Type.String({ description: "Path to the .tla file" }),
			config: Type.Optional(Type.String({ description: "Path to the .cfg file; defaults to the spec's .cfg" })),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const spec = resolveToolPath(params.spec, ctx.cwd);
			const config = params.config ? resolveToolPath(params.config, ctx.cwd) : undefined;
			const result = await runTlc({
				spec,
				config,
				signal,
				onLine: (line) => {
					if (/^Progress\(|states generated|Computing initial states|Starting\.\.\./.test(line))
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
