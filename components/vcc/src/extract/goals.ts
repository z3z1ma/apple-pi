import { clip, nonEmptyLines } from "../core/content.js";
import { collapseSkillLines } from "../core/skill-collapse.js";
import type { NormalizedBlock } from "../types.js";

// Explicit pivot constructions only. Bare "actually" / "instead" / "let's do"
// fire on ordinary conversation and must not stamp [Scope change].
// "now <task-verb>" is a real pivot ("Now implement password reset").
const TASK_VERB =
	"fix|implement|add|create|build|refactor|debug|investigate|update|remove|delete|migrate|deploy|test|write|set up";

const SCOPE_CHANGE_RE = new RegExp(
	`\\b(?:change of plan|forget that|new task|switch to|now I want|pivot|now\\s+(?:please\\s+)?(?:${TASK_VERB}))\\b`,
	"i",
);

const TASK_RE = new RegExp(`\\b(?:${TASK_VERB})\\b`, "i");

const LEADING_TASK_RE = new RegExp(`^(?:please\\s+)?(?:${TASK_VERB})\\b`, "i");

const NOISE_SHORT_RE = /^(ok|yes|no|sure|yeah|yep|go|hi|hey|thx|thanks|ok\b.*|y|n|k)\s*[.!?]*$/i;

// Reject lines that are clearly not user goals (pasted output, code, paths, tool dumps)
// or meta-prompt boilerplate (command templates like `/issues` that start with "For each issue:"
// followed by numbered "Read the issue in full..." steps).
const NON_GOAL_RE =
	/^\s*[[│├└─╭╰]|```|^\s*(=[A-Z]+\(|function |const |let |var |import |export |class )|^(https?:|file:|\/[A-Za-z])|\\n|^\s*For each\b|\bin full\b[^\n]*\b(comments|issue|issues|PRs?|linked)\b/;

// Signals that the rest of the user message is a command template (e.g. /issues),
// in which case we should stop collecting goals at the signal line.
const TEMPLATE_SIGNAL_RE = /^\s*(For each\b|Do NOT implement\b|Analyze and propose\b|If Task\/context\b|Output:\s*$)/i;

const truncateAtTemplate = (lines: string[]): string[] => {
	const idx = lines.findIndex((l) => TEMPLATE_SIGNAL_RE.test(l));
	return idx >= 0 ? lines.slice(0, idx) : lines;
};

const stripLeadingBullet = (line: string): string => line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").trim();

const MAX_GOAL_CHARS = 200;

const isSubstantiveGoal = (text: string): boolean => {
	const t = text.trim();
	if (t.length <= 5) return false;
	if (t.length > MAX_GOAL_CHARS) return false;
	if (NOISE_SHORT_RE.test(t)) return false;
	if (NON_GOAL_RE.test(t)) return false;
	return true;
};

// Test scope-change / task intent only on the leading portion of a user block
// so that pasted outputs below the actual instruction do not trigger matches.
const LEADING_CHARS = 200;

const goalLinesOf = (text: string): string[] => {
	const rawLines = nonEmptyLines(text);
	const truncated = truncateAtTemplate(rawLines);
	return collapseSkillLines(truncated.filter(isSubstantiveGoal))
		.map(stripLeadingBullet)
		.filter((l) => l.length > 5);
};

/**
 * First user block: keep lines that carry a task verb. Leftover substantive
 * lines are not goals. If nothing matches, keep a single fallback line so a
 * session still has a heading.
 */
const firstBlockGoals = (lines: string[]): string[] => {
	const tasked = lines.filter((l) => TASK_RE.test(l));
	if (tasked.length > 0) return tasked.slice(0, 6).map((l) => clip(l, MAX_GOAL_CHARS));
	return [clip(lines[0], MAX_GOAL_CHARS)];
};

export const extractGoals = (blocks: NormalizedBlock[]): string[] => {
	const goals: string[] = [];
	const extras: string[] = [];
	let latestScopeChange: string[] | null = null;

	for (const b of blocks) {
		if (b.kind !== "user") continue;
		const lines = goalLinesOf(b.text);
		if (lines.length === 0) continue;

		if (goals.length === 0) {
			goals.push(...firstBlockGoals(lines));
			continue;
		}

		const leading = b.text.slice(0, LEADING_CHARS);
		if (SCOPE_CHANGE_RE.test(leading)) {
			const tasked = lines.filter((l) => TASK_RE.test(l));
			const picked = (tasked.length > 0 ? tasked : lines).slice(0, 3);
			latestScopeChange = picked.map((l) => clip(l, MAX_GOAL_CHARS));
			extras.length = 0;
			continue;
		}

		// Later task headlines become extra goals, not [Scope change].
		// Require the line to start with a task verb so "can you add a log"
		// is not promoted.
		if (extras.length >= 4) continue;
		for (const line of lines) {
			if (line.length > 15 && LEADING_TASK_RE.test(line)) {
				extras.push(clip(line, MAX_GOAL_CHARS));
				if (extras.length >= 4) break;
			}
		}
	}

	if (latestScopeChange && latestScopeChange.length > 0) {
		goals.push("[Scope change]", ...latestScopeChange);
	}
	if (extras.length > 0) {
		const seen = new Set(goals.map((g) => g.toLowerCase()));
		for (const extra of extras) {
			if (seen.has(extra.toLowerCase())) continue;
			goals.push(extra);
			seen.add(extra.toLowerCase());
		}
	}

	return goals.slice(0, 8);
};
