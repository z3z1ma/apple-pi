import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ruleFileRefusal, ruleSetOfFile } from "./checks.js";
import { addedComments } from "./comments.js";
import { addedTexts, callEvent, editEvent, type RecordedCall, shown } from "./events.js";
import { recordFirings } from "./firings.js";
import { runRules } from "./grit.js";
import { gritPath, includedBy, type RuleSet, ruleSetsFor, rulesRootOf, type ScriptRule, scriptPath } from "./policy.js";
import { runScripts, type ScriptSource } from "./scripts.js";

export const COMMENT_RULE = "comments";

interface Problem {
	set: RuleSet;
	id: string;
	reason: string;
	failure?: boolean;
}

export function baseOf(cwd: string): string {
	return rulesRootOf(join(cwd, "x")) ?? cwd;
}

function scriptsOn(set: RuleSet, on: ScriptRule["on"], path?: string): (ScriptSource & { message?: string })[] {
	return (set.policy.scripts ?? [])
		.filter((rule) => rule.on === on && (!path || includedBy(rule.includes, path)))
		.flatMap((rule) => {
			const file = scriptPath(set, rule);
			return existsSync(file) ? [{ id: rule.id, on, body: readFileSync(file, "utf8"), message: rule.message }] : [];
		});
}

async function scriptProblems(
	sets: RuleSet[],
	on: ScriptRule["on"],
	event: Parameters<typeof runScripts>[1][number],
	path?: string,
): Promise<Problem[]> {
	const problems: Problem[] = [];
	for (const set of sets) {
		const sources = scriptsOn(set, on, path);
		if (!sources.length) continue;
		const [row] = await runScripts(sources, [event], new Map(sources.map((source) => [source.id, source.message])));
		for (const [id, outcome] of Object.entries(row ?? {})) {
			if ("error" in outcome) problems.push({ set, id, reason: `could not run: ${outcome.error}`, failure: true });
			else for (const reason of outcome.reasons) problems.push({ set, id, reason });
		}
	}
	return problems;
}

function refusal(counted: Problem[]): string | undefined {
	if (!counted.length) return undefined;
	for (const set of new Set(counted.map((problem) => problem.set)))
		recordFirings(set.root, [
			...new Set(counted.filter((problem) => problem.set === set).map((problem) => problem.id)),
		]);
	const lines = counted.map(
		(problem) => `- [${problem.id}] ${problem.reason}${problem.failure ? ` (fix the rule in ${problem.set.dir})` : ""}`,
	);
	const where = [...new Set(counted.map((problem) => problem.set.dir))].join(", ");
	return `Refused by rules in ${where}:\n${lines.join("\n")}\n(repo_rules lists them; replay_rule tests a change to one against recorded work.)`;
}

export async function checkCall(
	call: RecordedCall,
	batch: RecordedCall[],
	cwd: string,
	nested: boolean,
): Promise<string | undefined> {
	const sets = ruleSetsFor(join(cwd, "x"));
	if (!sets.length) return undefined;
	const base = baseOf(cwd);
	const problems: Problem[] = [];
	const command = call.name === "bash" ? call.arguments?.command : undefined;
	if (typeof command === "string")
		for (const set of sets)
			for (const action of set.policy.actions ?? [])
				if (new RegExp(action.pattern).test(command)) problems.push({ set, id: action.id, reason: action.reason });
	const event = callEvent(call, nested ? [call] : batch, cwd, base, nested);
	const repairsRules = event.path !== null && ruleSetOfFile(resolve(base, event.path)) !== undefined;
	if (!repairsRules) problems.push(...(await scriptProblems(sets, "call", event)));
	return refusal(problems);
}

function proposedContent(path: string, input: Record<string, unknown>, tool: string): string | undefined {
	if (tool === "write") return typeof input.content === "string" ? input.content : undefined;
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

export async function checkEdit(
	path: string,
	tool: string,
	input: Record<string, unknown>,
): Promise<string | undefined> {
	const after = proposedContent(path, input, tool);
	if (after === undefined) return undefined;
	if (ruleSetOfFile(path)) return ruleFileRefusal(path, after);
	const sets = ruleSetsFor(path);
	if (!sets.length) return undefined;
	const base = sets.find((set) => set.level === "project")?.root ?? dirname(path);
	const relativePath = shown(base, path);
	const problems: Problem[] = [];
	for (const set of sets) {
		if (set.policy.comments === "forbid") {
			const before = existsSync(path) ? readFileSync(path, "utf8") : "";
			const comments = addedComments(path, before, after);
			for (const comment of comments)
				problems.push({
					set,
					id: COMMENT_RULE,
					reason: `line ${comment.line}: comment ${JSON.stringify(comment.text.split("\n")[0]!.slice(0, 80))}. Comments are forbidden here: put rationale, invariants and hazards in .context/<path>.md, intent in a better name, behavior in a test.`,
				});
		}
		const matching = (set.policy.rules ?? []).filter((rule) => includedBy(rule.includes, relativePath));
		const runs = await runRules(
			matching.map((rule) => ({ query: readFileSync(gritPath(set, rule), "utf8"), path, content: after })),
		);
		for (const [index, run] of runs.entries()) {
			const rule = matching[index]!;
			if (run.failure) problems.push({ set, id: rule.grit, reason: `could not run: ${run.failure}`, failure: true });
			for (const line of run.lines) problems.push({ set, id: rule.grit, reason: `line ${line}: ${rule.message}` });
		}
	}
	const added = addedTexts(tool, input);
	const event = editEvent(tool, path, base, after, "texts" in added ? added.texts : []);
	problems.push(...(await scriptProblems(sets, "edit", event, relativePath)));
	return refusal(problems);
}
