import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { abortable } from "../../shared/src/abortable.js";
import { forkCwd, forkMessages } from "../../shared/src/fork-context.js";
import { resolveToolPath } from "../../shared/src/tool-path.js";
import { type ContextLintResult, lintContext } from "./lint.js";
import { contextBlock, gateRefusal, malformedNotice, resolveContext } from "./context-file.js";

export const CONTEXT_LINT_TOOL_NAME = "context_lint";

const MUTATION_TOOLS = new Set(["edit", "write"]);

/** What the model sees now: a fork's own conversation, or the session's compaction-aware branch. */
function effectiveMessages(ctx: ExtensionContext): readonly AgentMessage[] {
	return forkMessages(ctx.sessionManager.getSessionId()) ?? ctx.sessionManager.buildSessionProjection().messages;
}

function targetOf(input: Record<string, unknown>, ctx: ExtensionContext): { path: string; cwd: string } | undefined {
	if (typeof input.path !== "string" || input.path.length === 0) return undefined;
	const cwd = forkCwd() ?? ctx.cwd;
	return { path: resolveToolPath(input.path, cwd), cwd };
}

function formatLint(result: ContextLintResult): string {
	const summary = `${result.contextFileCount} context file${result.contextFileCount === 1 ? "" : "s"}`;
	if (result.findings.length === 0) return `Context lint passed: ${summary}.`;
	return [
		`Context lint found ${result.findings.length} issue${result.findings.length === 1 ? "" : "s"} in ${summary}:`,
		...result.findings.map((finding) => `- ${finding.kind} ${finding.message}`),
	].join("\n");
}

function createContextLintTool() {
	return defineTool({
		name: CONTEXT_LINT_TOOL_NAME,
		label: "Lint context files",
		description:
			"Read-only check of every context file under the project's `.context/` directory: orphaned context files, headings other than `## file` or `## symbol:<name>`, duplicate headings, symbols absent from the source file, missing `Coupled:` and `Verify:` paths, and `[[wiki-links]]` that name no .wiki page.",
		promptSnippet: "Check context files under `.context/` for broken structure and references",
		promptGuidelines: [
			"A context file is a Markdown file under the project's `.context/` directory that mirrors a source file's path (`app/main.py` has `.context/app/main.py.md`) and holds knowledge the code cannot show: invariants, hazards, rationale, cross-file couplings. Reading the source file appends its context file. When a context file exists, edit and write of it or its source file stay blocked until its current version is in your context.",
			"Context file sections are `## file` or `## symbol:<name>` (for example `## symbol:Router.get`). A section may list `Coupled: path, path` for files whose contracts depend on it, `Verify: path` for tests that check it, and `[[wiki-page]]` links for cross-cutting explanations. Leave out what the code already shows.",
			"Run `context_lint` after you change a context file or rename, move, or delete a file that has one.",
		],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
			const result = await abortable(lintContext(ctx.cwd, signal), signal);
			return {
				content: [{ type: "text" as const, text: formatLint(result) }],
				details: { contextFileCount: result.contextFileCount, findingCount: result.findings.length },
			};
		},
		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("Lint context files")), 0, 0);
		},
		renderResult(result, { isPartial }, theme) {
			if (isPartial) return new Text(theme.fg("warning", "Linting context files..."), 0, 0);
			const count = (result.details as { findingCount?: number } | undefined)?.findingCount ?? 0;
			return new Text(
				count === 0
					? theme.fg("success", "Context files valid")
					: theme.fg("warning", `${count} context file issue${count === 1 ? "" : "s"}`),
				0,
				0,
			);
		},
	});
}

/**
 * Deliver each source file's context file on a top-level read and block a top-level edit or
 * write until the context file's current marker is in the model's context. Calls a tool such as
 * `pi_exec` makes carry `parentToolCallId`; they get raw reads and no gate.
 */
export function installCodeContext(pi: ExtensionAPI): void {
	pi.on("tool_call", (event, ctx) => {
		if (event.parentToolCallId || !MUTATION_TOOLS.has(event.toolName)) return;
		const target = targetOf(event.input, ctx);
		if (!target) return;
		const context = resolveContext(target.path, target.cwd, effectiveMessages(ctx));
		if (context?.status === "missing") return { block: true, reason: gateRefusal(context) };
	});

	pi.on("tool_result", (event, ctx) => {
		if (event.parentToolCallId || event.isError) return;
		const reading = event.toolName === "read";
		if (!reading && !MUTATION_TOOLS.has(event.toolName)) return;
		const target = targetOf(event.input, ctx);
		if (!target) return;
		const context = resolveContext(target.path, target.cwd, effectiveMessages(ctx));
		if (!context || (!reading && !context.isContextFile)) return;
		let text: string | undefined;
		if (context.status === "malformed" && reading) text = malformedNotice(context);
		else if (context.status === "missing") {
			// A whole read of the context file already shows its content, and a mutation of it was just made.
			const wholeContextFileRead =
				context.isContextFile && event.input.offset === undefined && event.input.limit === undefined;
			text = reading && !wholeContextFileRead ? contextBlock(context) : context.marker;
		}
		if (text) return { content: [...event.content, { type: "text", text }] };
	});

	pi.registerTool(createContextLintTool());
}

export default installCodeContext;
