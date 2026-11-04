import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const RUNNER = fileURLToPath(new URL("./grit-runner.mjs", import.meta.url));

export interface RuleJob {
	query: string;
	path: string;
	content: string;
}

export interface RuleRun {
	lines: number[];
	failure?: string;
}

export async function runRules(jobs: RuleJob[]): Promise<RuleRun[]> {
	if (!jobs.length) return [];
	const { stdout, stderr, code } = await new Promise<{ stdout: string; stderr: string; code: number | null }>(
		(resolve, reject) => {
			const child = spawn(process.execPath, [RUNNER], { stdio: ["pipe", "pipe", "pipe"] });
			let out = "";
			let err = "";
			child.stdout.on("data", (chunk) => (out += chunk));
			child.stderr.on("data", (chunk) => (err += chunk));
			child.once("error", reject);
			child.once("close", (exit) => resolve({ stdout: out, stderr: err, code: exit }));
			child.stdin.end(JSON.stringify({ jobs }));
		},
	);
	let results: ({ matches: { line: number }[] } | { error: string })[];
	try {
		results = JSON.parse(stdout);
	} catch {
		const failure = `the GritQL engine did not run (exit ${code}): ${stderr.trim().slice(0, 400)}`;
		return jobs.map(() => ({ lines: [], failure }));
	}
	return results.map((result) =>
		"error" in result ? { lines: [], failure: result.error } : { lines: result.matches.map((match) => match.line) },
	);
}
