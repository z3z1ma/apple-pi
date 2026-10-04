import type { Candidate, Enumeration } from "./plan.js";

/** The scorer schema as the author and the reviewer read it (spec 7.1). */
export const SCORER_SCHEMA = `{
  version: 1;
  goal: string;                                  // the goal as you understand it
  files: { path: string; content: string }[];    // repo-relative; written before the checks run
  protect: string[];                             // repo-relative; restored to their current content before the checks run
  gates: {
    id: string;                                  // unique, matches /^[a-z0-9_-]+$/, not "diff_size"
    run: string;                                 // shell command, run with bash -lc in the repository root
    onBase: "fail" | "pass";                     // its result on the repository as it is now
    timeoutSec: number;
  }[];                                           // at least one
  objectives: {
    id: string;
    run: string;                                 // the last non-empty stdout line must be one finite number
    better: "lower" | "higher";
    timeoutSec: number;
    serial?: boolean;                            // run alone, after every other check
    repeat?: number;                             // runs per measurement; the median counts
  }[];
}`;

/** Spec 10.1. */
export function authorPrompt(goal: string | undefined, seedGate?: string): string {
	const seed =
		seedGate === undefined
			? ""
			: `\nThe command \`${seedGate}\` failed repeatedly. Use it as a gate with onBase "fail" if it expresses the goal.`;
	return `Branch search: acceptance checks.

Several independent attempts will implement the current task, each in an isolated copy of this repository. None of them will ever see what you write here. Your checks decide which attempt wins.

Goal: ${goal ?? "Infer the goal from the conversation and state it in the spec."}${seed}

You are working in a disposable copy of the repository at its current state. Use it to read code and to try your checks.

Write the spec with these rules:
1. Gates are shell commands that exit 0 for an acceptable result. Use onBase "fail" for a gate that detects the missing behavior. Use onBase "pass" for a gate that protects behavior that already works.
2. Test behavior only through interfaces that already exist or that the goal names exactly: public functions and modules, CLI commands, HTTP routes, existing test entry points. Attempts can only match names they can know.
3. Put new test code in "files". The harness writes these files into each attempt's copy before it runs the checks. List existing files that your checks depend on in "protect". The harness restores them to their current content before it runs the checks.
4. Objectives are shell commands whose last line of stdout is one number. Add them only when the goal values something measurable beyond correctness, such as speed or size. Order them by importance. Set "better" to "lower" or "higher". For timings, set "serial": true and set "repeat" to the number of runs whose median counts.
5. Give every command a "timeoutSec" well above its expected run time.
6. Run every check here and confirm that each result matches what you declared.

Reply with only the JSON object, matching this schema:
${SCORER_SCHEMA}`;
}

/** The validation report goes back to the author as a new message in its own conversation (spec 6.3). */
export function authorRetryPrompt(report: string): string {
	return `The harness could not use that spec:
${report}

Correct the spec and reply with only the corrected JSON object.`;
}

/** Spec 10.5. */
export function reviewPrompt(input: { goal: string; seedGate?: string; diffStat: string; spec: string }): string {
	return `Review an acceptance spec for an automated search. Several attempts will implement the goal without seeing the spec. Check three things:
1. Every gate with onBase "fail" detects the goal itself, and a correct implementation would pass it.
2. Every gate uses only interfaces that exist in the repository or that the goal names exactly.
3. The gates together reject plausible wrong implementations.

Goal: ${input.goal}
Seed gate: ${input.seedGate ?? "none"}
Changed files at base: ${input.diffStat === "" ? "none" : `\n${input.diffStat}`}
Spec: ${input.spec}

The spec follows this schema:
${SCORER_SCHEMA}

Reply with only JSON: {"verdict":"confirm"} or {"verdict":"refine","reason":"...","spec":{...}}`;
}

export type ReviewVerdict = { verdict: "confirm" } | { verdict: "refine"; reason: string; spec: unknown };

/** The reviewer's verdict, or why the reply cannot be used. */
export function parseReview(reply: string): ReviewVerdict | string {
	const parsed = parseJson(reply);
	if (parsed === undefined) return "it is not valid JSON";
	const value = parsed as { verdict?: unknown; reason?: unknown; spec?: unknown };
	if (value?.verdict === "confirm") return { verdict: "confirm" };
	if (value?.verdict !== "refine") return 'its verdict is neither "confirm" nor "refine"';
	if (typeof value.spec !== "object" || value.spec === null) return "a refine verdict needs a spec";
	return { verdict: "refine", reason: typeof value.reason === "string" ? value.reason : "", spec: value.spec };
}

/** A reply's JSON value, with or without a Markdown fence; undefined when it does not parse. */
export function parseJson(reply: string): unknown {
	try {
		return JSON.parse(stripFence(reply));
	} catch {
		return undefined;
	}
}

/** Spec 10.2. */
/** The goal the user stated for the search, if any, as a prompt line (after the fork point). */
function goalLine(goal: string | undefined): string {
	return goal === undefined ? "" : `Goal: ${goal}\n\n`;
}

export function enumeratorPrompt(count: number, goal?: string): string {
	return `Branch search: approach list.

${goalLine(goal)}List ${count} distinct approaches to the current task. Make each approach differ from the others in mechanism, in where the change happens, or in strategy, so that every attempt explores a different direction. Include approaches you consider unlikely to be best; an independent process decides which ones run.

For each approach, give a one-paragraph description and the first concrete action an engineer would take. After the list, give the id of the approach you would choose yourself.

Reply with only JSON:
{"candidates":[{"id":"c1","approach":"...","firstStep":"..."}],"preferred":"c1"}`;
}

export function enumeratorRetryPrompt(problem: string): string {
	return `That reply could not be used: ${problem}. Reply with only the JSON object in the requested shape, with at least two candidates.`;
}

/** Spec 10.3. */
export function rootDirective(branchId: string, candidate: Candidate, constraint: string, goal?: string): string {
	const constraintLine = constraint === "none" ? "" : `\nConstraint: ${constraint}`;
	return `Branch search: attempt ${branchId}.

You are one of several independent attempts at the current task. This attempt has its own copy of the repository, so your changes affect only this attempt.

${goalLine(goal)}Approach: ${candidate.approach}
First action: ${candidate.firstStep}${constraintLine}

Commit fully to this approach. Work until the task is complete under it, or until you have concrete evidence that it cannot work. Make reasonable decisions on your own; the user is away. Hidden acceptance checks will judge the final state of the repository.

End your final message with exactly these two lines:
result: done | abandoned
learned: <one sentence about what this attempt revealed>`;
}

function stripFence(text: string): string {
	const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(text.trim());
	return fenced ? (fenced[1] as string) : text.trim();
}

function isText(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}

/** The enumerator's reply as an enumeration, or the reason it cannot be used (spec 6.4). */
export function parseEnumeration(key: string, reply: string): Enumeration | string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stripFence(reply));
	} catch {
		return "it is not valid JSON";
	}
	const value = parsed as { candidates?: unknown; preferred?: unknown };
	if (!Array.isArray(value?.candidates)) return "it has no candidates list";
	const candidates: Candidate[] = [];
	for (const entry of value.candidates as Record<string, unknown>[]) {
		if (!isText(entry?.id) || !isText(entry.approach) || !isText(entry.firstStep))
			return "every candidate needs an id, an approach, and a firstStep";
		if (candidates.some((candidate) => candidate.id === entry.id)) return `candidate id ${entry.id} repeats`;
		candidates.push({ id: entry.id, approach: entry.approach, firstStep: entry.firstStep });
	}
	if (candidates.length < 2) return "it has fewer than two candidates";
	if (!isText(value.preferred)) return "it names no preferred candidate";
	return { key, candidates, preferred: value.preferred };
}

export type SelfReport = "done" | "abandoned" | "unknown";

/** The `result:` and `learned:` lines of a branch's final message (spec 6.6 step 6). */
export function parseSelfReport(text: string): { selfReport: SelfReport; learned: string | null } {
	const result = /^\s*result:\s*(done|abandoned)\s*$/im.exec(text);
	const learned = /^\s*learned:\s*(.+?)\s*$/im.exec(text);
	return {
		selfReport: result ? (result[1]?.toLowerCase() as SelfReport) : "unknown",
		learned: learned ? (learned[1] as string) : null,
	};
}
