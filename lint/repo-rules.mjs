#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { editEvent } from "../components/repo-rules/src/events.ts";
import { runRules } from "../components/repo-rules/src/grit.ts";
import { gritPath, includedBy, loadRepoRules, rulesFor, scriptPath } from "../components/repo-rules/src/policy.ts";
import { runScripts } from "../components/repo-rules/src/scripts.ts";

const SCRIPT_BATCH_BYTES = 8 << 20;

const root = process.cwd();
const rules = loadRepoRules(root);
const queries = new Map();
const jobs = [];
const owners = [];
const editScripts = (rules.policy.scripts ?? [])
	.filter((rule) => rule.on === "edit")
	.map((rule) => ({ ...rule, body: readFileSync(scriptPath(rules, rule), "utf8") }));
const scriptBatches = [[]];
let scriptBytes = 0;
for (const file of execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
	encoding: "utf8",
})
	.split("\0")
	.filter(Boolean)) {
	const path = join(root, file);
	const matching = rulesFor(rules, path);
	const scripted = editScripts.filter((rule) => includedBy(rule.includes, file));
	if (!matching.length && !scripted.length) continue;
	let content;
	try {
		content = readFileSync(path, "utf8");
	} catch {
		continue;
	}
	for (const rule of matching) {
		if (!queries.has(rule.grit)) queries.set(rule.grit, readFileSync(gritPath(rules, rule), "utf8"));
		jobs.push({ query: queries.get(rule.grit), path: file, content });
		owners.push({ file, rule });
	}
	if (!scripted.length) continue;
	scriptBatches.at(-1).push({ file, scripted, event: editEvent("write", path, root, content, [content]) });
	scriptBytes += content.length;
	if (scriptBytes >= SCRIPT_BATCH_BYTES) {
		scriptBatches.push([]);
		scriptBytes = 0;
	}
}
const runs = await runRules(jobs);
let count = 0;
const scriptFiles = new Set();
for (const batch of scriptBatches) {
	const rows = await runScripts(
		editScripts.map(({ id, on, body }) => ({ id, on, body })),
		batch.map((item) => item.event),
		new Map(editScripts.map((rule) => [rule.id, rule.message])),
	);
	for (const [index, row] of rows.entries()) {
		const { file, scripted } = batch[index];
		scriptFiles.add(file);
		for (const rule of scripted) {
			const outcome = row.get(rule.id);
			const problems = !outcome ? [] : "error" in outcome ? [`could not run: ${outcome.error}`] : outcome.reasons;
			for (const problem of problems) {
				count++;
				console.log(`${file}: ${problem} (${rule.id})`);
			}
		}
	}
}
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
const files = new Set([...owners.map((owner) => owner.file), ...scriptFiles]);
console.log(`Repo rules passed: ${queries.size + editScripts.length} rules over ${files.size} files.`);
