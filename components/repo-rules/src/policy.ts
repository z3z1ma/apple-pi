import { existsSync, readFileSync } from "node:fs";
import { dirname, join, matchesGlob, relative } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const RULES_DIR = join(".pi", "rules");

export interface ActionRule {
	id: string;
	pattern: string;
	reason: string;
	fires?: string;
	passes?: string;
}

export interface CodeRule {
	grit: string;
	message: string;
	includes?: string[];
	fires?: string;
	passes?: string;
}

export interface ScriptRule {
	id: string;
	on: "call" | "edit";
	script: string;
	message?: string;
	includes?: string[];
	fires?: unknown[];
	passes?: unknown[];
}

export interface RulePolicy {
	comments?: "forbid";
	rules?: CodeRule[];
	actions?: ActionRule[];
	scripts?: ScriptRule[];
}

export interface RuleSet {
	level: "project" | "user";
	root: string;
	dir: string;
	policy: RulePolicy;
}

export type RepoRules = RuleSet;

export function rulesRootOf(path: string): string | undefined {
	for (let dir = dirname(path); ; dir = dirname(dir)) {
		if (existsSync(join(dir, RULES_DIR))) return dir;
		if (dirname(dir) === dir) return undefined;
	}
}

export function userRulesDir(): string {
	return join(getAgentDir(), "rules");
}

export function policyPath(dir: string): string {
	return join(dir, "policy.json");
}

export function gritPath(set: Pick<RuleSet, "dir">, rule: CodeRule): string {
	return join(set.dir, rule.grit);
}

export function scriptPath(set: Pick<RuleSet, "dir">, rule: ScriptRule): string {
	return join(set.dir, rule.script);
}

function readPolicy(dir: string): RulePolicy {
	const file = policyPath(dir);
	return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as RulePolicy) : {};
}

export function loadRepoRules(root: string): RuleSet {
	const dir = join(root, RULES_DIR);
	return { level: "project", root, dir, policy: readPolicy(dir) };
}

export function ruleSetsFor(path: string): RuleSet[] {
	const sets: RuleSet[] = [];
	const user = userRulesDir();
	if (existsSync(policyPath(user))) sets.push({ level: "user", root: user, dir: user, policy: readPolicy(user) });
	const root = rulesRootOf(path);
	if (root) sets.push(loadRepoRules(root));
	return sets;
}

export function includedBy(globs: string[] | undefined, relativePath: string): boolean {
	const wanted = (globs ?? []).filter((glob) => !glob.startsWith("!"));
	const unwanted = (globs ?? []).filter((glob) => glob.startsWith("!")).map((glob) => glob.slice(1));
	return (
		(!wanted.length || wanted.some((glob) => matchesGlob(relativePath, glob))) &&
		!unwanted.some((glob) => matchesGlob(relativePath, glob))
	);
}

export function rulesFor(rules: Pick<RuleSet, "root" | "policy">, path: string): CodeRule[] {
	const relativePath = relative(rules.root, path);
	return (rules.policy.rules ?? []).filter((rule) => includedBy(rule.includes, relativePath));
}
