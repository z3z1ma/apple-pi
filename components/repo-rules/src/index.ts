import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setSystemPromptSection } from "../../shared/src/system-prompt-section.js";
import { resolveToolPath } from "../../shared/src/tool-path.js";
import { addedComments } from "./comments.js";
import { ruleViolations } from "./grit.js";
import { loadRepoRules, pluginsFor, RULES_DIR, rulesRootOf } from "./policy.js";

export const REPO_RULES_PROMPT_TAG = "repo-rules";

const PROMPT = `This repository keeps its rules in \`.pi/rules/\`, and the harness checks every edit and write against them before the change lands; a refusal names the rule, so fix the change and retry.
- \`policy.json\` lists the GritQL rules (\`*.grit\`, Biome plugin syntax) with the paths they apply to, the action rules for shell commands, and whether source comments are forbidden.
- When comments are forbidden, put what a comment would say elsewhere: rationale, invariants and hazards in \`.context/<path>.md\`, intent in a better name, behavior in a test.
- When you find a mistake a machine can detect (in review, while fixing a bug, or from a lesson), add a rule instead of prose: write the \`.grit\` file, list it in \`policy.json\` with its paths, show it firing on a small sample, and fix what it flags. A command pattern becomes an entry in \`actions\`.`;

const COMMITS = /\bgit\s+(add|commit)\b/;

export function proposedContent(path: string, input: Record<string, unknown>, toolName: string): string | undefined {
	if (toolName === "write") return typeof input.content === "string" ? input.content : undefined;
	const edits = input.edits as { oldText?: unknown; newText?: unknown }[] | undefined;
	if (!Array.isArray(edits) || !existsSync(path)) return undefined;
	const original = readFileSync(path, "utf8");
	const placed: { at: number; oldText: string; newText: string }[] = [];
	for (const edit of edits) {
		if (typeof edit.oldText !== "string" || typeof edit.newText !== "string" || !edit.oldText) return undefined;
		const at = original.indexOf(edit.oldText);
		if (at < 0 || original.indexOf(edit.oldText, at + 1) >= 0) return undefined;
		placed.push({ at, oldText: edit.oldText, newText: edit.newText });
	}
	placed.sort((a, b) => a.at - b.at);
	let result = "";
	let cursor = 0;
	for (const edit of placed) {
		if (edit.at < cursor) return undefined;
		result += original.slice(cursor, edit.at) + edit.newText;
		cursor = edit.at + edit.oldText.length;
	}
	return result + original.slice(cursor);
}

export async function editRefusal(
	path: string,
	toolName: string,
	input: Record<string, unknown>,
): Promise<string | undefined> {
	const root = rulesRootOf(path);
	if (!root) return undefined;
	const after = proposedContent(path, input, toolName);
	if (after === undefined) return undefined;
	const rules = loadRepoRules(root);
	const problems: string[] = [];
	if (rules.policy.comments === "forbid") {
		const before = existsSync(path) ? readFileSync(path, "utf8") : "";
		for (const comment of addedComments(path, before, after))
			problems.push(`line ${comment.line}: comment ${JSON.stringify(comment.text.split("\n")[0]!.slice(0, 80))}`);
		if (problems.length)
			problems.push(
				"This repository forbids comments in source (.pi/rules/policy.json). Put rationale, invariants and hazards in .context/<path>.md, intent in a better name, behavior in a test.",
			);
	}
	for (const violation of await ruleViolations(path, after, pluginsFor(rules, path)))
		problems.push(`line ${violation.line}: ${violation.message}`);
	return problems.length ? `Refused by ${RULES_DIR}:\n${problems.join("\n")}` : undefined;
}

export function commandRefusal(cwd: string, command: string): string | undefined {
	const root = rulesRootOf(join(cwd, "x"));
	if (!root) return undefined;
	const rule = (loadRepoRules(root).policy.actions ?? []).find((each) => new RegExp(each.pattern).test(command));
	return rule ? `Refused by action rule ${rule.id} (${RULES_DIR}/policy.json): ${rule.reason}` : undefined;
}

export function installRepoRules(pi: ExtensionAPI): void {
	const writingBatches = new Set<string>();
	pi.on("before_agent_start", (event, ctx) => {
		if (existsSync(join(ctx.cwd, RULES_DIR)))
			setSystemPromptSection(event.systemPromptOptions, REPO_RULES_PROMPT_TAG, PROMPT);
	});
	pi.on("message_end", (event) => {
		const message = event.message as { role?: string; content?: unknown };
		if (message.role !== "assistant" || !Array.isArray(message.content)) return undefined;
		writingBatches.clear();
		const calls = message.content.filter((part: { type?: string }) => part?.type === "toolCall") as {
			id: string;
			name: string;
		}[];
		if (calls.some((call) => call.name === "edit" || call.name === "write"))
			for (const call of calls) writingBatches.add(call.id);
		return undefined;
	});
	pi.on("tool_call", async (event, ctx) => {
		const input = event.input as Record<string, unknown>;
		if (event.toolName === "edit" || event.toolName === "write") {
			if (typeof input.path !== "string" || event.parentToolCallId) return undefined;
			const reason = await editRefusal(resolveToolPath(input.path, ctx.cwd), event.toolName, input);
			return reason ? { block: true, reason } : undefined;
		}
		if (event.toolName !== "bash") return undefined;
		const command = String(input.command ?? "");
		if (writingBatches.delete(event.toolCallId) && COMMITS.test(command))
			return {
				block: true,
				reason:
					"Refused: this message also edits files, and parallel calls run concurrently, so this commit would take the files before the edits land. Commit in a later message.",
			};
		const reason = commandRefusal(ctx.cwd, command);
		return reason ? { block: true, reason } : undefined;
	});
}

export default installRepoRules;
