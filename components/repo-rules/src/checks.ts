import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { runRules } from "./grit.js";
import { type ActionRule, type CodeRule, gritPath, loadRepoRules, RULES_DIR, type RulePolicy } from "./policy.js";

async function codeRuleProblems(root: string, rule: CodeRule, proposedGrit?: string): Promise<string[]> {
	const name = `rule ${rule.grit}`;
	if (typeof rule.grit !== "string" || !rule.grit.endsWith(".grit"))
		return [`${name}: "grit" names the rule's .grit file in ${RULES_DIR}`];
	const onDisk = gritPath(root, rule);
	if (proposedGrit === undefined && !existsSync(onDisk)) return [`${name}: ${RULES_DIR}/${rule.grit} does not exist`];
	if (typeof rule.message !== "string" || !rule.message.trim())
		return [`${name}: give it a "message" that tells the agent what to do instead`];
	if (typeof rule.fires !== "string" || typeof rule.passes !== "string")
		return [`${name}: give it a "fires" sample it must flag and a "passes" sample it must allow`];
	const query = proposedGrit ?? readFileSync(onDisk, "utf8");
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

async function policyProblems(root: string, policy: RulePolicy, changedPlugin?: string, grit?: string) {
	const rules = (policy.rules ?? []).filter((rule) => !changedPlugin || rule.grit === changedPlugin);
	const problems = (await Promise.all(rules.map((rule) => codeRuleProblems(root, rule, grit)))).flat();
	if (!changedPlugin) problems.push(...(policy.actions ?? []).flatMap(actionProblems));
	return problems;
}

export async function ruleFileRefusal(root: string, path: string, proposed: string): Promise<string | undefined> {
	if (dirname(path) !== join(root, RULES_DIR)) return undefined;
	const name = basename(path);
	let problems: string[];
	if (name === "policy.json") {
		let policy: RulePolicy;
		try {
			policy = JSON.parse(proposed) as RulePolicy;
		} catch (error) {
			return `Refused: ${RULES_DIR}/policy.json is not valid JSON: ${(error as Error).message}`;
		}
		problems = await policyProblems(root, policy);
	} else if (name.endsWith(".grit")) {
		problems = await policyProblems(root, loadRepoRules(root).policy, name, proposed);
	} else return undefined;
	if (!problems.length) return undefined;
	return `Refused: a rule must load, flag its "fires" sample and allow its "passes" sample (${RULES_DIR}/policy.json).\n${problems.join("\n")}`;
}
