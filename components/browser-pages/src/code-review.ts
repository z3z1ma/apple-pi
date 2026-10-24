import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { type Static, Type } from "typebox";

import { generatedPaths, readBaseFile, readRepoDiff, type RawLine } from "./git-diff.js";
import { highlightLines, markRange } from "./highlight.js";
import { blocksOf, withDiagrams } from "./markdown-review.js";
import { readTemplate } from "./saved-page.js";
import type {
	Attention,
	Chapter,
	CodeReviewPage,
	Decision,
	DiffFile,
	DiffLine,
	Hunk,
	Note,
	Pattern,
	ReviewResult,
	Segment,
} from "./page-data.js";

export const REVIEW_CODE_TOOL_NAME = "review_code";

const AttentionSchema = Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")], {
	description: "How closely the reviewer should read: high = where a mistake would hurt, low = tests, docs, wiring",
});
const RefSchema = Type.Object({
	file: Type.String({ description: "Path relative to the repository root" }),
	lines: Type.Optional(
		Type.String({ description: 'New-side line range such as "41-53" or "12". Omit to take every change in the file.' }),
	),
});

export const ReviewCodeParamsSchema = Type.Object({
	cwd: Type.Optional(
		Type.String({
			description:
				"Target working directory (repository or worktree for git pages). Absolute or relative to the session working directory; defaults to the session working directory.",
		}),
	),
	title: Type.String({ description: "What the change does, as a short headline" }),
	intent: Type.String({
		description: "The judgment you need and why the change exists, in two to four sentences (Markdown)",
	}),
	base: Type.Optional(
		Type.String({
			description:
				'Git ref to compare with. The page shows the working tree against the merge base of this ref and HEAD. Default "HEAD" (uncommitted changes); use the target branch, such as "main", for a whole branch.',
		}),
	),
	focus: Type.Optional(
		Type.Object(
			{
				text: Type.String({
					description: "Where to look first if the reviewer only has two minutes, and why (Markdown)",
				}),
				refs: Type.Optional(Type.Array(RefSchema, { description: "The changes to read first" })),
			},
			{ description: "The two-minute path through the change" },
		),
	),
	verification: Type.Optional(
		Type.Array(
			Type.Object({
				status: Type.Union([Type.Literal("pass"), Type.Literal("fail"), Type.Literal("unverified")]),
				label: Type.String({ description: "What was checked, such as `npm test`" }),
				detail: Type.Optional(Type.String({ description: "Outcome, such as 52 passed" })),
			}),
			{ description: "What you ran or checked, and what you did not verify" },
		),
	),
	chapters: Type.Array(
		Type.Object({
			title: Type.String({ description: "The idea this chapter carries, as a headline" }),
			kind: Type.Union([Type.Literal("core"), Type.Literal("consequence"), Type.Literal("support")], {
				description: "core = the heart of the change; consequence = follows from it; support = tests, docs, wiring",
			}),
			attention: AttentionSchema,
			brief: Type.String({
				description:
					"Your explanation of this chapter for the reviewer: why, how, and what to watch. Markdown: lists, tables, code fences, and `mermaid` diagrams render",
			}),
			callouts: Type.Optional(
				Type.Array(
					Type.Object({
						title: Type.String({ description: "Short label, such as Behaviour change" }),
						text: Type.String({ description: "The caveat or risk (Markdown)" }),
					}),
				),
			),
			changes: Type.Array(
				Type.Object({
					summary: Type.String({ description: "One sentence: what this change does" }),
					file: Type.Optional(Type.String({ description: "Path of one change; omit when you give places" })),
					lines: Type.Optional(Type.String({ description: 'New-side line range in that file, such as "41-53"' })),
					places: Type.Optional(
						Type.Array(RefSchema, {
							minItems: 2,
							description:
								"The same change repeated in several places. The page shows the first place in full and lists the rest.",
						}),
					),
					attention: Type.Optional(AttentionSchema),
				}),
				{ minItems: 1, description: "The diff pieces in this chapter, in reading order" },
			),
		}),
		{ minItems: 1, description: "The change told in the order you reasoned about it: core first, support last" },
	),
	notes: Type.Optional(
		Type.Array(
			Type.Object({
				file: Type.String(),
				line: Type.Integer({ description: "New-side line number the note is about" }),
				text: Type.String({ description: "Something the code cannot show: a reason, a hazard, a subtlety" }),
			}),
			{ description: "Short notes pinned to lines" },
		),
	),
	decisions: Type.Optional(
		Type.Array(
			Type.Object({
				file: Type.String(),
				line: Type.Optional(Type.Integer({ description: "New-side line; default: the first added line in the file" })),
				question: Type.String(),
				context: Type.Optional(Type.String({ description: "What the choice affects" })),
				options: Type.Array(Type.Object({ label: Type.String(), detail: Type.Optional(Type.String()) }), {
					minItems: 2,
				}),
				chosen: Type.Optional(
					Type.Integer({ description: "Index of the option you chose; omit to ask the reviewer to choose" }),
				),
			}),
			{ description: "Real judgment calls the reviewer may want to override. Use sparingly." },
		),
	),
});

export type ReviewCodeParams = Static<typeof ReviewCodeParamsSchema>;
type Ref = { file: string; lines?: string };

// ---------------------------------------------------------------------------- repeated changes

const LITERAL_WORDS = new Set(
	"import export from const let var function return if else elif for while do async await new throw try catch except finally raise type interface extends implements class def fn pub mut impl struct enum match case switch default break continue static private public protected readonly as of in is not and or typeof keyof instanceof null nil None undefined true false True False void this self super yield lambda pass".split(
		" ",
	),
);
const TOKEN = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\d[\w.]*|[A-Za-z_$][\w$]*|\S/g;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const nameLike = (token: string) => /^["'`]/.test(token) || (/^[A-Za-z_$]/.test(token) && !LITERAL_WORDS.has(token));

function renameOf(a: string, b: string): [string, string] | undefined {
	const x = a.toLowerCase();
	const y = b.toLowerCase();
	let p = 0;
	let s = 0;
	while (p < x.length && p < y.length && x[p] === y[p]) p++;
	while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
	const from = x.slice(p, x.length - s);
	const to = y.slice(p, y.length - s);
	return /^[a-z][a-z0-9_]+$/.test(from) && /^[a-z][a-z0-9_]+$/.test(to) ? [from, to] : undefined;
}

/**
 * A hint, not proof of equal behaviour: true when `other` differs from `example` only by one consistent name
 * substitution (invoice → tax, in any case form) taken from the file names, or from the first differing name
 * when both share a file. Keywords, literals, numbers, and operators never count as a rename.
 */
function renamedFrom(
	example: { file: string; lines: RawLine[] | DiffLine[] },
	other: { file: string; lines: RawLine[] | DiffLine[] },
	text: (line: RawLine | DiffLine) => string,
): boolean {
	if (example.lines.length !== other.lines.length) return false;
	const pairs: [string, string][] = [];
	for (let i = 0; i < example.lines.length; i++) {
		const a = example.lines[i];
		const b = other.lines[i];
		if (a.t !== b.t) return false;
		const ta = text(a).match(TOKEN) ?? [];
		const tb = text(b).match(TOKEN) ?? [];
		if (ta.length !== tb.length) return false;
		ta.forEach((token, k) => {
			if (token !== tb[k]) pairs.push([token, tb[k]]);
		});
	}
	if (pairs.length === 0) return true;
	if (!pairs.every(([a, b]) => nameLike(a) && nameLike(b))) return false;
	const base = (path: string) => path.slice(path.lastIndexOf("/") + 1);
	const sub =
		example.file !== other.file ? renameOf(base(example.file), base(other.file)) : renameOf(pairs[0][0], pairs[0][1]);
	if (!sub) return false;
	const [x, y] = sub;
	const forms: [string, string][] = [
		[x, y],
		[capital(x), capital(y)],
		[x.toUpperCase(), y.toUpperCase()],
	];
	return pairs.every(([a, b]) => forms.reduce((acc, [f, t]) => acc.split(f).join(t), a) === b);
}

// ---------------------------------------------------------------------------- page building

const lineText = (line: RawLine | DiffLine) => ("text" in line ? line.text : line.s.map((seg) => seg.t).join(""));

/** Common prefix and suffix after each line's own indentation, so a re-indented line marks only real edits. */
function similarity(a: string, b: string): { p: number; s: number; score: number; ia: number; ib: number } {
	const ia = a.length - a.trimStart().length;
	const ib = b.length - b.trimStart().length;
	const r = similarText(a.slice(ia), b.slice(ib));
	return { ...r, ia, ib };
}

function similarText(a: string, b: string): { p: number; s: number; score: number } {
	let p = 0;
	let s = 0;
	while (p < a.length && p < b.length && a[p] === b[p]) p++;
	while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
	return { p, s, score: (p + s) / Math.max(a.length, b.length, 1) };
}

/** Marks the changed middle of each removed line and the added line most like it in the same run. */
function wordMarks(lines: DiffLine[]): void {
	let i = 0;
	while (i < lines.length) {
		if (lines[i].t !== "-") {
			i++;
			continue;
		}
		const dels: DiffLine[] = [];
		const adds: DiffLine[] = [];
		while (i < lines.length && lines[i].t === "-") dels.push(lines[i++]);
		while (i < lines.length && lines[i].t === "+") adds.push(lines[i++]);
		const free = new Set(adds);
		for (const del of dels) {
			const a = lineText(del);
			let best: { add: DiffLine; p: number; s: number; score: number; ia: number; ib: number } | undefined;
			for (const add of free) {
				const match = similarity(a, lineText(add));
				if (match.score >= 0.45 && (!best || match.score > best.score)) best = { add, ...match };
			}
			if (!best) continue;
			free.delete(best.add);
			const b = lineText(best.add);
			const { p, s: suffix, ia, ib } = best;
			if (ia + p < a.length - suffix) del.s = markRange(del.s, ia + p, a.length - suffix);
			if (ib + p < b.length - suffix) best.add.s = markRange(best.add.s, ib + p, b.length - suffix);
		}
	}
}

function parseRange(lines: string): [number, number] | undefined {
	const match = /^\s*L?(\d+)\s*(?:[-–:]\s*L?(\d+))?\s*$/.exec(lines);
	if (!match) return undefined;
	const from = Number(match[1]);
	return [from, match[2] ? Number(match[2]) : from];
}

async function highlighted(path: string, content: string | undefined): Promise<Segment[][] | undefined> {
	return content === undefined ? undefined : highlightLines(content, path);
}

/** A maximal run of changed lines inside one git hunk: the smallest piece the agent can place. */
interface Island {
	file: string;
	/** All lines of the git hunk the island belongs to. */
	lines: DiffLine[];
	block: number;
	/** First and last changed line, as indexes into `lines`; e = s - 1 for a file with no text lines. */
	s: number;
	e: number;
	/** Lines the island touches, on the new side (old side for a deleted file). */
	range?: [number, number];
	note?: string;
	owner?: string;
	hunk?: string;
}

function islandsOf(file: string, status: string, lines: DiffLine[], block: number, note?: string): Island[] {
	if (lines.length === 0) return [{ file, lines, block, s: 0, e: -1, note }];
	const out: Island[] = [];
	let i = 0;
	while (i < lines.length) {
		if (lines[i].t === " ") {
			i++;
			continue;
		}
		const s = i;
		while (i < lines.length && lines[i].t !== " ") i++;
		const run = lines.slice(s, i);
		const side = status === "D" ? "o" : "n";
		const numbers = run.map((l) => l[side]).filter((v): v is number => v !== undefined);
		// A pure deletion sits where the next line now is.
		const at = lines[i]?.n ?? (lines[s - 1]?.n !== undefined ? lines[s - 1].n! + 1 : undefined);
		const range: [number, number] | undefined = numbers.length
			? [Math.min(...numbers), Math.max(...numbers)]
			: at !== undefined
				? [at, at]
				: undefined;
		out.push({ file, lines, block, s, e: i - 1, range });
	}
	return out;
}

/** Splits a run of added lines, such as a new file, at the given first lines of new pieces. */
function splitAdded(run: Island, starts: Set<number> | undefined): Island[] {
	if (!starts || run.e <= run.s || run.lines.slice(run.s, run.e + 1).some((l) => l.t !== "+")) return [run];
	const pieces: Island[] = [];
	const piece = (s: number, e: number): Island => ({ ...run, s, e, range: [run.lines[s].n!, run.lines[e].n!] });
	let start = run.s;
	for (let i = run.s + 1; i <= run.e; i++)
		if (starts.has(run.lines[i].n!)) {
			pieces.push(piece(start, i - 1));
			start = i;
		}
	pieces.push(piece(start, run.e));
	return pieces;
}

/** Cuts git hunks where the owner changes, so each piece holds exactly what one chapter entry placed. */
function cutHunks(islands: Island[], hunks: Record<string, Hunk>, order: string[]): void {
	const blocks = new Map<number, Island[]>();
	for (const island of islands) blocks.set(island.block, [...(blocks.get(island.block) ?? []), island]);
	for (const block of blocks.values()) {
		const groups: Island[][] = [];
		for (const island of block) {
			const last = groups[groups.length - 1];
			if (last && last[0].owner === island.owner) last.push(island);
			else groups.push([island]);
		}
		const lines = block[0].lines;
		let from = 0;
		groups.forEach((group, g) => {
			const next = groups[g + 1];
			const last = group[group.length - 1];
			let to = lines.length - 1;
			if (next) {
				const gap = next[0].s - last.e - 1;
				to = last.e + Math.min(3, Math.floor(gap / 2));
			}
			const start = g === 0 ? 0 : Math.max(from, group[0].s - 3);
			const slice = lines.slice(start, to + 1);
			const id = `h${order.length + 1}`;
			hunks[id] = {
				id,
				file: group[0].file,
				lines: slice,
				adds: slice.filter((l) => l.t === "+").length,
				dels: slice.filter((l) => l.t === "-").length,
				note: group[0].note,
			};
			order.push(id);
			for (const island of group) island.hunk = id;
			from = to + 1;
		});
	}
}

/** Builds the page from the agent's structure and the repository's real diff. Code always comes from git. */
export async function buildCodeReviewPage(
	params: ReviewCodeParams,
	cwd: string,
	token: string,
): Promise<{ page: CodeReviewPage; root: string }> {
	cwd = resolve(cwd, params.cwd ?? ".");
	const diff = await readRepoDiff(cwd, params.base ?? "HEAD");
	const generated = await generatedPaths(
		diff.root,
		diff.files.map((f) => f.path),
	);
	const files: DiffFile[] = [];
	const runs: Island[] = [];
	let block = 0;
	for (const raw of diff.files) {
		const isGenerated = generated.has(raw.path);
		files.push({
			path: raw.path,
			oldPath: raw.oldPath,
			status: raw.status,
			generated: isGenerated,
			binary: raw.binary,
		});
		const textual = !isGenerated && !raw.binary && raw.hunks.some((h) => h.lines.length > 0);
		const newSegs =
			textual && raw.status !== "D"
				? await highlighted(raw.path, await readFile(join(diff.root, raw.path), "utf8").catch(() => undefined))
				: undefined;
		const oldSegs =
			textual && raw.status !== "A"
				? await highlighted(
						raw.oldPath ?? raw.path,
						await readBaseFile(diff.root, diff.baseCommit, raw.oldPath ?? raw.path),
					)
				: undefined;
		for (const rawHunk of raw.hunks) {
			const lines: DiffLine[] = rawHunk.lines.map((l) => {
				const source = l.t === "-" ? oldSegs?.[(l.o ?? 0) - 1] : newSegs?.[(l.n ?? 0) - 1];
				const fits = source && source.map((seg) => seg.t).join("") === l.text;
				return { t: l.t, o: l.o, n: l.n, s: fits ? source : [{ t: l.text }] };
			});
			wordMarks(lines);
			runs.push(...islandsOf(raw.path, raw.status, lines, block++, rawHunk.note));
		}
	}

	const warnings: string[] = [];
	const known = new Set(files.flatMap((f) => [f.path, f.oldPath].filter((p): p is string => !!p)));
	const normalize = (file: string): string => {
		const plain = file.replace(/^\.\//, "");
		if (known.has(plain)) return plain;
		const fromCwd = relative(diff.root, isAbsolute(plain) ? plain : resolve(cwd, plain));
		return known.has(fromCwd) ? fromCwd : plain;
	};
	const pathOf = (file: string) => {
		const path = normalize(file);
		return files.find((f) => f.path === path || f.oldPath === path)?.path;
	};
	// Every chapter entry's range bounds a place where a run of added lines may be cut.
	const bounds = new Map<string, Set<number>>();
	const bound = (ref: Ref) => {
		const path = pathOf(ref.file);
		const range = ref.lines ? parseRange(ref.lines) : undefined;
		if (!path || !range) return;
		const set = bounds.get(path) ?? new Set<number>();
		set.add(range[0]).add(range[1] + 1);
		bounds.set(path, set);
	};
	for (const c of params.chapters)
		for (const change of c.changes) {
			if (change.places?.length) for (const place of change.places) bound(place);
			else if (change.file) bound({ file: change.file, lines: change.lines });
		}
	const islands = runs.flatMap((run) => splitAdded(run, bounds.get(run.file)));
	const islandsFor = (ref: Ref, where: string): Island[] => {
		const path = pathOf(ref.file);
		const label = `${ref.file}${ref.lines ? `:${ref.lines}` : ""}`;
		const inFile = islands.filter((island) => island.file === path);
		if (inFile.length === 0) {
			warnings.push(`${label} (${where}) has no change in the diff.`);
			return [];
		}
		if (!ref.lines) return inFile;
		const range = parseRange(ref.lines);
		if (!range) {
			warnings.push(`${label} (${where}) has an unreadable line range; use "41-53".`);
			return [];
		}
		const hit = inFile.filter((i) => i.range && i.range[0] <= range[1] && range[0] <= i.range[1]);
		if (hit.length === 0) warnings.push(`${label} (${where}) overlaps no changed lines.`);
		return hit;
	};
	const claim = (ref: Ref, where: string, owner: string): void => {
		const hit = islandsFor(ref, where);
		const free = hit.filter((island) => !island.owner);
		for (const island of free) island.owner = owner;
		if (hit.length > 0 && free.length === 0)
			warnings.push(
				`${ref.file}${ref.lines ? `:${ref.lines}` : ""} (${where}) covers only lines placed by an earlier entry; they stay there.`,
			);
	};

	// First pass: every chapter entry claims its islands, so hunks can be cut where ownership changes.
	params.chapters.forEach((c, ci) => {
		c.changes.forEach((change, k) => {
			const where = `chapter ${ci + 1}, change ${k + 1}`;
			if (change.places?.length)
				change.places.forEach((place, pi) => {
					claim(place, where, `${ci}.${k}.${pi}`);
				});
			else if (change.file) claim({ file: change.file, lines: change.lines }, where, `${ci}.${k}`);
			else warnings.push(`${where} names neither a file nor places.`);
		});
	});
	const hunks: Record<string, Hunk> = {};
	const order: string[] = [];
	cutHunks(islands, hunks, order);
	const owned = (owner: string) => [...new Set(islands.filter((i) => i.owner === owner).map((i) => i.hunk!))];

	const patterns: Record<string, Pattern> = {};
	const briefs = await Promise.all(params.chapters.map((c) => blocksOf(c.brief)));
	const chapters: Chapter[] = params.chapters.map((c, ci) => {
		const changes: Chapter["changes"] = [];
		c.changes.forEach((change, k) => {
			const attention = change.attention as Attention | undefined;
			if (change.places?.length) {
				const ids = change.places.flatMap((_, pi) => owned(`${ci}.${k}.${pi}`));
				if (ids.length < 2) {
					for (const id of ids) changes.push({ id, summary: change.summary, attention });
					return;
				}
				const pid = `p${Object.keys(patterns).length + 1}`;
				const example = { file: hunks[ids[0]].file, lines: hunks[ids[0]].lines };
				patterns[pid] = {
					id: pid,
					summary: change.summary,
					hunks: ids,
					differs: ids.slice(1).filter((id) => !renamedFrom(example, hunks[id], lineText)),
				};
				for (const id of ids) changes.push({ id, pattern: pid, attention });
				return;
			}
			for (const id of owned(`${ci}.${k}`)) changes.push({ id, summary: change.summary, attention });
		});
		return {
			id: `c${ci + 1}`,
			title: c.title,
			kind: c.kind,
			attention: c.attention,
			brief: briefs[ci],
			callouts: c.callouts ?? [],
			changes,
		};
	});

	const anchor = (file: string, line: number | undefined, where: string) => {
		const path = pathOf(file);
		for (const id of order.filter((h) => hunks[h].file === path)) {
			const lines = hunks[id].lines;
			const onNew = lines.findIndex((l) => (line === undefined ? l.t === "+" : l.n === line));
			const idx = onNew >= 0 || line === undefined ? onNew : lines.findIndex((l) => l.t === "-" && l.o === line);
			if (idx < 0) continue;
			const l = lines[idx];
			return { hunk: id, idx, label: l.n !== undefined ? `L${l.n}` : `old L${l.o}` };
		}
		warnings.push(`${file}${line === undefined ? "" : `:${line}`} (${where}) is not on a changed hunk line.`);
		return undefined;
	};
	const notes: Note[] = [];
	(params.notes ?? []).forEach((n, i) => {
		const at = anchor(n.file, n.line, `note ${i + 1}`);
		if (at) notes.push({ id: `n${i + 1}`, ...at, text: n.text });
	});
	const decisions: Decision[] = [];
	(params.decisions ?? []).forEach((d, i) => {
		const at = anchor(d.file, d.line, `decision ${i + 1}`);
		if (!at) return;
		const chosen = d.chosen !== undefined && d.chosen >= 0 && d.chosen < d.options.length ? d.chosen : undefined;
		decisions.push({ id: `d${i + 1}`, ...at, question: d.question, context: d.context, options: d.options, chosen });
	});
	const focusHunks = [
		...new Set((params.focus?.refs ?? []).flatMap((ref) => islandsFor(ref, "focus").map((i) => i.hunk!))),
	];

	const page: CodeReviewPage = {
		kind: "code-review",
		title: params.title,
		intent: await blocksOf(params.intent),
		base: params.base ?? "HEAD",
		head: diff.head,
		createdAt: new Date().toISOString(),
		focus: params.focus ? { blocks: await blocksOf(params.focus.text), hunks: focusHunks } : undefined,
		verification: params.verification ?? [],
		files,
		hunks,
		order,
		chapters,
		patterns,
		notes,
		decisions,
		warnings,
		session: { token, live: true, ask: false },
	};
	return { page, root: diff.root };
}

// ---------------------------------------------------------------------------- result from the page

const VERDICTS = new Set(["approve", "approve_notes", "changes", "dismissed"]);
const KINDS = new Set(["change", "question", "concern", "nit", "praise"]);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export interface Question {
	hunk: string;
	start: number;
	end: number;
	question: string;
}

/** A question about lines the page actually shows, or undefined. */
/** The page app, with Mermaid inlined only when the agent's prose has a diagram. */
export async function codeReviewTemplate(page: CodeReviewPage): Promise<string> {
	return withDiagrams(await readTemplate("code-review"), [
		...page.intent,
		...(page.focus?.blocks ?? []),
		...page.chapters.flatMap((c) => c.brief),
	]);
}

export function parseQuestion(body: unknown, page: CodeReviewPage): Question | undefined {
	if (!isObject(body) || typeof body.hunk !== "string" || typeof body.question !== "string" || !body.question.trim())
		return undefined;
	const lines = page.hunks[body.hunk]?.lines;
	const start = Number(body.start);
	const end = Number(body.end);
	if (!lines || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return undefined;
	if (end >= Math.max(1, lines.length)) return undefined;
	return { hunk: body.hunk, start, end, question: body.question.trim() };
}

/** Validates the page's submission against the page it was served. Anything malformed is rejected whole. */
export function parseReviewResult(body: unknown, page: CodeReviewPage): ReviewResult | undefined {
	if (!isObject(body) || !VERDICTS.has(body.verdict as string)) return undefined;
	if (!Array.isArray(body.comments) || !Array.isArray(body.decisions) || !Array.isArray(body.seen)) return undefined;
	const comments: ReviewResult["comments"] = [];
	for (const c of body.comments) {
		if (!isObject(c) || typeof c.hunk !== "string" || typeof c.text !== "string" || !KINDS.has(c.kind as string))
			return undefined;
		const hunk = page.hunks[c.hunk];
		const start = Number(c.start);
		const end = Number(c.end);
		if (
			!hunk ||
			!Number.isInteger(start) ||
			!Number.isInteger(end) ||
			start < 0 ||
			end < start ||
			end >= Math.max(1, hunk.lines.length)
		)
			return undefined;
		if (c.replyTo !== undefined && !page.notes.some((n) => n.id === c.replyTo)) return undefined;
		comments.push({
			hunk: c.hunk,
			start,
			end,
			kind: c.kind as ReviewResult["comments"][number]["kind"],
			text: c.text,
			replyTo: c.replyTo as string | undefined,
		});
	}
	const decisions: ReviewResult["decisions"] = [];
	for (const d of body.decisions) {
		const decision = isObject(d) ? page.decisions.find((x) => x.id === d.id) : undefined;
		if (
			!isObject(d) ||
			!decision ||
			!Number.isInteger(d.choice) ||
			(d.choice as number) < 0 ||
			(d.choice as number) >= decision.options.length
		)
			return undefined;
		decisions.push({
			id: decision.id,
			choice: d.choice as number,
			note: typeof d.note === "string" && d.note.trim() ? d.note.trim() : undefined,
		});
	}
	const asked: ReviewResult["asked"] = [];
	for (const a of Array.isArray(body.asked) ? body.asked : []) {
		const q = parseQuestion(a, page);
		if (!q || !isObject(a) || typeof a.answer !== "string") return undefined;
		asked.push({ ...q, answer: a.answer });
	}
	const seen = body.seen.filter((id): id is string => typeof id === "string" && id in page.hunks);
	return {
		verdict: body.verdict as ReviewResult["verdict"],
		summary: typeof body.summary === "string" && body.summary.trim() ? body.summary.trim() : undefined,
		comments,
		asked,
		decisions,
		seen,
		submittedAt: new Date().toISOString(),
	};
}

// ---------------------------------------------------------------------------- result for the model

/** The `file:41-43` anchor of lines in a hunk, and the first non-blank line they cover. */
/** The lines a question is about, for the read-only fork's prompt. */
export function questionPassage(page: CodeReviewPage, q: Question) {
	const hunk = page.hunks[q.hunk];
	const chapter = page.chapters.find((c) => c.changes.some((change) => change.id === q.hunk));
	return {
		where: anchorText(hunk, q.start, q.end).where,
		excerpt: hunk.lines
			.slice(q.start, q.end + 1)
			.map((l) => `${l.t}${l.s.map((seg) => seg.t).join("")}`)
			.join("\n"),
		context: chapter ? `chapter "${chapter.title}"` : undefined,
	};
}

export function anchorText(hunk: Hunk, start: number, end: number): { where: string; quote: string } {
	const lines = hunk.lines.slice(start, end + 1);
	const news = lines.map((l) => l.n).filter((n): n is number => n !== undefined);
	const where = news.length
		? `${hunk.file}:${news[0]}${news.length > 1 && news[news.length - 1] !== news[0] ? `-${news[news.length - 1]}` : ""}`
		: `${hunk.file}:old ${lines[0]?.o ?? "?"}`;
	const first = lines.find((l) => lineText(l).trim());
	return { where, quote: first ? `${first.t === " " ? "" : first.t}${lineText(first).trim()}` : "" };
}

const VERDICT_TEXT: Record<ReviewResult["verdict"], string> = {
	approve: "approved",
	approve_notes: "approved with notes: act on the comments",
	changes: "requested changes: address the comments, then ask for review again",
	dismissed: "closed without a verdict",
};

/** The model-facing text of a submitted review. */
export function formatReviewResult(page: CodeReviewPage, result: ReviewResult, savedPath?: string): string {
	const out = [`The reviewer ${VERDICT_TEXT[result.verdict]}.`];
	if (result.summary?.trim()) out.push("", `Summary: ${result.summary.trim()}`);
	const notes = new Map(page.notes.map((n) => [n.id, n]));
	if (result.comments.length > 0) {
		out.push("", `Comments (${result.comments.length}):`);
		for (const c of result.comments) {
			const hunk = page.hunks[c.hunk];
			if (!hunk) continue;
			const { where, quote } = anchorText(hunk, c.start, c.end);
			const reply = c.replyTo && notes.get(c.replyTo);
			out.push(`- ${c.kind} · ${where}${reply ? ` · reply to your note "${reply.text}"` : ""}: ${c.text}`);
			if (quote && !reply) out.push(`  > ${quote}`);
		}
	}
	if (result.asked.length > 0) {
		out.push(
			"",
			`Questions the reviewer asked in the page, answered there by a read-only fork of you (${result.asked.length}):`,
		);
		for (const a of result.asked) {
			const hunk = page.hunks[a.hunk];
			if (!hunk) continue;
			out.push(`- ${anchorText(hunk, a.start, a.end).where}: ${a.question}`);
			out.push(...a.answer.split("\n").map((line) => `  > ${line}`));
		}
	}
	const answered = result.decisions.filter((d) => page.decisions.some((x) => x.id === d.id));
	if (answered.length > 0) {
		out.push("", "Decisions:");
		for (const answer of answered) {
			const d = page.decisions.find((x) => x.id === answer.id)!;
			const label = d.options[answer.choice]?.label ?? "?";
			const stance =
				d.chosen === undefined
					? "answered"
					: d.chosen === answer.choice
						? "kept your choice"
						: `overrode your choice of "${d.options[d.chosen].label}" with`;
			out.push(`- ${d.question} → ${stance} "${label}"${answer.note ? ` (${answer.note})` : ""}`);
		}
	}
	const open = page.decisions.filter((d) => d.chosen === undefined && !answered.some((a) => a.id === d.id));
	if (open.length > 0) out.push("", `Unanswered questions: ${open.map((d) => `"${d.question}"`).join(", ")}`);
	const seen = new Set(result.seen);
	const unseen = page.order.filter((id) => !seen.has(id));
	out.push(
		"",
		`Coverage: the reviewer marked ${page.order.length - unseen.length} of ${page.order.length} hunks seen.`,
	);
	if (unseen.length > 0)
		out.push(`Not marked seen: ${[...new Set(unseen.map((id) => page.hunks[id].file))].join(", ")}`);
	if (page.warnings.length > 0) out.push("", "Your references had problems:", ...page.warnings.map((w) => `- ${w}`));
	if (savedPath) out.push("", `Saved page: ${savedPath}`);
	return out.join("\n");
}
