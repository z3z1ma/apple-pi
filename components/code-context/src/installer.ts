import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { abortable } from "../../shared/src/abortable.js";
import { forkCwd, forkMessages } from "../../shared/src/fork-context.js";
import { resolveToolPath } from "../../shared/src/tool-path.js";
import { contextBlock, gateRefusal, malformedNotice, resolveContext } from "./context-file.js";
import { type ContextLintResult, lintContext } from "./lint.js";

export const CONTEXT_LINT_TOOL_NAME = "context_lint";

const MUTATION_TOOLS = new Set(["edit", "write"]);

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
			const wholeContextFileRead =
				context.isContextFile && event.input.offset === undefined && event.input.limit === undefined;
			text = reading && !wholeContextFileRead ? contextBlock(context) : context.marker;
		}
		if (text) return { content: [...event.content, { type: "text", text }] };
	});

	pi.registerTool(createContextLintTool());
}

export default installCodeContext;
