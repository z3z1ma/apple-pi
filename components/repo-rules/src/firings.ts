import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface Firing {
	count: number;
	last: string;
}

function firingsFile(): string {
	return join(getAgentDir(), "repo-rules", "firings.jsonl");
}

export function recordFirings(root: string, rules: string[]): void {
	if (!rules.length) return;
	const file = firingsFile();
	mkdirSync(dirname(file), { recursive: true });
	const at = new Date().toISOString();
	appendFileSync(file, rules.map((rule) => `${JSON.stringify({ root, rule, at })}\n`).join(""));
}

export function firingsIn(root: string): Map<string, Firing> {
	const counts = new Map<string, Firing>();
	const file = firingsFile();
	if (!existsSync(file)) return counts;
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (!line) continue;
		const entry = JSON.parse(line) as { root: string; rule: string; at: string };
		if (entry.root !== root) continue;
		const seen = counts.get(entry.rule);
		counts.set(entry.rule, { count: (seen?.count ?? 0) + 1, last: entry.at });
	}
	return counts;
}
