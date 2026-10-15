import type { Attention, Chapter, ChapterChange, CodeReviewPage, Decision, Note } from "../src/page-data";

export const ATTENTION: { att: Attention; label: string; detail: string }[] = [
	{ att: "high", label: "Read closely", detail: "Where a mistake would hurt." },
	{ att: "medium", label: "Worth a look", detail: "Follows from the core change." },
	{ att: "low", label: "Skim", detail: "Tests, docs, wiring, and generated code." },
];
export const ATT_LABEL: Record<Attention, string> = { high: "Read closely", medium: "Worth a look", low: "Skim" };
export const KIND_LABEL = { core: "Core", consequence: "Consequence", support: "Support" } as const;
export const UNPLACED = "unplaced";

/** One step in the attention lens: a repeated change counts once, every other hunk is its own unit. */
export interface Unit {
	rep: string;
	ids: string[];
	pattern?: string;
}

/** Derived, read-only structure over the page data. */
export function buildModel(page: CodeReviewPage) {
	const chapterOf: Record<string, Chapter> = {};
	const change: Record<string, ChapterChange> = {};
	const patternOf: Record<string, string> = {};
	for (const c of page.chapters)
		for (const ch of c.changes) {
			chapterOf[ch.id] = c;
			change[ch.id] = ch;
			if (ch.pattern) patternOf[ch.id] = ch.pattern;
		}
	const unplaced = page.order.filter((id) => !chapterOf[id]);
	const notesIn: Record<string, Note[]> = {};
	for (const n of page.notes) notesIn[n.hunk] = [...(notesIn[n.hunk] ?? []), n];
	const decisionsIn: Record<string, Decision[]> = {};
	for (const d of page.decisions) decisionsIn[d.hunk] = [...(decisionsIn[d.hunk] ?? []), d];
	const generated = new Set(page.files.filter((f) => f.generated).map((f) => f.path));

	const attOf = (id: string): Attention => (chapterOf[id] ? (change[id].attention ?? chapterOf[id].attention) : "high");
	const summaryOf = (id: string) =>
		patternOf[id] ? page.patterns[patternOf[id]].summary : (change[id]?.summary ?? "Not explained by the agent");
	const isInstance = (id: string) => !!patternOf[id] && page.patterns[patternOf[id]].hunks[0] !== id;
	const differs = (id: string) => !!patternOf[id] && page.patterns[patternOf[id]].differs.includes(id);
	const storyOrder = [...page.chapters.flatMap((c) => c.changes.map((ch) => ch.id)), ...unplaced];
	const attentionGroup = (att: Attention) => [
		...(att === "high" ? unplaced : []),
		...page.chapters.flatMap((c) => c.changes.map((ch) => ch.id)).filter((id) => attOf(id) === att),
	];
	const attentionUnits = (att: Attention): Unit[] => {
		const out: Unit[] = [];
		for (const id of attentionGroup(att)) {
			const p = patternOf[id];
			if (!p) out.push({ rep: id, ids: [id] });
			else if (!out.some((u) => u.pattern === p))
				out.push({ rep: page.patterns[p].hunks[0], ids: page.patterns[p].hunks, pattern: p });
		}
		return out;
	};
	const attentionOrder = ATTENTION.flatMap((a) => attentionUnits(a.att).map((u) => u.rep));
	const unitIds = (rep: string) => (patternOf[rep] ? page.patterns[patternOf[rep]].hunks : [rep]);
	const pages = [...page.chapters.map((c) => c.id), ...(unplaced.length ? [UNPLACED] : [])];
	const pageOf = (id: string) => chapterOf[id]?.id ?? UNPLACED;
	const pageHunks = (pid: string) =>
		pid === UNPLACED ? unplaced : (page.chapters.find((c) => c.id === pid)?.changes.map((ch) => ch.id) ?? []);
	const chapterIndex = (c: Chapter) => page.chapters.indexOf(c);
	const isGenerated = (id: string) => generated.has(page.hunks[id].file);

	return {
		page,
		chapterOf,
		change,
		patternOf,
		unplaced,
		notesIn,
		decisionsIn,
		attOf,
		summaryOf,
		isInstance,
		differs,
		storyOrder,
		attentionGroup,
		attentionUnits,
		attentionOrder,
		unitIds,
		pages,
		pageOf,
		pageHunks,
		chapterIndex,
		isGenerated,
	};
}

export type Model = ReturnType<typeof buildModel>;

export function hunkRange(page: CodeReviewPage, id: string): string {
	const lines = page.hunks[id].lines;
	const news = lines.map((l) => l.n).filter((n): n is number => n !== undefined);
	if (news.length) return `L${news[0]}–${news[news.length - 1]}`;
	const olds = lines.map((l) => l.o).filter((n): n is number => n !== undefined);
	return olds.length ? `old L${olds[0]}–${olds[olds.length - 1]}` : "";
}

export function anchorLabel(page: CodeReviewPage, hunk: string, start: number, end: number): string {
	const lines = page.hunks[hunk].lines.slice(start, end + 1);
	const news = lines.map((l) => l.n).filter((n): n is number => n !== undefined);
	if (news.length) return `L${news[0]}${news[news.length - 1] !== news[0] ? `–${news[news.length - 1]}` : ""}`;
	const olds = lines.map((l) => l.o).filter((n): n is number => n !== undefined);
	return olds.length ? `old L${olds[0]}${olds[olds.length - 1] !== olds[0] ? `–${olds[olds.length - 1]}` : ""}` : "";
}
