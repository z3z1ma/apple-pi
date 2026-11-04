import { existsSync, readFileSync } from "node:fs";
import { dirname, join, matchesGlob, relative } from "node:path";

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

export interface RulePolicy {
	comments?: "forbid";
	rules?: CodeRule[];
	actions?: ActionRule[];
}

export interface RepoRules {
	root: string;
	policy: RulePolicy;
}

export function rulesRootOf(path: string): string | undefined {
	for (let dir = dirname(path); ; dir = dirname(dir)) {
		if (existsSync(join(dir, RULES_DIR))) return dir;
		if (dirname(dir) === dir) return undefined;
	}
}

export function policyPath(root: string): string {
	return join(root, RULES_DIR, "policy.json");
}

export function gritPath(root: string, rule: CodeRule): string {
	return join(root, RULES_DIR, rule.grit);
}

export function loadRepoRules(root: string): RepoRules {
	const file = policyPath(root);
	const policy = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as RulePolicy) : {};
	return { root, policy };
}

export function rulesFor(rules: RepoRules, path: string): CodeRule[] {
	const relativePath = relative(rules.root, path);
	return (rules.policy.rules ?? []).filter((rule) => {
		const globs = rule.includes ?? [];
		const wanted = globs.filter((glob) => !glob.startsWith("!"));
		const unwanted = globs.filter((glob) => glob.startsWith("!")).map((glob) => glob.slice(1));
		return (
			(!wanted.length || wanted.some((glob) => matchesGlob(relativePath, glob))) &&
			!unwanted.some((glob) => matchesGlob(relativePath, glob))
		);
	});
}
