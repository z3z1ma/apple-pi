import { existsSync, readFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createEditToolDefinition } from "@earendil-works/pi-coding-agent";
import { resolveToolPath } from "../../shared/src/tool-path.js";
import { ruleFileRefusal } from "./checks.js";
import { addedComments } from "./comments.js";
import { addedTexts, callEvent, editEvent, type RecordedCall, type RuleEvent, shown } from "./events.js";
import { recordFirings } from "./firings.js";
import { runRules } from "./grit.js";
import {
	gritPath,
	includedBy,
	type RuleSet,
	ruleSetsFor,
	rulesDirOfFile,
	rulesRootOf,
	type ScriptRule,
	scriptPath,
} from "./policy.js";
import { runScripts, type ScriptSource } from "./scripts.js";

export const COMMENT_RULE = "comments";
const POLICY_RULE = "policy.json";
const PATH_TOOLS = new Set(["read", "edit", "write", "ls", "find", "grep"]);

interface Problem {
	set: RuleSet;
	id: string;
	reason: string;
	failure?: boolean;
}

export function baseOf(cwd: string): string {
	return rulesRootOf(join(cwd, "x")) ?? cwd;
}

function failure(set: RuleSet, id: string, reason: string): Problem {
	return { set, id, reason, failure: true };
}

function readRuleFile(set: RuleSet, id: string, file: string): string | Problem {
	try {
		return readFileSync(file, "utf8");
	} catch (error) {
		return failure(set, id, `could not read ${file}: ${(error as Error).message}`);
	}
}

async function scriptProblems(sets: RuleSet[], on: ScriptRule["on"], event: RuleEvent, path?: string) {
	const problems: Problem[] = [];
	for (const set of sets) {
		const sources: (ScriptSource & { message?: string })[] = [];
		for (const rule of set.policy.scripts ?? []) {
			if (rule.on !== on || (path !== undefined && !includedBy(rule.includes, path))) continue;
			const body = readRuleFile(set, rule.id, scriptPath(set, rule));
			if (typeof body === "string") sources.push({ id: rule.id, on, body, message: rule.message });
			else problems.push(body);
		}
		if (!sources.length) continue;
		const [row] = await runScripts(sources, [event], new Map(sources.map((source) => [source.id, source.message])));
		for (const [id, outcome] of row ?? []) {
			if ("error" in outcome) problems.push(failure(set, id, `could not run: ${outcome.error}`));
			else for (const reason of outcome.reasons) problems.push({ set, id, reason });
		}
	}
	return problems;
}

function actionProblems(sets: RuleSet[], command: string): Problem[] {
	const problems: Problem[] = [];
	for (const set of sets)
		for (const action of set.policy.actions ?? []) {
			let pattern: RegExp;
			try {
				pattern = new RegExp(action.pattern);
			} catch (error) {
				problems.push(failure(set, action.id, `pattern does not compile: ${(error as Error).message}`));
				continue;
			}
			if (pattern.test(command)) problems.push({ set, id: action.id, reason: action.reason });
		}
	return problems;
}

function loadProblems(sets: RuleSet[]): Problem[] {
	return sets.flatMap((set) => (set.error ? [failure(set, POLICY_RULE, set.error)] : []));
}

function refusal(problems: Problem[]): string | undefined {
	if (!problems.length) return undefined;
	for (const set of new Set(problems.map((problem) => problem.set)))
		recordFirings(set.root, [
			...new Set(problems.filter((problem) => problem.set === set).map((problem) => problem.id)),
		]);
	const lines = problems.map(
		(problem) => `- [${problem.id}] ${problem.reason}${problem.failure ? ` (fix the rule in ${problem.set.dir})` : ""}`,
	);
	const where = [...new Set(problems.map((problem) => problem.set.dir))].join(", ");
	return `Refused by rules in ${where}:\n${lines.join("\n")}\n(repo_rules lists them; replay_rule tests a change to one against recorded work.)`;
}

async function proposedContent(path: string, tool: string, input: Record<string, unknown>) {
	if (tool === "write") return typeof input.content === "string" ? input.content : undefined;
	let written: string | undefined;
	const edit = createEditToolDefinition(dirname(path), {
		operations: {
			access: (file) => access(file),
			readFile: (file) => readFile(file),
			writeFile: async (_file, content) => {
				written = content;
			},
		},
	});
	try {
		const args = edit.prepareArguments ? edit.prepareArguments(input) : input;
		await edit.execute(
			"rules-preview",
			{ ...(args as object), path } as never,
			undefined,
			undefined,
			undefined as never,
		);
	} catch {
		return undefined;
	}
	return written;
}

async function editProblems(path: string, tool: string, input: Record<string, unknown>, after: string, cwd: string) {
	const sets = ruleSetsFor(path);
	const base = sets.find((set) => set.level === "project")?.root ?? baseOf(cwd);
	const relativePath = shown(base, path);
	const problems: Problem[] = loadProblems(sets);
	const before = existsSync(path) ? readFileSync(path, "utf8") : "";
	for (const set of sets) {
		if (set.policy.comments === "forbid")
			for (const comment of addedComments(path, before, after))
				problems.push({
					set,
					id: COMMENT_RULE,
					reason: `line ${comment.line}: comment ${JSON.stringify(comment.text.split("\n")[0]!.slice(0, 80))}. Comments are forbidden here: put rationale, invariants and hazards in .context/<path>.md, intent in a better name, behavior in a test.`,
				});
		const matching = (set.policy.rules ?? []).filter((rule) => includedBy(rule.includes, relativePath));
		const jobs: { rule: (typeof matching)[number]; query: string }[] = [];
		for (const rule of matching) {
			const query = readRuleFile(set, rule.grit, gritPath(set, rule));
			if (typeof query === "string") jobs.push({ rule, query });
			else problems.push(query);
		}
		const runs = await runRules(jobs.map((job) => ({ query: job.query, path, content: after })));
		for (const [index, run] of runs.entries()) {
			const { rule } = jobs[index]!;
			if (run.failure) problems.push(failure(set, rule.grit, `could not run: ${run.failure}`));
			for (const line of run.lines) problems.push({ set, id: rule.grit, reason: `line ${line}: ${rule.message}` });
		}
	}
	const added = addedTexts(tool, input);
	const event = editEvent(tool, path, base, after, "texts" in added ? added.texts : []);
	problems.push(...(await scriptProblems(sets, "edit", event, relativePath)));
	return problems;
}

export async function checkEdit(
	path: string,
	tool: string,
	input: Record<string, unknown>,
	cwd = dirname(path),
): Promise<string | undefined> {
	const after = await proposedContent(path, tool, input);
	if (after === undefined) return undefined;
	if (rulesDirOfFile(path)) return ruleFileRefusal(path, after);
	return refusal(await editProblems(path, tool, input, after, cwd));
}

function targetOf(call: RecordedCall, cwd: string): string | undefined {
	const path = call.arguments?.path;
	if (!PATH_TOOLS.has(call.name) || typeof path !== "string") return undefined;
	try {
		return resolveToolPath(path, cwd);
	} catch {
		return undefined;
	}
}

export async function checkCall(
	call: RecordedCall,
	batch: RecordedCall[],
	cwd: string,
	nested: boolean,
): Promise<string | undefined> {
	const input = call.arguments ?? {};
	const target = targetOf(call, cwd);
	const edits = !nested && (call.name === "edit" || call.name === "write") && target !== undefined;
	const after = edits ? await proposedContent(target, call.name, input) : undefined;
	if (target !== undefined && rulesDirOfFile(target))
		return after === undefined ? undefined : ruleFileRefusal(target, after);
	const sets = ruleSetsFor(join(cwd, "x"));
	const problems =
		after === undefined || target === undefined ? [] : await editProblems(target, call.name, input, after, cwd);
	if (!sets.length) return refusal(problems);
	problems.push(...loadProblems(sets).filter((problem) => !problems.some((each) => each.reason === problem.reason)));
	if (call.name === "bash" && typeof input.command === "string") problems.push(...actionProblems(sets, input.command));
	const event = callEvent(call, nested ? [call] : batch, cwd, baseOf(cwd), nested);
	problems.push(...(await scriptProblems(sets, "call", event)));
	return refusal(problems);
}
