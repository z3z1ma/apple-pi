import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { callEvent, editEvent, type RecordedCall, type RuleEvent } from "./events.js";
import { runRules } from "./grit.js";
import {
	type ActionRule,
	type CodeRule,
	gritPath,
	loadRuleSet,
	type RulePolicy,
	type RuleSet,
	rulesDirOfFile,
	type ScriptRule,
	scriptPath,
} from "./policy.js";
import { runScripts } from "./scripts.js";

const SAMPLE_ROOT = "/sample";

async function codeRuleProblems(set: Pick<RuleSet, "dir">, rule: CodeRule, proposed?: string): Promise<string[]> {
	const name = `rule ${rule.grit}`;
	if (typeof rule.grit !== "string" || !rule.grit.endsWith(".grit"))
		return [`${name}: "grit" names the rule's .grit file in the rules directory`];
	const onDisk = gritPath(set, rule);
	if (proposed === undefined && !existsSync(onDisk)) return [`${name}: ${rule.grit} does not exist`];
	if (typeof rule.message !== "string" || !rule.message.trim())
		return [`${name}: give it a "message" that tells the agent what to do instead`];
	if (typeof rule.fires !== "string" || typeof rule.passes !== "string")
		return [`${name}: give it a "fires" sample it must flag and a "passes" sample it must allow`];
	const query = proposed ?? readFileSync(onDisk, "utf8");
	const [fires, passes] = await runRules([
		{ query, path: `sample/${rule.grit}`, content: rule.fires },
		{ query, path: `sample/${rule.grit}`, content: rule.passes },
	]);
	const failure = fires!.failure ?? passes!.failure;
	if (failure) return [`${name} does not run: ${failure}`];
	const problems: string[] = [];
	if (!fires!.lines.length)
		problems.push(
			`${name} does not flag its "fires" sample. A query that does not compile also matches nothing; check its syntax and its \`language\` line.`,
		);
	if (passes!.lines.length) problems.push(`${name} flags its "passes" sample at line ${passes!.lines.join(", ")}`);
	return problems;
}

function actionProblems(action: ActionRule): string[] {
	const name = `action ${action.id}`;
	let pattern: RegExp;
	try {
		pattern = new RegExp(action.pattern);
	} catch (error) {
		return [`${name}: pattern does not compile: ${(error as Error).message}`];
	}
	if (typeof action.fires !== "string" || typeof action.passes !== "string")
		return [`${name}: give it a "fires" command it must refuse and a "passes" command it must allow`];
	const problems: string[] = [];
	if (!pattern.test(action.fires)) problems.push(`${name} does not refuse its "fires" command`);
	if (pattern.test(action.passes)) problems.push(`${name} refuses its "passes" command`);
	return problems;
}

export function sampleEvent(on: ScriptRule["on"], sample: unknown): RuleEvent | string {
	if (!sample || typeof sample !== "object") return "a sample is an object";
	const value = sample as Record<string, unknown>;
	if (on === "edit") {
		if (typeof value.path !== "string") return "an edit sample needs a path";
		const content = typeof value.content === "string" ? value.content : null;
		const added = Array.isArray(value.added) ? value.added.map(String) : content === null ? [] : [content];
		const tool = typeof value.tool === "string" ? value.tool : "write";
		return editEvent(tool, join(SAMPLE_ROOT, value.path), SAMPLE_ROOT, content, added);
	}
	const asCall = (each: unknown, index: number): RecordedCall | string => {
		const call = each as { tool?: unknown; input?: unknown } | undefined;
		if (!call || typeof call.tool !== "string") return "a call sample needs a tool";
		const input = call.input && typeof call.input === "object" ? (call.input as Record<string, unknown>) : {};
		return { id: `sample-${index}`, name: call.tool, arguments: input };
	};
	const self = asCall(value, 0);
	if (typeof self === "string") return self;
	if (value.nested === true && Array.isArray(value.batch) && value.batch.length)
		return "a nested call sample has no batch: a nested call sees only itself";
	const siblings = Array.isArray(value.batch) ? value.batch.map((each, index) => asCall(each, index + 1)) : [];
	const broken = siblings.find((each) => typeof each === "string");
	if (typeof broken === "string") return broken;
	return callEvent(self, [self, ...(siblings as RecordedCall[])], SAMPLE_ROOT, SAMPLE_ROOT, value.nested === true);
}

async function scriptProblems(set: Pick<RuleSet, "dir">, rule: ScriptRule, proposed?: string): Promise<string[]> {
	const name = `script ${rule.id}`;
	if (typeof rule.id !== "string" || !rule.id.trim()) return ['a script rule needs an "id"'];
	if (rule.on !== "call" && rule.on !== "edit") return [`${name}: "on" is "call" or "edit"`];
	if (typeof rule.script !== "string" || !rule.script.endsWith(".js"))
		return [`${name}: "script" names its .js file in the rules directory`];
	const onDisk = scriptPath(set, rule);
	if (proposed === undefined && !existsSync(onDisk)) return [`${name}: ${rule.script} does not exist`];
	if (!Array.isArray(rule.fires) || !rule.fires.length || !Array.isArray(rule.passes) || !rule.passes.length)
		return [`${name}: give it "fires" events it must refuse and "passes" events it must allow`];
	const samples = [...rule.fires, ...rule.passes].map((sample) => sampleEvent(rule.on, sample));
	const invalid = samples.find((sample) => typeof sample === "string");
	if (typeof invalid === "string") return [`${name}: ${invalid}`];
	const body = proposed ?? readFileSync(onDisk, "utf8");
	const outcomes = await runScripts([{ id: rule.id, on: rule.on, body }], samples as RuleEvent[]);
	const problems: string[] = [];
	for (const [index, row] of outcomes.entries()) {
		const outcome = row.get(rule.id);
		const fires = index < rule.fires.length;
		const label = fires ? `"fires" sample ${index + 1}` : `"passes" sample ${index - rule.fires.length + 1}`;
		if (!outcome) problems.push(`${name} did not run on its ${label}`);
		else if ("error" in outcome) problems.push(`${name} fails on its ${label}: ${outcome.error}`);
		else if (fires && !outcome.reasons.length) problems.push(`${name} does not refuse its ${label}`);
		else if (!fires && outcome.reasons.length)
			problems.push(`${name} refuses its ${label}: ${outcome.reasons.join("; ")}`);
	}
	return problems;
}

async function policyProblems(set: Pick<RuleSet, "dir">, policy: RulePolicy, changed?: string, proposed?: string) {
	const grit = (policy.rules ?? []).filter((rule) => !changed || rule.grit === changed);
	const scripts = (policy.scripts ?? []).filter((rule) => !changed || rule.script === changed);
	const ids = [...(policy.actions ?? []).map((action) => action.id), ...(policy.scripts ?? []).map((rule) => rule.id)];
	const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
	const problems = [
		...(duplicate === undefined ? [] : [`two rules share the id ${duplicate}`]),
		...(await Promise.all(grit.map((rule) => codeRuleProblems(set, rule, proposed)))).flat(),
		...(await Promise.all(scripts.map((rule) => scriptProblems(set, rule, proposed)))).flat(),
	];
	if (!changed) problems.push(...(policy.actions ?? []).flatMap(actionProblems));
	return problems;
}

export async function ruleFileRefusal(path: string, proposed: string): Promise<string | undefined> {
	const found = rulesDirOfFile(path);
	if (!found) return undefined;
	const set = loadRuleSet(found);
	const name = basename(path);
	let problems: string[];
	if (name === "policy.json") {
		let policy: RulePolicy;
		try {
			policy = JSON.parse(proposed) as RulePolicy;
		} catch (error) {
			return `Refused: ${path} is not valid JSON: ${(error as Error).message}`;
		}
		problems = await policyProblems(set, policy);
	} else if (name.endsWith(".grit") || name.endsWith(".js")) {
		problems = await policyProblems(set, set.policy, name, proposed);
	} else return undefined;
	if (!problems.length) return undefined;
	return `Refused: a rule must load, refuse its "fires" samples and allow its "passes" samples (${join(set.dir, "policy.json")}).\n${problems.join("\n")}`;
}
