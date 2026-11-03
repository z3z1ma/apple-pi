export type Attention = "high" | "medium" | "low";
export type ChapterKind = "core" | "consequence" | "support";
export type LineType = " " | "+" | "-";

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
	brief: MarkdownBlock[];
	callouts: { title: string; text: string }[];
	changes: ChapterChange[];
}

export interface Pattern {
	id: string;
	summary: string;
	hunks: string[];
	differs: string[];
}

export interface Anchor {
	hunk: string;
	idx: number;
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
	chosen?: number;
}

export interface Verification {
	status: "pass" | "fail" | "unverified";
	label: string;
	detail?: string;
}

export interface CodeReviewPage {
	kind: "code-review";
	capture?: {
		review: string;
		digest: string;
		revision: number;
		planRevision: number;
		limits: string[];
		freshness: {
			requestedTarget: string;
			checkout: string;
			policy: string;
			checkedAt: number | null;
			errors: string[];
		};
	};
	title: string;
	intent: MarkdownBlock[];
	base: string;
	head: string;
	createdAt: string;
	focus?: { blocks: MarkdownBlock[]; hunks: string[] };
	verification: Verification[];
	files: DiffFile[];
	hunks: Record<string, Hunk>;
	order: string[];
	chapters: Chapter[];
	patterns: Record<string, Pattern>;
	notes: Note[];
	decisions: Decision[];
	warnings: string[];
	session: { token: string; live: boolean; ask: boolean };
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
	replyTo?: string;
}

export interface AskedQuestion {
	hunk: string;
	start: number;
	end: number;
	question: string;
	answer: string;
}

export interface ReviewResult {
	capture?: { review: string; digest: string; revision: number; planRevision: number; acceptLimits: boolean };
	verdict: Verdict;
	summary?: string;
	comments: ReviewComment[];
	asked: AskedQuestion[];
	decisions: { id: string; choice: number; note?: string }[];
	seen: string[];
	submittedAt: string;
}

export interface MarkdownBlock {
	id: string;
	raw: string;
	line: number;
	endLine: number;
	code?: { lang: string; lines: Segment[][] };
	mermaid?: boolean;
	heading?: { depth: number; text: string };
}

export interface MarkdownReviewPage {
	kind: "markdown-review";
	title: string;
	path: string;
	note?: string;
	createdAt: string;
	blocks: MarkdownBlock[];
	session: { token: string; live: boolean; ask: boolean };
	result?: MarkdownResult;
}

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
	edits: { block: string; after: string }[];
	submittedAt: string;
}

export interface Ticket {
	id: number;
	path: string;
	title: string;
	status: string;
	blockers: number[];
	unknown: number[];
	done: number;
	total: number;
}

export interface EvidenceFile {
	path: string;
	bytes: number;
	lines?: Segment[][];
	binary?: boolean;
}

export interface LedgerReviewPage {
	kind: "ledger-review";
	title: string;
	path: string;
	status?: string;
	created?: string;
	updated?: string;
	note?: string;
	createdAt: string;
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
	opened: string[];
	submittedAt: string;
}

export interface CodeExcerpt {
	path: string;
	from: number;
	to: number;
	status: "new" | "changed" | "unchanged" | "deleted";
	rows: { t: LineType; n?: number; s: Segment[] }[];
}

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
	ref: string;
	subject?: string;
	stats: { path: string; add: number; del: number }[];
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

export interface TutorTurn {
	message: string;
	mode: "socratic" | "direct";
	thread: { role: "reader" | "tutor"; text: string }[];
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
