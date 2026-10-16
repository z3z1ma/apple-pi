import type { MarkdownAnnotation, MarkdownLabel, Verdict } from "../../src/page-data";
import type { Selected } from "./marks";

/** An annotation in the page: the wire annotation plus its id and the document it belongs to. */
export type Annotation = MarkdownAnnotation & { id: string; file: string };
/** Popovers that take text from the reviewer. */
export type ComposeKind = "comment" | "suggest" | "ask" | "block" | "overall";

export interface Pop {
	kind: ComposeKind | "view";
	x: number;
	y: number;
	selected?: Selected;
	/** The block a whole-block comment is about. */
	block?: string;
	/** The annotations a view popover shows, innermost first. */
	ids?: string[];
	/** The letter typed over a selection that opened a comment. */
	initial?: string;
}

export interface State {
	annotations: Annotation[];
	/** `blockKey(file, block)` to the reviewer's rewrite of that block's source. */
	edits: Record<string, string>;
	/** The `blockKey` of the block being rewritten. */
	editing: string | null;
	diffOpen: Record<string, boolean>;
	overall: string;
	verdict: Verdict | null;
	modal: "finish" | "keys" | null;
	submit: "idle" | "sending" | "sent" | "failed";
	panel: boolean;
	theme: "light" | "dark";
	noteHidden: boolean;
	toolbar: { x: number; y: number; selected: Selected } | null;
	pop: Pop | null;
}

/** One block of one document. */
export const blockKey = (file: string, block: string) => `${file}\n${block}`;
export function splitKey(key: string): { file: string; block: string } {
	const at = key.indexOf("\n");
	return { file: key.slice(0, at), block: key.slice(at + 1) };
}

/** A submitted review as a saved page carries it; a one-document page leaves `file` out. */
export interface SavedReview {
	verdict: Verdict;
	overall?: string;
	annotations: (MarkdownAnnotation & { file?: string })[];
	edits: { file?: string; block: string; after: string }[];
}

export const LABELS: Record<MarkdownLabel, { emoji: string; text: string }> = {
	good: { emoji: "👍", text: "Looks good" },
	clarify: { emoji: "❓", text: "Clarify this" },
};
const TYPE_LABEL: Record<Annotation["type"], string> = {
	comment: "Comment",
	delete: "Delete",
	suggest: "Suggested rewrite",
	label: "Label",
	ask: "Asked the agent",
};
export const annotationTitle = (a: MarkdownAnnotation) =>
	a.type === "label" ? `${LABELS[a.label ?? "good"].emoji} ${LABELS[a.label ?? "good"].text}` : TYPE_LABEL[a.type];

export const VERDICTS = [
	{ id: "approve", label: "Approve", detail: "Ready as it is." },
	{ id: "approve_notes", label: "Approve with notes", detail: "Ready once the agent applies my annotations." },
	{ id: "changes", label: "Request changes", detail: "Revise it and ask me again." },
] as const;

/** The page's state, or the submitted review's when the page is a saved copy. */
export function initial(result: SavedReview | undefined, file: string): State {
	const dark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
	return {
		annotations: (result?.annotations ?? []).map((a, i) => ({ ...a, file: a.file ?? file, id: `r${i}` })),
		edits: Object.fromEntries((result?.edits ?? []).map((e) => [blockKey(e.file ?? file, e.block), e.after])),
		editing: null,
		diffOpen: {},
		overall: result?.overall ?? "",
		verdict: result?.verdict ?? null,
		modal: null,
		submit: result ? "sent" : "idle",
		panel: !!result,
		theme: dark ? "dark" : "light",
		noteHidden: false,
		toolbar: null,
		pop: null,
	};
}

let created = 0;
/**
 * A new annotation with its id. Ids are made here, outside state updates, because React may run an update
 * function later or more than once.
 */
export const annotation = (a: MarkdownAnnotation, file: string): Annotation => ({ ...a, file, id: `a${++created}` });

/** Adds an annotation in review order: by document, then by place in it. */
export function addAnnotation(d: State, a: Annotation, position: (file: string, block: string) => number): void {
	d.annotations.push(a);
	const at = (x: Annotation) => position(x.file, x.spans[0].block);
	d.annotations.sort((x, y) => at(x) - at(y) || (x.spans[0].start ?? -1) - (y.spans[0].start ?? -1));
}

/** The annotation a popover's text makes in `file`, or undefined when it makes none. */
export function composed(pop: Pop, text: string, why: string | undefined, file: string): Annotation | undefined {
	const sel = pop.selected;
	if (!text) return undefined;
	if (pop.kind === "block" && pop.block)
		return annotation({ type: "comment", spans: [{ block: pop.block }], text }, file);
	if (!sel) return undefined;
	const at = { spans: sel.spans, quote: sel.quote };
	if (pop.kind === "comment") return annotation({ type: "comment", ...at, text }, file);
	if (pop.kind === "ask") return annotation({ type: "ask", ...at, text }, file);
	if (pop.kind === "suggest" && text !== sel.quote)
		return annotation({ type: "suggest", ...at, replacement: text, text: why }, file);
	return undefined;
}

/** Where a popover opens: under the selection, or near the top when there is none. */
export function popAt(rect?: DOMRect): { x: number; y: number } {
	if (!rect) return { x: innerWidth / 2 - 190, y: 90 };
	return {
		x: Math.min(Math.max(12, rect.left + rect.width / 2 - 190), innerWidth - 400),
		y: Math.min(rect.bottom + 10, innerHeight - 280),
	};
}
