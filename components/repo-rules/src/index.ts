import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { setSystemPromptSection } from "../../shared/src/system-prompt-section.js";
import { resolveToolPath } from "../../shared/src/tool-path.js";
import { ruleFileRefusal } from "./checks.js";
import { addedComments } from "./comments.js";
import { createEvidenceTool } from "./evidence.js";
import { firingsIn, recordFirings } from "./firings.js";
import { runRules } from "./grit.js";
import { gritPath, loadRepoRules, RULES_DIR, rulesFor, rulesRootOf } from "./policy.js";
import { createReplayTool } from "./replay.js";

export const REPO_RULES_PROMPT_TAG = "repo-rules";
export const REPO_RULES_TOOL_NAME = "repo_rules";
const COMMENT_RULE = "comments";

const OPTED_IN = `This repository keeps its rules in \`.pi/rules/\`, and the harness checks every edit and write against them before the change lands; a refusal names the rule, so fix the change and retry.
- \`policy.json\` lists the code rules with the paths they apply to and the message shown when one fires, the action rules for shell commands, and whether source comments are forbidden.
- A code rule is a GritQL query in a \`*.grit\` file. It works for any language GritQL supports: start it with a \`language\` line (\`js\` for JavaScript and TypeScript, \`css\`, \`json\`, \`python\`, \`go\`, \`rust\`, \`java\`, \`kotlin\`, \`csharp\`, \`ruby\`, \`php\`, \`sql\`, \`yaml\`, \`toml\`, \`hcl\`, \`markdown\`, \`elixir\`, \`solidity\`). Every match is a violation; the message lives in \`policy.json\`.
- When comments are forbidden, put what a comment would say elsewhere: rationale, invariants and hazards in \`.context/<path>.md\`, intent in a better name, behavior in a test.
- Add rules liberally: whenever you meet a mistake a machine can detect (in review, while fixing a bug, from a lesson or a user correction), write a rule instead of prose. Write the \`.grit\` file, then list it in \`policy.json\` with its paths, a \`fires\` sample it must flag and a \`passes\` sample it must allow; the harness refuses a rule that does not load or does not behave on its samples. A shell-command pattern becomes an \`actions\` entry with \`fires\` and \`passes\` commands. Then fix what the new rule flags.
- \`repo_rules\` lists each rule with how often it fired; narrow a rule that blocks good code and question one that never fires.`;

const NOT_OPTED_IN = `The harness can enforce repository rules: a repository that has \`.pi/rules/\` gets every edit checked against its GritQL rules and comment policy, and every shell command against its action rules. This repository has none. When you meet a mistake a machine could detect, tell the user it could become a rule and offer to set up \`.pi/rules/\`; create it only when they agree, because the rules are committed for everyone who works here.`;

const COMMITS = /\bgit\s+(add|commit)\b/;

function proposedContent(path: string, input: Record<string, unknown>, toolName: string): string | undefined {
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
	const fired: string[] = [];
	if (rules.policy.comments === "forbid") {
		const before = existsSync(path) ? readFileSync(path, "utf8") : "";
		const comments = addedComments(path, before, after);
		for (const comment of comments)
			problems.push(`line ${comment.line}: comment ${JSON.stringify(comment.text.split("\n")[0]!.slice(0, 80))}`);
		if (comments.length) {
			fired.push(COMMENT_RULE);
			problems.push(
				"This repository forbids comments in source (.pi/rules/policy.json). Put rationale, invariants and hazards in .context/<path>.md, intent in a better name, behavior in a test.",
			);
		}
	}
	const matching = rulesFor(rules, path);
	const runs = await runRules(
		matching.map((rule) => ({ query: readFileSync(gritPath(root, rule), "utf8"), path, content: after })),
	);
	for (const [index, run] of runs.entries()) {
		const rule = matching[index]!;
		if (run.failure) problems.push(`rule ${rule.grit} could not run: ${run.failure}`);
		if (run.lines.length) fired.push(rule.grit);
		for (const line of run.lines) problems.push(`line ${line}: ${rule.message}`);
	}
	const ruleFile = await ruleFileRefusal(root, path, after);
	recordFirings(root, fired);
	if (ruleFile) return problems.length ? `${ruleFile}\n${problems.join("\n")}` : ruleFile;
	return problems.length ? `Refused by ${RULES_DIR}:\n${problems.join("\n")}` : undefined;
}

export function commandRefusal(cwd: string, command: string): string | undefined {
	const root = rulesRootOf(join(cwd, "x"));
	if (!root) return undefined;
	const rule = (loadRepoRules(root).policy.actions ?? []).find((each) => new RegExp(each.pattern).test(command));
	if (!rule) return undefined;
	recordFirings(root, [rule.id]);
	return `Refused by action rule ${rule.id} (${RULES_DIR}/policy.json): ${rule.reason}`;
}

export function rulesReport(cwd: string): string {
	const root = rulesRootOf(join(cwd, "x"));
	if (!root) return `No ${RULES_DIR}/ here; this repository has not opted in to repository rules.`;
	const { policy } = loadRepoRules(root);
	const counts = firingsIn(root);
	const line = (kind: string, id: string) => {
		const seen = counts.get(id);
		return `- ${kind} ${id}: ${seen ? `fired ${seen.count} times, last ${seen.last}` : "never fired"}`;
	};
	return [
		`Rules in ${root}/${RULES_DIR}:`,
		...(policy.comments === "forbid" ? [line("policy", COMMENT_RULE)] : []),
		...(policy.rules ?? []).map((rule) => line("code", rule.grit)),
		...(policy.actions ?? []).map((action) => line("action", action.id)),
	].join("\n");
}

function createRulesTool() {
	return defineTool({
		name: REPO_RULES_TOOL_NAME,
		label: "Repository rules",
		description:
			"Read-only: list this repository's rules in .pi/rules/ (comment policy, GritQL code rules, action rules) with how many times each has refused a change or command and when it last did. Use it to narrow a rule that blocks good code or retire one that never fires.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _update, ctx) {
			return { content: [{ type: "text" as const, text: rulesReport(ctx.cwd) }], details: undefined };
		},
	});
}

export function installRepoRules(pi: ExtensionAPI): void {
	const writingBatches = new Set<string>();
	pi.registerTool(createRulesTool());
	pi.registerTool(createReplayTool());
	pi.registerTool(createEvidenceTool());
	pi.on("before_agent_start", (event, ctx) => {
		const optedIn = existsSync(join(ctx.cwd, RULES_DIR));
		setSystemPromptSection(event.systemPromptOptions, REPO_RULES_PROMPT_TAG, optedIn ? OPTED_IN : NOT_OPTED_IN);
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
