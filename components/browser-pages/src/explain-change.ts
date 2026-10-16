import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { type Static, Type } from "typebox";

import { commitOf, type RawLine, type RepoDiff, readBaseFile, readRepoDiff } from "./git-diff.js";
import { highlightLines } from "./highlight.js";
import { blocksOf, isObject, withDiagrams } from "./markdown-review.js";
import type { CodeExcerpt, ExplainChangePage, ExplainPart, Segment, TutorTurn } from "./page-data.js";
import { readTemplate } from "./saved-page.js";

export const EXPLAIN_CHANGE_TOOL_NAME = "explain_change";

const markdown = (description: string) => Type.String({ description });

export const ExplainChangeParamsSchema = Type.Object({
	title: Type.String({ description: "What the change does, as a headline" }),
	base: Type.Optional(
		Type.String({ description: "Git ref to compare with. Default HEAD: without `head`, the uncommitted changes" }),
	),
	head: Type.Optional(
		Type.String({
			description:
				"Commit to explain up to, for a past commit or range. The change runs from where `head` meets `base`, as a pull request shows it: `base` `X^` with `head` `X` is the single commit X. Omit to explain the working tree against `base`",
		}),
	),
	summary: markdown("The change in one minute: one short paragraph"),
	primer: Type.Optional(markdown("Deep background a reader new to this area needs; shown collapsed")),
	background: markdown("The existing system the change touches, as it was before"),
	intuition: markdown("The idea before the code: a concrete example with toy data, figures, and diagrams"),
	steps: Type.Array(
		Type.Object({
			title: Type.String(),
			body: markdown("Prose around the code it cites with `code path:FROM-TO` fences"),
		}),
		{ minItems: 1 },
	),
	quiz: Type.Array(
		Type.Object({
			question: Type.String(),
			options: Type.Array(Type.String(), { minItems: 3, maxItems: 4 }),
			answer: Type.Integer({ minimum: 0, description: "Index of the right option" }),
			why: Type.String({ description: "Why the right answer is right, naming the step that teaches it" }),
		}),
		{ minItems: 5, maxItems: 5 },
	),
});

export type ExplainChangeParams = Static<typeof ExplainChangeParamsSchema>;

const FENCE = /^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n?\1[ \t]*$/;
const REFERENCE = /^(.+?):(\d+)(?:-(\d+))?$/;

/** Removed lines keyed by the new-side line they stood before, and the new-side lines the change added. */
function marksOf(lines: RawLine[]) {
	const added = new Set<number>();
	const removed = new Map<number, RawLine[]>();
	let pending: RawLine[] = [];
	let last = 0;
	const place = (n: number) => {
		if (pending.length) removed.set(n, [...(removed.get(n) ?? []), ...pending]);
		pending = [];
	};
	for (const line of lines) {
		if (line.t === "-") {
			pending.push(line);
			continue;
		}
		place(line.n ?? last + 1);
		if (line.t === "+") added.add(line.n ?? 0);
		last = line.n ?? last;
	}
	place(last + 1);
	return { added, removed };
}

/** Reads `code path:FROM-TO` references against the change, with every file read and highlighted once. */
function excerpts(diff: RepoDiff, until: string | undefined) {
	const highlighted = new Map<string, Promise<Segment[][] | undefined>>();
	const lines = (key: string, path: string, read: () => Promise<string | undefined>) => {
		if (!highlighted.has(key))
			highlighted.set(
				key,
				read().then((text) => (text === undefined ? undefined : highlightLines(text.replace(/\r?\n$/, ""), path))),
			);
		return highlighted.get(key)!;
	};
	const after = (path: string) =>
		lines(`new:${path}`, path, () =>
			until ? readBaseFile(diff.root, until, path) : readFile(join(diff.root, path), "utf8").catch(() => undefined),
		);
	const before = (path: string) => lines(`old:${path}`, path, () => readBaseFile(diff.root, diff.baseCommit, path));

	return async (reference: string): Promise<CodeExcerpt | string> => {
		const match = REFERENCE.exec(reference);
		if (!match) return `\`${reference}\`: cite code as \`code path:FROM-TO\`.`;
		const [, path, a, b] = match;
		const from = Number(a);
		const to = Number(b ?? a);
		const file = diff.files.find((f) => f.path === path);
		// A file the change deletes has only its old lines, so its references count lines before the change.
		const gone = file?.status === "D" ? await before(path) : undefined;
		const now = gone ?? (await after(path));
		if (!now) return `\`${path}\` does not exist ${until ? `at ${until}` : "in the working tree"}.`;
		if (from < 1 || to < from || to > now.length) return `\`${reference}\`: \`${path}\` has ${now.length} lines.`;
		if (gone)
			return {
				path,
				from,
				to,
				status: "deleted",
				rows: gone.slice(from - 1, to).map((s, i) => ({ t: "-", n: from + i, s })),
			};
		const { added, removed } = marksOf(file?.hunks.flatMap((h) => h.lines) ?? []);
		const old = removed.size ? await before(file?.oldPath ?? path) : undefined;
		const rows: CodeExcerpt["rows"] = [];
		for (let n = from; n <= to; n++) {
			for (const r of removed.get(n) ?? []) rows.push({ t: "-", s: old?.[(r.o ?? 0) - 1] ?? [{ t: r.text }] });
			rows.push({ t: added.has(n) ? "+" : " ", n, s: now[n - 1] });
		}
		return { path, from, to, status: !file ? "unchanged" : file.status === "A" ? "new" : "changed", rows };
	};
}

/** A section's Markdown as parts: `code` fences become real excerpts and `figure` fences sandboxed figures. */
async function partsOf(
	source: string,
	excerpt: (reference: string) => Promise<CodeExcerpt | string>,
	warnings: string[],
): Promise<ExplainPart[]> {
	const parts: ExplainPart[] = [];
	for (const block of await blocksOf(source)) {
		const lang = block.code?.lang;
		const fence = lang === "code" || lang === "figure" ? FENCE.exec(block.raw) : null;
		const info = fence?.[2].trim().replace(/^\S+\s*/, "") ?? "";
		if (lang === "figure") parts.push({ figure: { caption: info, html: fence?.[3] ?? "" } });
		else if (lang === "code") {
			const found = await excerpt(info);
			if (typeof found === "string") warnings.push(found);
			parts.push(typeof found === "string" ? { missing: found } : { code: found });
		} else parts.push({ block });
	}
	return parts;
}

export async function buildExplainPage(
	params: ExplainChangeParams,
	cwd: string,
	token: string,
): Promise<{ page: ExplainChangePage; root: string; warnings: string[] }> {
	for (const [i, q] of params.quiz.entries())
		if (q.answer >= q.options.length)
			throw new Error(`Quiz question ${i + 1}: \`answer\` ${q.answer} is not one of its ${q.options.length} options.`);
	const base = params.base?.trim() || "HEAD";
	const until = params.head?.trim() || undefined;
	const diff = await readRepoDiff(cwd, base, until);
	const head = until ? await commitOf(diff.root, until) : undefined;
	if (until && !head) throw new Error(`\`${until}\` names no commit.`);
	const single = head && (await commitOf(diff.root, `${until}^`))?.hash === diff.baseCommit;
	const short = (hash: string) => hash.slice(0, 7);
	const ref = head
		? single
			? short(head.hash)
			: `${short(diff.baseCommit)}..${short(head.hash)}`
		: base === "HEAD"
			? "uncommitted changes"
			: `${base}…working tree`;

	const warnings: string[] = [];
	const excerpt = excerpts(diff, head?.hash);
	const parts = (source: string) => partsOf(source, excerpt, warnings);
	const steps = await Promise.all(params.steps.map(async (s) => ({ title: s.title, parts: await parts(s.body) })));
	const sections = {
		summary: await parts(params.summary),
		primer: params.primer?.trim() ? await parts(params.primer) : undefined,
		background: await parts(params.background),
		intuition: await parts(params.intuition),
	};
	const stats = diff.files.map((f) => {
		const lines = f.hunks.flatMap((h) => h.lines);
		return { path: f.path, add: lines.filter((l) => l.t === "+").length, del: lines.filter((l) => l.t === "-").length };
	});
	const cited = [sections.intuition, ...steps.map((s) => s.parts)]
		.flat()
		.flatMap((p) => ("code" in p && p.code.status !== "unchanged" ? [p.code.path] : []));
	return {
		page: {
			kind: "explain-change",
			title: params.title.trim(),
			ref,
			subject: single ? head.subject : undefined,
			stats,
			covered: [...new Set(cited)],
			...sections,
			steps,
			quiz: params.quiz.map((q) => ({ question: q.question, options: q.options, answer: q.answer, why: q.why })),
			createdAt: new Date().toISOString(),
			session: { token, live: true, ask: false },
		},
		root: diff.root,
		warnings,
	};
}

export async function explainTemplate(page: ExplainChangePage): Promise<string> {
	const all = [page.summary, page.primer ?? [], page.background, page.intuition, ...page.steps.map((s) => s.parts)];
	return withDiagrams(
		await readTemplate("explain-change"),
		all.flat().flatMap((p) => ("block" in p ? [p.block] : [])),
	);
}

// ---------------------------------------------------------------------------- the tutor in the sidebar

/** One turn the page sends, or undefined when it is malformed. */
export function parseTutorTurn(body: unknown, page: ExplainChangePage): TutorTurn | undefined {
	if (!isObject(body) || typeof body.message !== "string" || !body.message.trim()) return undefined;
	if (body.mode !== "socratic" && body.mode !== "direct") return undefined;
	if (!Array.isArray(body.thread)) return undefined;
	const thread: TutorTurn["thread"] = [];
	for (const m of body.thread) {
		if (!isObject(m) || (m.role !== "reader" && m.role !== "tutor") || typeof m.text !== "string") return undefined;
		thread.push({ role: m.role, text: m.text });
	}
	const start = isObject(body.start) ? body.start : undefined;
	const index = (v: unknown, length: number) =>
		Number.isInteger(v) && (v as number) >= 0 && (v as number) < length ? (v as number) : undefined;
	return {
		message: body.message.trim(),
		mode: body.mode,
		thread,
		start:
			start && ["talk", "check", "ask", "quiz"].includes(start.kind as string)
				? {
						kind: start.kind as NonNullable<TutorTurn["start"]>["kind"],
						step: index(start.step, page.steps.length),
						question: index(start.question, page.quiz.length),
						choice: index(start.choice, 4),
						quote: typeof start.quote === "string" ? start.quote : undefined,
					}
				: undefined,
	};
}

const SOCRATIC = `Teach Socratically. Your goal is the reader's understanding, not their agreement.
- Ask one question at a time: small enough to answer in a sentence, answerable from the explanation or the code. Prefer a concrete case with toy data to an abstract question.
- Build on what the reader says. If they are right, confirm in a few words and take the next step. If they are partly right, name what is right, then ask about the gap. If they are wrong, do not hand them the answer: ask a question whose answer shows the contradiction.
- If the reader asks for a hint, give a smaller step, not the answer. If they ask you to just tell them, or have missed twice, give the answer plainly in two or three sentences, then ask one question that checks it.
- When the reader shows they understand, say so in a sentence and stop asking.`;
const DIRECT = `Answer the reader directly: plainly, in two to five sentences, grounded in the change and the repository. If a question they could ask next would deepen their understanding, end with it.`;

/** The prompt for one tutor turn, for a read-only fork of the conversation that wrote the explanation. */
export function tutorPrompt(page: ExplainChangePage, turn: TutorTurn): string {
	const start = turn.start;
	const asks = start?.kind === "check" || start?.kind === "quiz";
	const lines = [
		`You are the tutor beside an explanation of a code change. You wrote it earlier in this conversation with explain_change ("${page.title}", ${page.ref}); the reader has it open and talks to you in a sidebar. You are an ephemeral read-only fork: you can use read, grep, find, and ls; every other tool is blocked, and nothing you write reaches the main conversation.`,
		"",
		turn.mode === "socratic" || (asks && turn.thread.length === 0) ? SOCRATIC : DIRECT,
		`- Keep every reply short: two to five sentences. Point to where the explanation covers the idea as "Step N", "Figure N", or "Question N"; the page turns those into links. Quote code only from the repository or the explanation, and say so when you are not sure.`,
	];
	if (start?.kind === "talk" && start.question !== undefined) {
		const q = page.quiz[start.question];
		lines.push(
			"",
			`The reader missed Question ${start.question + 1} of the quiz and asked to talk it through.`,
			`Question: ${q.question}`,
			...q.options.map(
				(o, i) =>
					`${"ABCD"[i]}. ${o}${i === q.answer ? " (right)" : ""}${i === start.choice ? " (the reader's choice)" : ""}`,
			),
			`Why: ${q.why}`,
			"Start from the misconception their choice shows. Lead them to the right answer; do not state it in your first reply.",
		);
	}
	if (start?.kind === "check" && start.step !== undefined)
		lines.push(
			"",
			`The reader asked you to check their understanding of Step ${start.step + 1}, "${page.steps[start.step].title}". Ask one question that a reader who only skimmed the step would get wrong.`,
		);
	if ((start?.kind === "ask" || start?.kind === "quiz") && start.quote)
		lines.push(
			"",
			`The reader selected this passage of the explanation:`,
			`> ${start.quote.replace(/\n/g, "\n> ")}`,
			start.kind === "quiz" ? "Ask one question that tests whether they understand it." : "",
		);
	if (turn.thread.length)
		lines.push(
			"",
			"The conversation so far:",
			...turn.thread.map((m) => `${m.role === "reader" ? "Reader" : "Tutor"}: ${m.text}`),
		);
	lines.push("", `Reader: ${turn.message}`, "", "Reply as the tutor.");
	return lines.filter((l, i, all) => l !== "" || all[i - 1] !== "").join("\n");
}

// ---------------------------------------------------------------------------- what the agent hears back

/** A short note on what the reader did, for the agent's next turn, or undefined when they did nothing yet. */
export function readerNote(body: unknown, page: ExplainChangePage): string | undefined {
	if (!isObject(body) || !Array.isArray(body.answers) || !Array.isArray(body.asked)) return undefined;
	const answers = body.answers.flatMap((a) =>
		isObject(a) && Number.isInteger(a.question) && Number.isInteger(a.chosen) && page.quiz[a.question as number]
			? [{ question: a.question as number, chosen: a.chosen as number }]
			: [],
	);
	const asked = body.asked.filter((q): q is string => typeof q === "string" && q.trim() !== "");
	if (!answers.length && !asked.length) return undefined;
	const right = answers.filter((a) => page.quiz[a.question].answer === a.chosen).length;
	const out = [`A reader worked through your explanation "${page.title}" (${page.ref}).`];
	if (answers.length)
		out.push(
			`Quiz: ${right} of ${answers.length} right${answers.length < page.quiz.length ? ` (${answers.length} of ${page.quiz.length} answered)` : ""}.`,
			...answers
				.filter((a) => page.quiz[a.question].answer !== a.chosen)
				.map((a) => {
					const q = page.quiz[a.question];
					return `- Missed question ${a.question + 1}, "${q.question}": chose "${q.options[a.chosen] ?? "?"}", not "${q.options[q.answer]}".`;
				}),
		);
	if (asked.length) out.push("They asked the tutor:", ...asked.map((q) => `- ${q}`));
	return out.join("\n");
}
