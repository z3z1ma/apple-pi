#!/usr/bin/env node
// Prompt-cache audit over Pi session logs.
//   node scripts/cache-audit.mjs [substring] [--turns]
// Healthy after turn 2: cacheRead ≈ previous turn's total, cacheWrite ≈ new content only.
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const SESSIONS = join(homedir(), ".pi", "agent", "sessions");
const filter = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "";
const perTurn = process.argv.includes("--turns");

function sessionFiles(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sessionFiles(path);
		return entry.name.endsWith(".jsonl") && path.includes(filter) ? [path] : [];
	});
}

function turns(file) {
	return readFileSync(file, "utf8")
		.split("\n")
		.flatMap((line) => {
			try {
				const entry = JSON.parse(line);
				const message = entry.type === "message" ? entry.message : undefined;
				return message?.role === "assistant" && message.usage ? [message] : [];
			} catch {
				return [];
			}
		});
}

const fmt = (n) => Math.round(n).toLocaleString("en-US");
const rows = [];
for (const file of sessionFiles(SESSIONS)) {
	const usage = turns(file).map((m) => ({ ...m.usage, model: m.model }));
	if (usage.length === 0) continue;
	const sum = (key) => usage.reduce((total, u) => total + (u[key] ?? 0), 0);
	const prompt = sum("input") + sum("cacheRead") + sum("cacheWrite");
	rows.push({
		file,
		turns: usage.length,
		rewrites: usage.filter((u) => (u.cacheWrite ?? 0) > (u.cacheRead ?? 0)).length,
		input: sum("input"),
		cacheRead: sum("cacheRead"),
		cacheWrite: sum("cacheWrite"),
		hit: prompt ? (sum("cacheRead") / prompt) * 100 : 0,
		cost: usage.reduce((total, u) => total + (u.cost?.total ?? 0), 0),
		models: [...new Set(usage.map((u) => u.model))].join(","),
		usage,
	});
}
rows.sort((a, b) => b.cost - a.cost);

for (const row of rows) {
	console.log(
		`${basename(row.file).slice(0, 19)}  turns=${row.turns}  rewrite-turns=${row.rewrites}  hit=${row.hit.toFixed(0)}%  ` +
			`uncached=${fmt(row.input)}  read=${fmt(row.cacheRead)}  write=${fmt(row.cacheWrite)}  cost=$${row.cost.toFixed(2)}  ${row.models}`,
	);
	if (!perTurn) continue;
	row.usage.forEach((u, index) => {
		console.log(
			`   ${String(index + 1).padStart(4)}  read=${fmt(u.cacheRead ?? 0).padStart(9)}  write=${fmt(u.cacheWrite ?? 0).padStart(9)}  ` +
				`uncached=${fmt(u.input ?? 0).padStart(7)}  out=${fmt(u.output ?? 0).padStart(6)}  $${(u.cost?.total ?? 0).toFixed(3)}`,
		);
	});
}
