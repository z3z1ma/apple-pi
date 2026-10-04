import type { Candidate, Enumeration } from "./plan.js";

/** Spec 10.2. */
export function enumeratorPrompt(count: number): string {
	return `Branch search: approach list.

List ${count} distinct approaches to the current task. Make each approach differ from the others in mechanism, in where the change happens, or in strategy, so that every attempt explores a different direction. Include approaches you consider unlikely to be best; an independent process decides which ones run.

For each approach, give a one-paragraph description and the first concrete action an engineer would take. After the list, give the id of the approach you would choose yourself.

Reply with only JSON:
{"candidates":[{"id":"c1","approach":"...","firstStep":"..."}],"preferred":"c1"}`;
}

export function enumeratorRetryPrompt(problem: string): string {
	return `That reply could not be used: ${problem}. Reply with only the JSON object in the requested shape, with at least two candidates.`;
}

/** Spec 10.3. */
export function rootDirective(branchId: string, candidate: Candidate, constraint: string): string {
	const constraintLine = constraint === "none" ? "" : `\nConstraint: ${constraint}`;
	return `Branch search: attempt ${branchId}.

You are one of several independent attempts at the current task. This attempt has its own copy of the repository, so your changes affect only this attempt.

Approach: ${candidate.approach}
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
