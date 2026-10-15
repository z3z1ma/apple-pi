import type { CommentKind, ReviewComment, ReviewResult, Verdict } from "../src/page-data";
import { type Model, UNPLACED } from "./model";

export interface Composer {
	hunk: string;
	anchor: number;
	start: number;
	end: number;
	kind: CommentKind;
	text: string;
	replyTo?: string;
}

export interface State {
	lens: "story" | "attention";
	/** "overview", a chapter id, "unplaced", or "hunk" (the attention lens's single-unit page). */
	page: string;
	focus: string | null;
	seen: Record<string, boolean>;
	open: Record<string, boolean>;
	fileClosed: Record<string, boolean>;
	briefClosed: Record<string, boolean>;
	notesAll: boolean;
	noteOpen: Record<string, boolean>;
	decOpen: Record<string, boolean>;
	unfold: Record<string, boolean>;
	boardAll: Record<string, boolean>;
	groupClosed: Record<string, boolean>;
	decisions: Record<string, { choice: number; note?: string }>;
	comments: (ReviewComment & { id: string })[];
	composer: Composer | null;
	verdict: Verdict | null;
	summary: string;
	modal: null | "verdict" | "keys" | "comments";
	theme: "light" | "dark";
	submit: "idle" | "sending" | "sent" | "failed";
	/** A requested scroll: "top" of the stage or a hunk id, applied once per `scrollSeq`. */
	scrollTo: string | null;
	scrollSeq: number;
	/** The decision last revealed, so Q and ⇧Q move on from it. */
	decisionCursor: string | null;
	seq: number;
}

export function initialState(result: ReviewResult | undefined): State {
	const dark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
	return {
		lens: "story",
		page: "overview",
		focus: null,
		seen: Object.fromEntries((result?.seen ?? []).map((id) => [id, true])),
		open: {},
		fileClosed: {},
		briefClosed: {},
		notesAll: false,
		noteOpen: {},
		decOpen: {},
		unfold: {},
		boardAll: {},
		groupClosed: {},
		decisions: Object.fromEntries((result?.decisions ?? []).map((d) => [d.id, { choice: d.choice, note: d.note }])),
		comments: (result?.comments ?? []).map((c, i) => ({ ...c, id: `r${i}` })),
		composer: null,
		verdict: result?.verdict ?? null,
		summary: result?.summary ?? "",
		modal: null,
		theme: dark ? "dark" : "light",
		submit: result ? "sent" : "idle",
		scrollTo: null,
		scrollSeq: 0,
		decisionCursor: null,
		seq: 0,
	};
}

export const isOpen = (m: Model, s: State, id: string): boolean =>
	s.open[id] ??
	(m.isInstance(id) ? m.differs(id) && !s.seen[id] : !(s.seen[id] || m.attOf(id) === "low" || m.isGenerated(id)));

function scroll(s: State, target: string): void {
	s.scrollTo = target;
	s.scrollSeq++;
}

export function focusHunk(m: Model, s: State, target: string, opts: { top?: boolean; scroll?: boolean } = {}): void {
	const before = s.page;
	const id = s.lens === "attention" && m.patternOf[target] ? m.page.patterns[m.patternOf[target]].hunks[0] : target;
	s.focus = id;
	s.page = s.lens === "story" ? m.pageOf(id) : "hunk";
	if (s.lens === "story") {
		s.fileClosed[m.patternOf[id] ? `pat|${m.patternOf[id]}` : `${s.page}|${m.page.hunks[id].file}`] = false;
		if (!isOpen(m, s, id) && !s.seen[id]) s.open[id] = true;
	}
	const newPage = s.page !== before || s.page === "hunk";
	if (newPage && (opts.top || s.page === "hunk")) scroll(s, "top");
	else if (opts.scroll !== false) scroll(s, id);
}

/** Shows one element inside a hunk, opening and unfolding whatever hides it, and scrolls it to the middle. */
function revealIn(m: Model, s: State, hunk: string, element: string): void {
	s.lens = "story";
	s.modal = null;
	s.page = m.pageOf(hunk);
	s.focus = hunk;
	s.fileClosed[m.patternOf[hunk] ? `pat|${m.patternOf[hunk]}` : `${s.page}|${m.page.hunks[hunk].file}`] = false;
	s.open[hunk] = true;
	s.unfold[hunk] = true;
	scroll(s, `el:${element}`);
}

export function revealDecision(m: Model, s: State, id: string): void {
	const decision = m.page.decisions.find((d) => d.id === id);
	if (!decision) return;
	s.decOpen[id] = true;
	s.decisionCursor = id;
	revealIn(m, s, decision.hunk, `dec-${id}`);
}

export function revealComment(m: Model, s: State, comment: State["comments"][number]): void {
	revealIn(m, s, comment.hunk, `cmt-${comment.id}`);
}

/** Q: the next unanswered open question (or any open question once all are answered). ⇧Q: the next judgment call. */
export function nextDecision(m: Model, s: State, kind: "question" | "judgment"): void {
	const order = [...m.page.decisions].sort(
		(a, b) => m.storyOrder.indexOf(a.hunk) - m.storyOrder.indexOf(b.hunk) || a.idx - b.idx,
	);
	const all = order.filter((d) => (kind === "question" ? d.chosen === undefined : d.chosen !== undefined));
	const unanswered = all.filter((d) => !s.decisions[d.id]);
	const pool = kind === "question" && unanswered.length ? unanswered : all;
	const cursor = order.findIndex((d) => d.id === s.decisionCursor);
	const next = pool.find((d) => order.indexOf(d) > cursor) ?? pool[0];
	if (next) revealDecision(m, s, next.id);
}

export function step(m: Model, s: State, d: number): void {
	const order = s.lens === "story" ? m.storyOrder : m.attentionOrder;
	if (s.page === "overview") {
		const first = order[d > 0 ? 0 : order.length - 1];
		if (first) focusHunk(m, s, first, { top: true });
		return;
	}
	const next = order[order.indexOf(s.focus ?? "") + d];
	if (next) focusHunk(m, s, next, { top: s.lens === "story" && m.pageOf(next) !== s.page });
	else if (d < 0) {
		s.page = "overview";
		scroll(s, "top");
	} else s.modal = "verdict";
}

export function chapterStep(m: Model, s: State, d: number): void {
	const current = s.page === "hunk" && s.focus ? m.pageOf(s.focus) : s.page;
	const i = s.page === "overview" ? -1 : m.pages.indexOf(current);
	const target = m.pages[i + d];
	s.lens = "story";
	if (!target) {
		if (d < 0) {
			s.page = "overview";
			scroll(s, "top");
		} else s.modal = "verdict";
		return;
	}
	s.page = target;
	s.focus = m.pageHunks(target)[0] ?? null;
	scroll(s, "top");
}

export function seenNext(m: Model, s: State): void {
	const id = s.focus;
	if (!id || s.page === "overview") {
		step(m, s, 1);
		return;
	}
	const story = s.lens === "story";
	for (const x of story ? [id] : m.unitIds(id)) {
		s.seen[x] = true;
		delete s.open[x];
	}
	const order = story ? m.storyOrder : m.attentionOrder;
	const i = order.indexOf(id);
	const next = [...order.slice(i + 1), ...order.slice(0, i)].find((x) =>
		(story ? [x] : m.unitIds(x)).some((h) => !s.seen[h]),
	);
	if (next) focusHunk(m, s, next, { top: story && m.pageOf(next) !== s.page });
	else s.modal = "verdict";
}

/** Marks every place of the focused repeated change seen, then moves on like seenNext. */
export function seenPatternNext(m: Model, s: State, focus: string): void {
	const hunks = m.page.patterns[m.patternOf[focus]].hunks;
	for (const id of hunks) {
		s.seen[id] = true;
		delete s.open[id];
	}
	s.focus = s.lens === "story" ? hunks[hunks.length - 1] : focus;
	seenNext(m, s);
}

export function markPageSeen(m: Model, s: State): void {
	for (const id of m.pageHunks(s.page)) {
		s.seen[id] = true;
		delete s.open[id];
	}
	chapterStep(m, s, 1);
}

export function markPatternSeen(m: Model, s: State, pid: string): void {
	const hunks = m.page.patterns[pid].hunks;
	const all = hunks.every((id) => s.seen[id]);
	for (const id of hunks) {
		s.seen[id] = !all;
		delete s.open[id];
	}
}

export function goOverview(s: State): void {
	s.page = "overview";
	s.lens = "story";
	scroll(s, "top");
}

export function openPage(m: Model, s: State, pid: string): void {
	s.page = pid;
	if (pid !== "overview") s.focus = m.pageHunks(pid)[0] ?? null;
	scroll(s, "top");
}

export function setLens(m: Model, s: State, lens: State["lens"]): void {
	if (s.lens === lens) return;
	s.lens = lens;
	if (lens === "attention") {
		const first = m.attentionOrder.find((x) => m.unitIds(x).some((h) => !s.seen[h])) ?? m.attentionOrder[0];
		const target = s.page === "overview" || !s.focus ? first : s.focus;
		if (target) focusHunk(m, s, target);
	} else if (s.focus) focusHunk(m, s, s.focus, { top: true });
	else s.page = "overview";
}

export function composeOn(m: Model, s: State, id: string): void {
	focusHunk(m, s, id, { scroll: false });
	s.open[id] = true;
	const i = Math.max(
		0,
		m.page.hunks[id].lines.findIndex((l) => l.t !== " "),
	);
	s.composer = { hunk: id, anchor: i, start: i, end: i, kind: "change", text: "" };
}

export function saveComposer(s: State): void {
	const c = s.composer;
	if (!c?.text.trim()) return;
	s.comments.push({
		id: `m${++s.seq}`,
		hunk: c.hunk,
		start: c.start,
		end: c.end,
		kind: c.kind,
		text: c.text.trim(),
		replyTo: c.replyTo,
	});
	s.composer = null;
}

export function toResult(m: Model, s: State, verdict: Verdict) {
	return {
		verdict,
		summary: s.summary.trim() || undefined,
		comments: s.comments.map(({ id: _id, ...c }) => c),
		decisions: Object.entries(s.decisions).map(([id, d]) => ({ id, choice: d.choice, note: d.note })),
		seen: m.page.order.filter((id) => s.seen[id]),
	};
}

export const pageIsChapter = (s: State) => s.page !== "overview" && s.page !== "hunk";
export { UNPLACED };
