import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, matchesGlob, relative } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { canonical } from "../../shared/src/session-logs.js";

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

export interface RulesDir {
	level: "project" | "user";
	root: string;
	dir: string;
}

export interface RuleSet extends RulesDir {
	policy: RulePolicy;
	error?: string;
}

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

export function rulesDirsFor(path: string): RulesDir[] {
	const dirs: RulesDir[] = [];
	const user = userRulesDir();
	if (existsSync(policyPath(user))) dirs.push({ level: "user", root: user, dir: user });
	const root = rulesRootOf(path);
	if (root) dirs.push({ level: "project", root, dir: join(root, RULES_DIR) });
	return dirs;
}

export function loadRuleSet(found: RulesDir): RuleSet {
	const file = policyPath(found.dir);
	if (!existsSync(file)) return { ...found, policy: {} };
	try {
		return { ...found, policy: JSON.parse(readFileSync(file, "utf8")) as RulePolicy };
	} catch (error) {
		return { ...found, policy: {}, error: `${file} does not load: ${(error as Error).message}` };
	}
}

export function loadRepoRules(root: string): RuleSet {
	const set = loadRuleSet({ level: "project", root, dir: join(root, RULES_DIR) });
	if (set.error) throw new Error(set.error);
	return set;
}

export function ruleSetsFor(path: string): RuleSet[] {
	return rulesDirsFor(path).map(loadRuleSet);
}

export function rulesDirOfFile(path: string): RulesDir | undefined {
	const dir = dirname(canonical(path));
	const user = userRulesDir();
	if (dir === canonical(user)) return { level: "user", root: user, dir: user };
	if (basename(dir) === "rules" && basename(dirname(dir)) === ".pi")
		return { level: "project", root: dirname(dirname(dir)), dir };
	return undefined;
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
