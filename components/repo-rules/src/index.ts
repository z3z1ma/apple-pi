import { join } from "node:path";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { forkCwd, forkMessages } from "../../shared/src/fork-context.js";
import { setSystemPromptSection } from "../../shared/src/system-prompt-section.js";
import { resolveToolPath } from "../../shared/src/tool-path.js";
import { COMMENT_RULE, checkCall, checkEdit } from "./engine.js";
import type { RecordedCall } from "./events.js";
import { createEvidenceTool } from "./evidence.js";
import { firingsIn } from "./firings.js";
import { RULES_DIR, ruleSetsFor, userRulesDir } from "./policy.js";
import { createReplayTool } from "./replay.js";

export { checkCall, checkEdit } from "./engine.js";

export const REPO_RULES_PROMPT_TAG = "repo-rules";
export const REPO_RULES_TOOL_NAME = "repo_rules";

const RULES_GUIDE = `Rules in \`.pi/rules/\` (this repository) and \`~/.pi/agent/rules/\` (yours, everywhere) check every tool call and edit before it runs; a refusal names the rule, so change the call and retry. Each \`policy.json\` lists:
- \`rules\`: GritQL queries (\`*.grit\`, first line \`language\` then \`js\` for JavaScript and TypeScript, \`css\`, \`json\`, \`python\`, \`go\`, \`rust\`, \`java\`, \`kotlin\`, \`csharp\`, \`ruby\`, \`php\`, \`sql\`, \`yaml\`, \`toml\`, \`hcl\`, \`markdown\`, \`elixir\` or \`solidity\`) over edited files matching \`includes\`; every match is a violation.
- \`actions\`: a regular expression over shell commands.
- \`scripts\`: a JavaScript function body (\`*.js\`) for anything else. \`on: "call"\` sees \`event.tool\`, \`input\`, \`path\`, a command's literal \`paths\` and \`words\`, \`nested\`, and \`batch\` (the calls of the same parallel message); \`on: "edit"\` sees \`path\`, the new \`content\` and the \`added\` text. Return a reason, \`true\` for its \`message\`, or nothing; \`matches(path, glob)\` helps.
- \`comments: "forbid"\` refuses new source comments; rationale goes to \`.context/<path>.md\`.
A rule must refuse its \`fires\` samples and allow its \`passes\` samples (texts, commands, or events), or writing it is refused. A rule guards every later session: when a mistake is machine-detectable, write the rule instead of prose, replay it, then fix what it flags. \`replay_rule\` shows what a rule would have refused in recorded work; \`repo_rules\` how often each fired.`;

const NOT_OPTED_IN = `Rules in \`.pi/rules/\` (GritQL over edits, regular expressions over shell commands, JavaScript over any tool call) would be checked before every call; this repository has none. Offer rules for repeated detectable mistakes, and create them after user agreement, because contributors share them; rules for you alone go in \`~/.pi/agent/rules/\`.`;

function executingBatch(ctx: ExtensionContext, callId: string): RecordedCall[] {
	const messages =
		forkMessages(ctx.sessionManager.getSessionId()) ?? ctx.sessionManager.buildSessionProjection().messages;
	const message = messages.findLast(
		(each) => each.role === "assistant" && each.content.some((part) => part.type === "toolCall" && part.id === callId),
	);
	if (message?.role !== "assistant") return [];
	return message.content.filter((part) => part.type === "toolCall") as RecordedCall[];
}

export function rulesReport(cwd: string): string {
	const sets = ruleSetsFor(join(cwd, "x"));
	if (!sets.length)
		return `No rules here: neither ${RULES_DIR}/ in this repository nor ${userRulesDir()} has a policy.json.`;
	return sets
		.flatMap((set) => {
			const counts = firingsIn(set.root);
			const line = (kind: string, id: string, extra = "") => {
				const seen = counts.get(id);
				return `- ${kind} ${id}${extra}: ${seen ? `fired ${seen.count} times, last ${seen.last}` : "never fired"}`;
			};
			const { policy } = set;
			return [
				`${set.level === "user" ? "Your rules" : "Repository rules"} in ${set.dir}:`,
				...(policy.comments === "forbid" ? [line("policy", COMMENT_RULE)] : []),
				...(policy.rules ?? []).map((rule) => line("code", rule.grit)),
				...(policy.actions ?? []).map((action) => line("action", action.id)),
				...(policy.scripts ?? []).map((rule) => line("script", rule.id, ` (on ${rule.on}, ${rule.script})`)),
			];
		})
		.join("\n");
}

function createRulesTool() {
	return defineTool({
		name: REPO_RULES_TOOL_NAME,
		label: "Repository rules",
		description:
			"Read-only: list the rules that apply here (this repository's .pi/rules/ and your ~/.pi/agent/rules/: comment policy, GritQL, action and script rules) with how many times each has refused a call or edit and when it last did. Use it to narrow a rule that blocks good work or retire one that never fires.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _update, ctx) {
			return { content: [{ type: "text" as const, text: rulesReport(ctx.cwd) }], details: undefined };
		},
	});
}

export function installRepoRules(pi: ExtensionAPI): void {
	pi.registerTool(createRulesTool());
	pi.registerTool(createReplayTool());
	pi.registerTool(createEvidenceTool());
	pi.on("before_agent_start", (event, ctx) => {
		const ruled = ruleSetsFor(join(ctx.cwd, "x")).length > 0;
		setSystemPromptSection(event.systemPromptOptions, REPO_RULES_PROMPT_TAG, ruled ? RULES_GUIDE : NOT_OPTED_IN);
	});
	pi.on("tool_call", async (event, ctx) => {
		const input = event.input as Record<string, unknown>;
		const cwd = forkCwd() ?? ctx.cwd;
		const nested = Boolean(event.parentToolCallId);
		const call: RecordedCall = { id: event.toolCallId, name: event.toolName, arguments: input };
		if (!nested && (event.toolName === "edit" || event.toolName === "write") && typeof input.path === "string") {
			const reason = await checkEdit(resolveToolPath(input.path, cwd), event.toolName, input);
			if (reason) return { block: true, reason };
		}
		const batch = nested ? [call] : executingBatch(ctx, event.toolCallId);
		const reason = await checkCall(call, batch.length ? batch : [call], cwd, nested);
		return reason ? { block: true, reason } : undefined;
	});
}

export default installRepoRules;
