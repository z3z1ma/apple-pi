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
	session: { token: string; live: boolean };
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

export interface ReviewResult {
	verdict: Verdict;
	summary?: string;
	comments: ReviewComment[];
	decisions: { id: string; choice: number; note?: string }[];
	seen: string[];
	submittedAt: string;
}

export const PAGE_DATA_MARKER = '<script id="page-data" type="application/json">null</script>';
