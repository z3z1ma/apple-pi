import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import { canonical, within } from "../../shared/src/real-path.js";
import { git } from "./workspace.js";

/** The pre-registered acceptance spec (spec 7.1). */
export interface ScorerSpec {
	version: 1;
	goal: string;
	files: { path: string; content: string }[];
	protect: string[];
	gates: { id: string; run: string; onBase: "fail" | "pass"; timeoutSec: number }[];
	objectives: {
		id: string;
		run: string;
		better: "lower" | "higher";
		timeoutSec: number;
		serial?: boolean;
		repeat?: number;
	}[];
}

const ID = /^[a-z0-9_-]+$/;

function insideWorktree(path: string): boolean {
	if (typeof path !== "string" || path === "" || isAbsolute(path)) return false;
	const clean = normalize(path);
	return clean !== ".." && !clean.startsWith(`..${sep}`) && !path.split(/[\\/]/).includes("..");
}

/** The structural rules of spec 7.1; an empty list means the spec is well formed. */
export function checkScorerSpec(spec: ScorerSpec): string[] {
	const problems: string[] = [];
	if (!Array.isArray(spec.gates) || spec.gates.length === 0) problems.push("the spec needs at least one gate");
	const seen = new Set<string>();
	for (const { id } of [...(spec.gates ?? []), ...(spec.objectives ?? [])]) {
		if (id === "diff_size") problems.push(`id "diff_size" is reserved`);
		else if (typeof id !== "string" || !ID.test(id)) problems.push(`id "${id}" must match ${ID}`);
		else if (seen.has(id)) problems.push(`id "${id}" is used twice`);
		seen.add(id);
	}
	for (const { path } of spec.files ?? [])
		if (!insideWorktree(path)) problems.push(`file path "${path}" must stay inside the worktree`);
	for (const path of spec.protect ?? [])
		if (!insideWorktree(path)) problems.push(`protected path "${path}" must stay inside the worktree`);
	return problems;
}

/**
 * Write the scorer's files, then restore protected paths to base, so a protected path always holds base
 * content (spec 7.3). A destination that a symlink in the branch's tree leads outside the worktree is
 * refused before anything is written; the returned reason then fails every gate.
 */
export async function installScorer(worktree: string, base: string, spec: ScorerSpec): Promise<string | undefined> {
	const root = canonical(worktree);
	const outside = (path: string) => !within(canonical(join(worktree, path)), root);
	for (const path of spec.protect) if (outside(path)) return `protected path ${path} leads outside the worktree`;
	for (const file of spec.files) {
		if (outside(file.path)) return `scorer file ${file.path} leads outside the worktree`;
		const target = join(worktree, file.path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, file.content);
	}
	if (spec.protect.length > 0) await git(worktree, ["checkout", base, "--", ...spec.protect]);
	return undefined;
}

export interface CommandResult {
	exitCode: number | null;
	timedOut: boolean;
	stdout: string;
	stderr: string;
	ms: number;
}

/** Each command keeps this much of the end of its stdout and of its stderr (spec 7.2). */
export const OUTPUT_TAIL_BYTES = 64 * 1024;

/** Collects a stream, keeping only its last OUTPUT_TAIL_BYTES bytes. */
function tail() {
	let kept = Buffer.alloc(0);
	return {
		add(chunk: Buffer) {
			kept = Buffer.concat([kept, chunk]);
			if (kept.length > OUTPUT_TAIL_BYTES) kept = kept.subarray(kept.length - OUTPUT_TAIL_BYTES);
		},
		text: () => kept.toString("utf8"),
	};
}

/**
 * Run a scorer command with `bash -lc` in the worktree root (spec 7.2). The command gets
 * its own process group, which a timeout or the search's abort signal kills whole. When the
 * command settles, anything it left running in that group is killed too.
 */
export function runCommand(
	command: string,
	cwd: string,
	timeoutSec: number,
	env: NodeJS.ProcessEnv,
	signal?: AbortSignal,
): Promise<CommandResult> {
	const started = Date.now();
	return new Promise((resolvePromise, reject) => {
		const child = spawn("bash", ["-lc", command], {
			cwd,
			env: { ...process.env, ...env },
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const [stdout, stderr] = [tail(), tail()];
		let timedOut = false;
		child.stdout.on("data", stdout.add);
		child.stderr.on("data", stderr.add);
		const kill = () => {
			try {
				if (child.pid) process.kill(-child.pid, "SIGKILL");
			} catch {
				// The group already exited.
			}
		};
		const timer = setTimeout(() => {
			timedOut = true;
			kill();
		}, timeoutSec * 1000);
		signal?.addEventListener("abort", kill, { once: true });
		// An abort that fired before the listener existed would otherwise be missed.
		if (signal?.aborted) kill();
		const settle = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", kill);
			kill();
		};
		child.on("error", (error) => {
			settle();
			reject(error);
		});
		child.on("close", (exitCode) => {
			settle();
			resolvePromise({ exitCode, timedOut, stdout: stdout.text(), stderr: stderr.text(), ms: Date.now() - started });
		});
	});
}

export interface GateResult {
	id: string;
	result: "pass" | "fail" | "timeout";
	exitCode: number | null;
	stdout: string;
	stderr: string;
	ms: number;
}

/** Run every gate in order. A gate passes only when it exits 0 within its timeout. */
export async function runGates(
	worktree: string,
	spec: ScorerSpec,
	searchId: string,
	signal?: AbortSignal,
): Promise<GateResult[]> {
	const env = { CI: "1", APPLE_PI_BRANCH_SEARCH: searchId };
	const results: GateResult[] = [];
	for (const gate of spec.gates) {
		signal?.throwIfAborted();
		const run = await runCommand(gate.run, worktree, gate.timeoutSec, env, signal);
		const result = run.timedOut ? "timeout" : run.exitCode === 0 ? "pass" : "fail";
		results.push({ id: gate.id, result, exitCode: run.exitCode, stdout: run.stdout, stderr: run.stderr, ms: run.ms });
	}
	return results;
}

export interface DiffStat {
	added: number;
	deleted: number;
	files: number;
}

/** `git diff --numstat` totals; binary rows count as 0 lines. `diff_size` is added + deleted (spec 7.4). */
export async function diffStat(root: string, from: string, to: string): Promise<DiffStat> {
	const rows = (await git(root, ["diff", "--numstat", from, to])).split("\n").filter(Boolean);
	const count = (value: string | undefined) => (value === undefined || value === "-" ? 0 : Number(value));
	let added = 0;
	let deleted = 0;
	for (const row of rows) {
		const [plus, minus] = row.split("\t");
		added += count(plus);
		deleted += count(minus);
	}
	return { added, deleted, files: rows.length };
}
