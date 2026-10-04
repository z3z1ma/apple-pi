import type { Judge } from "./judge.js";

export interface Candidate {
	id: string;
	approach: string;
	firstStep: string;
}

/** How the attempts are judged, as the enumerator and each attempt read it. */
function judging(judges: readonly Judge[], gates: readonly string[]): string {
	const lines = [
		"Each attempt is judged in its own copy of the repository, in this order:",
		...gates.map((gate) => `- gate (must exit 0): \`${gate}\``),
		...judges.map(
			({ command, better }) => `- judge (last stdout line is a number, ${better} is better): \`${command}\``,
		),
		"Among attempts that pass every gate, the best judge numbers win, in the order listed.",
	];
	return lines.join("\n");
}

function goalLine(goal: string): string {
	return `Goal: ${goal}`;
}

export function enumeratorPrompt(
	count: number,
	goal: string,
	judges: readonly Judge[],
	gates: readonly string[],
): string {
	return `Branch search: approach list.

${goalLine(goal)}

${judging(judges, gates)}

List ${count} distinct approaches to the goal. Make each approach differ from the others in mechanism, in where the change happens, or in strategy, so that every attempt explores a different direction. Put the approaches you expect to score best first.

For each approach, give a one-paragraph description and the first concrete action an engineer would take.

Reply with only JSON:
{"candidates":[{"id":"c1","approach":"...","firstStep":"..."}]}`;
}

export function enumeratorRetryPrompt(problem: string): string {
	return `That reply could not be used: ${problem}. Reply with only the JSON object in the requested shape.`;
}

export function attemptPrompt(
	key: string,
	candidate: Candidate,
	goal: string,
	judges: readonly Judge[],
	gates: readonly string[],
): string {
	return `Branch search: attempt ${key}.

You are one of several independent attempts at the goal. This attempt has its own copy of the repository, so your changes affect only this attempt.

${goalLine(goal)}
Approach: ${candidate.approach}
First action: ${candidate.firstStep}

${judging(judges, gates)}

Commit fully to this approach. Run the gates and judges yourself as you work. Make reasonable decisions on your own; the user is away. Stop when the work is done under this approach, or when you have concrete evidence that it cannot work.`;
}

/** The request to `judge.profile`: choose among attempts that passed every gate. */
export function choicePrompt(
	goal: string,
	judges: readonly Judge[],
	attempts: readonly { key: string; approach: string; values: (number | null)[]; diff: string }[],
): string {
	const shown = attempts.map(({ key, approach, values, diff }) => {
		const numbers = judges.map(({ command }, i) => `\`${command}\` = ${values[i]}`).join(", ");
		return `## Attempt ${key}\nApproach: ${approach}\nJudge values: ${numbers}\nDiff:\n\`\`\`diff\n${diff}\n\`\`\``;
	});
	return `Several independent attempts implemented the same goal. Each passed every acceptance gate. Choose the attempt you would merge, judging the quality of the change against the goal, with its judge values in mind (${judges.map(({ command, better }) => `\`${command}\`: ${better} is better`).join("; ")}).

${goalLine(goal)}

${shown.join("\n\n")}

Reply with only JSON: {"winner":"<attempt>","reason":"<one sentence>"}`;
}

function stripFence(text: string): string {
	const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(text.trim());
	return fenced ? (fenced[1] as string) : text.trim();
}

function parseJson(reply: string): unknown {
	try {
		return JSON.parse(stripFence(reply));
	} catch {
		return undefined;
	}
}

function isText(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}

/** The enumerator's reply as candidates, or the reason it cannot be used. */
export function parseCandidates(reply: string): Candidate[] | string {
	const value = parseJson(reply) as { candidates?: unknown } | undefined;
	if (value === undefined) return "it is not valid JSON";
	if (!Array.isArray(value?.candidates)) return "it has no candidates list";
	const candidates: Candidate[] = [];
	for (const entry of value.candidates as Record<string, unknown>[]) {
		if (!isText(entry?.id) || !isText(entry.approach) || !isText(entry.firstStep))
			return "every candidate needs an id, an approach, and a firstStep";
		if (candidates.some((candidate) => candidate.id === entry.id)) return `candidate id ${entry.id} repeats`;
		candidates.push({ id: entry.id, approach: entry.approach, firstStep: entry.firstStep });
	}
	if (candidates.length === 0) return "it lists no candidate";
	return candidates;
}

/** The judge model's choice among `keys`, or the reason its reply cannot be used. */
export function parseChoice(reply: string, keys: readonly string[]): { winner: string; reason: string } | string {
	const value = parseJson(reply) as { winner?: unknown; reason?: unknown } | undefined;
	if (value === undefined) return "it is not valid JSON";
	if (typeof value?.winner !== "string" || !keys.includes(value.winner))
		return `its winner is not one of ${keys.join(", ")}`;
	return { winner: value.winner, reason: typeof value.reason === "string" ? value.reason : "" };
}
