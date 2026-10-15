import type { MarkdownAnnotation, MarkdownLabel, MarkdownReviewPage, Verdict } from "../../src/page-data";
import type { Selected } from "./marks";

export type Annotation = MarkdownAnnotation & { id: string };
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
	/** Block id to the reviewer's rewrite of its source. */
	edits: Record<string, string>;
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

export function initial(page: MarkdownReviewPage): State {
	const r = page.result;
	const dark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
	return {
		annotations: (r?.annotations ?? []).map((a, i) => ({ ...a, id: `r${i}` })),
		edits: Object.fromEntries((r?.edits ?? []).map((e) => [e.block, e.after])),
		editing: null,
		diffOpen: {},
		overall: r?.overall ?? "",
		verdict: r?.verdict ?? null,
		modal: null,
		submit: r ? "sent" : "idle",
		panel: !!r,
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
export const annotation = (a: MarkdownAnnotation): Annotation => ({ ...a, id: `a${++created}` });

/** Adds an annotation in document order. */
export function addAnnotation(d: State, a: Annotation, order: Map<string, number>): void {
	d.annotations.push(a);
	const at = (x: MarkdownAnnotation) => (order.get(x.spans[0].block) ?? 0) * 1e9 + (x.spans[0].start ?? -1);
	d.annotations.sort((x, y) => at(x) - at(y));
}

/** The annotation a popover's text makes, or undefined when it makes none. */
export function composed(pop: Pop, text: string, why: string | undefined): Annotation | undefined {
	const sel = pop.selected;
	if (!text) return undefined;
	if (pop.kind === "block" && pop.block) return annotation({ type: "comment", spans: [{ block: pop.block }], text });
	if (!sel) return undefined;
	const at = { spans: sel.spans, quote: sel.quote };
	if (pop.kind === "comment") return annotation({ type: "comment", ...at, text });
	if (pop.kind === "ask") return annotation({ type: "ask", ...at, text });
	if (pop.kind === "suggest" && text !== sel.quote)
		return annotation({ type: "suggest", ...at, replacement: text, text: why });
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
