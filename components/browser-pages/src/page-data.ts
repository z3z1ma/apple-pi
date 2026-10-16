// The data contract between the Node side and the browser page. The page imports these types only.

export type Attention = "high" | "medium" | "low";
export type ChapterKind = "core" | "consequence" | "support";
export type LineType = " " | "+" | "-";

/** One run of text on a diff line. `c`/`d` are the light/dark token colors; `m` marks a word-level change. */
export interface Segment {
	t: string;
	c?: string;
	d?: string;
	m?: 1;
}

export interface DiffLine {
	t: LineType;
	o?: number;
	n?: number;
	s: Segment[];
}

export interface DiffFile {
	path: string;
	oldPath?: string;
	status: "A" | "M" | "D" | "R";
	generated: boolean;
	binary: boolean;
}

export interface Hunk {
	id: string;
	file: string;
	lines: DiffLine[];
	adds: number;
	dels: number;
	/** Why the hunk has no text lines, such as "Binary file". */
	note?: string;
}

export interface ChapterChange {
	id: string;
	summary?: string;
	attention?: Attention;
	pattern?: string;
}

export interface Chapter {
	id: string;
	title: string;
	kind: ChapterKind;
	attention: Attention;
	brief: string[];
	callouts: { title: string; text: string }[];
	changes: ChapterChange[];
}

export interface Pattern {
	id: string;
	summary: string;
	hunks: string[];
	/** Places that are more than a consistent rename of the first place. A hint, not proof. */
	differs: string[];
}

export interface Anchor {
	hunk: string;
	/** Index into the hunk's lines. */
	idx: number;
	/** Human label such as "L41" or "old L12". */
	label: string;
}

export interface Note extends Anchor {
	id: string;
	text: string;
}

export interface Decision extends Anchor {
	id: string;
	question: string;
	context?: string;
	options: { label: string; detail?: string }[];
	/** Index of the agent's choice; absent for an open question. */
	chosen?: number;
}

export interface Verification {
	status: "pass" | "fail" | "unverified";
	label: string;
	detail?: string;
}

export interface CodeReviewPage {
	kind: "code-review";
	title: string;
	intent: string;
	base: string;
	head: string;
	createdAt: string;
	focus?: { text: string; hunks: string[] };
	verification: Verification[];
	files: DiffFile[];
	hunks: Record<string, Hunk>;
	/** Every hunk id in diff order. */
	order: string[];
	chapters: Chapter[];
	patterns: Record<string, Pattern>;
	notes: Note[];
	decisions: Decision[];
	/** Problems with the agent's references, shown to the reviewer as well as returned to the agent. */
	warnings: string[];
	/** `live` pages accept a verdict; `ask` says whether the page can ask the agent questions. */
	session: { token: string; live: boolean; ask: boolean };
	/** Present on a saved page: the review as submitted. */
	result?: ReviewResult;
}

export type CommentKind = "change" | "question" | "concern" | "nit" | "praise";
export type Verdict = "approve" | "approve_notes" | "changes" | "dismissed";

export interface ReviewComment {
	hunk: string;
	start: number;
	end: number;
	kind: CommentKind;
	text: string;
	/** Note id when the comment replies to an agent note. */
	replyTo?: string;
}

/** A question the reviewer asked in the page, with the answer a read-only fork of the agent gave. */
export interface AskedQuestion {
	hunk: string;
	start: number;
	end: number;
	question: string;
	answer: string;
}

export interface ReviewResult {
	verdict: Verdict;
	summary?: string;
	comments: ReviewComment[];
	asked: AskedQuestion[];
	decisions: { id: string; choice: number; note?: string }[];
	seen: string[];
	submittedAt: string;
}

/** One top-level Markdown block, as the server's lexer split the file. */
export interface MarkdownBlock {
	id: string;
	raw: string;
	/** First and last source line, 1-based. */
	line: number;
	endLine: number;
	/** Code fences arrive highlighted, so the page needs no grammars. */
	code?: { lang: string; lines: Segment[][] };
	mermaid?: boolean;
	heading?: { depth: number; text: string };
}

export interface MarkdownReviewPage {
	kind: "markdown-review";
	title: string;
	path: string;
	/** One optional line from the agent, shown above the document. */
	note?: string;
	createdAt: string;
	blocks: MarkdownBlock[];
	session: { token: string; live: boolean; ask: boolean };
	result?: MarkdownResult;
}

/** Part of an annotation inside one block; without offsets it covers the whole block. */
export interface TextSpan {
	block: string;
	start?: number;
	end?: number;
}

export type MarkdownLabel = "good" | "clarify";

export interface MarkdownAnnotation {
	type: "comment" | "delete" | "suggest" | "label" | "ask";
	spans: TextSpan[];
	quote?: string;
	text?: string;
	replacement?: string;
	label?: MarkdownLabel;
	answer?: string;
}

export interface MarkdownResult {
	verdict: Verdict;
	overall?: string;
	annotations: MarkdownAnnotation[];
	/** Blocks the reviewer rewrote in the page; the file itself is unchanged. */
	edits: { block: string; after: string }[];
	submittedAt: string;
}

/** A ticket in a ledger bundle, as its `tickets/NN-*.md` file states it. */
export interface Ticket {
	id: number;
	path: string;
	title: string;
	/** As written after `**Status:**`, such as `ready-for-agent`, `in-progress`, or `done`. */
	status: string;
	/** Tickets in the bundle this one waits on. */
	blockers: number[];
	/** Numbers named under `**Blocked by:**` that are not tickets in the bundle. */
	unknown: number[];
	/** Acceptance checkboxes ticked, and all of them. */
	done: number;
	total: number;
}

/** A file in the bundle that is not Markdown. The page asks for its lines when the reviewer opens it. */
export interface EvidenceFile {
	path: string;
	bytes: number;
	/** Present once served: highlighted lines, or `binary` for a file that is not text. */
	lines?: Segment[][];
	binary?: boolean;
}

export interface LedgerReviewPage {
	kind: "ledger-review";
	title: string;
	/** The bundle, relative to the repository, such as `.ledger/<id>`. */
	path: string;
	status?: string;
	created?: string;
	updated?: string;
	note?: string;
	createdAt: string;
	/** Every Markdown file, in reading order: task, spec or plan, other documents, tickets, retrospective. */
	documents: { path: string; blocks: MarkdownBlock[] }[];
	evidence: EvidenceFile[];
	tickets: Ticket[];
	session: { token: string; live: boolean; ask: boolean };
	result?: LedgerResult;
}

export interface LedgerAnnotation extends MarkdownAnnotation {
	file: string;
}

export interface LedgerResult {
	verdict: Verdict;
	overall?: string;
	annotations: LedgerAnnotation[];
	edits: { file: string; block: string; after: string }[];
	/** Documents and evidence files the reviewer opened. */
	opened: string[];
	submittedAt: string;
}

/** Real lines of one file, read from git: new and unchanged lines numbered, removed lines placed where they were. */
export interface CodeExcerpt {
	path: string;
	from: number;
	to: number;
	/**
	 * `new` for a file the change adds, `changed` for one it edits, `unchanged` for one it leaves alone, and
	 * `deleted` for one it removes, whose rows are all removed lines numbered as they were before the change.
	 */
	status: "new" | "changed" | "unchanged" | "deleted";
	rows: { t: LineType; n?: number; s: Segment[] }[];
}

/** A piece of an explanation section: a Markdown block, a code excerpt, a sandboxed figure, or a reference that failed. */
export type ExplainPart =
	| { block: MarkdownBlock }
	| { code: CodeExcerpt }
	| { figure: { caption: string; html: string } }
	| { missing: string };

export interface QuizQuestion {
	question: string;
	options: string[];
	answer: number;
	why: string;
}

export interface ExplainChangePage {
	kind: "explain-change";
	title: string;
	/** What is explained, such as `72c7ad3` or `main…working tree`, and the commit subject for a single commit. */
	ref: string;
	subject?: string;
	/** Every changed file, with lines added and removed. */
	stats: { path: string; add: number; del: number }[];
	/** Changed files the explanation shows code from. */
	covered: string[];
	summary: ExplainPart[];
	primer?: ExplainPart[];
	background: ExplainPart[];
	intuition: ExplainPart[];
	steps: { title: string; parts: ExplainPart[] }[];
	quiz: QuizQuestion[];
	createdAt: string;
	session: { token: string; live: boolean; ask: boolean };
}

/** One message the explanation page sends the tutor, with the conversation so far. */
export interface TutorTurn {
	message: string;
	mode: "socratic" | "direct";
	thread: { role: "reader" | "tutor"; text: string }[];
	/** Where the conversation started: a missed question, a step check, or a passage the reader selected. */
	start?: {
		kind: "talk" | "check" | "ask" | "quiz";
		step?: number;
		question?: number;
		choice?: number;
		quote?: string;
	};
}

export type PageData = CodeReviewPage | MarkdownReviewPage | LedgerReviewPage | ExplainChangePage;

export const PAGE_DATA_MARKER = '<script id="page-data" type="application/json">null</script>';
