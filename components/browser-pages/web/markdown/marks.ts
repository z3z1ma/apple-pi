import type { TextSpan } from "../../src/page-data.js";

/** Text that belongs to the document: the block's rendered content, without decorations the page adds. */
function textNodes(content: Element): Text[] {
	const out: Text[] = [];
	const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (node.parentElement?.closest(".deco, .mermaid-box, .lang, .alert-t")) continue;
		out.push(node as Text);
	}
	return out;
}

const contentOf = (block: string) => document.querySelector(`[data-content="${block}"]`);

/** The text offset in `content` of a selection boundary, which may sit in a text node or between an element's children. */
export function offsetIn(content: Element, node: Node, offset: number): number {
	const boundary = document.createRange();
	boundary.setStart(node, offset);
	let n = 0;
	for (const t of textNodes(content)) {
		if (t === node) return n + offset;
		if (boundary.comparePoint(t, t.data.length) > 0) break;
		n += t.data.length;
	}
	return n;
}

export interface Selected {
	spans: TextSpan[];
	quote: string;
	rect: DOMRect;
}

/** The current selection as one span per block it touches, or undefined when it holds no document text. */
export function readSelection(): Selected | undefined {
	const selection = getSelection();
	if (!selection || selection.isCollapsed) return undefined;
	const range = selection.getRangeAt(0);
	const spans: TextSpan[] = [];
	const parts: string[] = [];
	for (const content of document.querySelectorAll("[data-content]")) {
		if (!range.intersectsNode(content)) continue;
		const text = textNodes(content)
			.map((t) => t.data)
			.join("");
		const start = content.contains(range.startContainer)
			? offsetIn(content, range.startContainer, range.startOffset)
			: 0;
		const end = content.contains(range.endContainer)
			? offsetIn(content, range.endContainer, range.endOffset)
			: text.length;
		if (end <= start) continue;
		const part = text.slice(start, end).replace(/\s+/g, " ").trim();
		if (!part) continue;
		spans.push({ block: (content as HTMLElement).dataset.content!, start, end });
		parts.push(part);
	}
	if (!spans.length) return undefined;
	return { spans, quote: parts.join("\n"), rect: range.getBoundingClientRect() };
}

export interface Mark {
	id: string;
	spans: TextSpan[];
	className: string;
	/** Text shown after the last marked piece, such as a suggested replacement. */
	after?: { tag: "ins" | "span"; className: string; text: string };
}

/** Removes every mark and decoration, then wraps each mark's spans. Safe to call after any render. */
export function applyMarks(marks: Mark[]): void {
	for (const old of document.querySelectorAll("[data-content] mark.an")) old.replaceWith(...old.childNodes);
	for (const deco of document.querySelectorAll("[data-content] .deco")) deco.remove();
	for (const content of document.querySelectorAll("[data-content]")) content.normalize();
	for (const mark of marks) {
		let last: HTMLElement | undefined;
		for (const span of mark.spans) {
			const content = contentOf(span.block);
			if (!content || span.start === undefined || span.end === undefined) continue;
			let n = 0;
			for (const t of textNodes(content)) {
				const length = t.data.length;
				const a = Math.max(span.start, n);
				const b = Math.min(span.end, n + length);
				if (a < b) {
					const piece = t.splitText(a - n);
					piece.splitText(b - a);
					const el = document.createElement("mark");
					el.className = `an ${mark.className}`;
					el.dataset.an = mark.id;
					piece.parentNode?.insertBefore(el, piece);
					el.appendChild(piece);
					last = el;
				}
				n += length;
			}
		}
		if (last && mark.after) {
			const after = document.createElement(mark.after.tag);
			after.className = `deco ${mark.after.className}`;
			after.dataset.an = mark.id;
			after.textContent = mark.after.text;
			last.after(after);
		}
	}
}

/**
 * The annotations under a clicked element, innermost first. Overlapping annotations nest their marks, so a click
 * inside the overlap belongs to all of them.
 */
export function annotationsAt(target: Element): string[] {
	const ids: string[] = [];
	for (let el = target.closest("[data-an]"); el; el = el.parentElement?.closest("[data-an]") ?? null) {
		const id = (el as HTMLElement).dataset.an;
		if (id && !ids.includes(id)) ids.push(id);
	}
	return ids;
}
