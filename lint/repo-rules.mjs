#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runRules } from "../components/repo-rules/src/grit.ts";
import { gritPath, loadRepoRules, rulesFor } from "../components/repo-rules/src/policy.ts";

const root = process.cwd();
const rules = loadRepoRules(root);
const queries = new Map();
const jobs = [];
const owners = [];
for (const file of execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
	encoding: "utf8",
})
	.split("\0")
	.filter(Boolean)) {
	const path = join(root, file);
	const matching = rulesFor(rules, path);
	if (!matching.length) continue;
	let content;
	try {
		content = readFileSync(path, "utf8");
	} catch {
		continue;
	}
	for (const rule of matching) {
		if (!queries.has(rule.grit)) queries.set(rule.grit, readFileSync(gritPath(root, rule), "utf8"));
		jobs.push({ query: queries.get(rule.grit), path: file, content });
		owners.push({ file, rule });
	}
}
const runs = await runRules(jobs);
let count = 0;
for (const [index, run] of runs.entries()) {
	const { file, rule } = owners[index];
	if (run.failure) {
		count++;
		console.log(`${file}: rule ${rule.grit} could not run: ${run.failure}`);
	}
	for (const line of run.lines) {
		count++;
		console.log(`${file}:${line}: ${rule.message} (${rule.grit})`);
	}
}
if (count) {
	console.log(`\n${count} repo-rule violations (.pi/rules/policy.json).`);
	process.exit(1);
}
console.log(`Repo rules passed: ${queries.size} rules over ${new Set(owners.map((owner) => owner.file)).size} files.`);
