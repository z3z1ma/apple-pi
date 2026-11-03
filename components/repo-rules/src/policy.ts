import { existsSync, readFileSync } from "node:fs";
import { dirname, join, matchesGlob, relative } from "node:path";

export const RULES_DIR = join(".pi", "rules");

export interface ActionRule {
	id: string;
	pattern: string;
	reason: string;
}

export interface RulePolicy {
	comments?: "forbid";
	rules?: { plugin: string; includes?: string[] }[];
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

export function loadRepoRules(root: string): RepoRules {
	const file = join(root, RULES_DIR, "policy.json");
	const policy = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as RulePolicy) : {};
	return { root, policy };
}

export function pluginsFor(rules: RepoRules, path: string): string[] {
	const relativePath = relative(rules.root, path);
	return (rules.policy.rules ?? [])
		.filter((rule) => {
			const globs = rule.includes ?? [];
			const wanted = globs.filter((glob) => !glob.startsWith("!"));
			const unwanted = globs.filter((glob) => glob.startsWith("!")).map((glob) => glob.slice(1));
			return (
				(!wanted.length || wanted.some((glob) => matchesGlob(relativePath, glob))) &&
				!unwanted.some((glob) => matchesGlob(relativePath, glob))
			);
		})
		.map((rule) => join(rules.root, RULES_DIR, rule.plugin));
}
