// Jira's and Confluence's HTML as the world shows it (tickets 24-26). It is untrusted: an issue's description or a page
// can carry anything its authors pasted. It is parsed in an inert document (DOMParser runs no script and loads
// nothing) and rebuilt from an allow-list: text and plain structure (paragraphs, headings, lists, tables, code, quotes)
// survive; scripts, styles, frames, forms, and every event handler and inline style are dropped. Images are not loaded
// (they would leak that the page was read, and need the operator's session): each shows as its name. Links keep only
// web and mail addresses, made absolute against the Atlassian site, and open in the system browser (the panel catches
// the click). Information panels, status lozenges, and mentions keep a class of the world's own so the skin can draw them.

/** Elements kept as they are (their allowed attributes only). */
const KEEP = new Set([
	"p",
	"br",
	"hr",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"strong",
	"b",
	"em",
	"i",
	"u",
	"s",
	"del",
	"ins",
	"sub",
	"sup",
	"small",
	"mark",
	"code",
	"pre",
	"kbd",
	"samp",
	"blockquote",
	"q",
	"cite",
	"ul",
	"ol",
	"li",
	"dl",
	"dt",
	"dd",
	"table",
	"thead",
	"tbody",
	"tfoot",
	"tr",
	"th",
	"td",
	"caption",
	"a",
	"abbr",
	"time",
	"details",
	"summary",
	"figure",
	"figcaption",
]);

/** Elements dropped with everything in them. */
const DROP = new Set([
	"script",
	"style",
	"link",
	"meta",
	"base",
	"title",
	"head",
	"iframe",
	"frame",
	"frameset",
	"object",
	"embed",
	"applet",
	"form",
	"input",
	"button",
	"select",
	"option",
	"textarea",
	"svg",
	"math",
	"template",
	"noscript",
	"canvas",
	"video",
	"audio",
	"source",
	"track",
	"map",
	"area",
	"portal",
]);

/** Containers whose classes mark something the skin draws (Confluence's and Jira's panels and lozenges). */
function classFor(element: Element): string | undefined {
	const names = element.getAttribute("class") ?? "";
	const panel = names.match(/confluence-information-macro-(note|warning|tip|information)/);
	if (panel) return `aw-rich-panel aw-rich-panel-${panel[1] === "information" ? "info" : panel[1]}`;
	if (/\bpanel\b/.test(names) && !/\bcode\b/.test(names)) return "aw-rich-panel";
	if (/\b(aui-lozenge|status-macro|jira-issue-status-lozenge)\b/.test(names)) return "aw-rich-lozenge";
	if (/\b(user-hover|confluence-userlink|user-mention)\b/.test(names)) return "aw-rich-mention";
	return undefined;
}

const SAFE_URL = /^(https?:|mailto:)/i;

/** A link's address, absolute against `base`, if it is a web or mail address; undefined otherwise. */
function linkFor(href: string | null, base: string | undefined): string | undefined {
	if (!href) return undefined;
	const trimmed = href.trim();
	if (trimmed.startsWith("#")) return undefined;
	try {
		const url = base ? new URL(trimmed, base) : new URL(trimmed);
		return SAFE_URL.test(url.protocol) ? url.href : undefined;
	} catch {
		return undefined;
	}
}

const number = (value: string | null, max: number) => {
	const n = Number(value);
	return Number.isInteger(n) && n > 0 && n <= max ? String(n) : undefined;
};

/** An image's name, for where it would have been: its alt text, or the file's name. */
function imageName(image: Element): string {
	const alt = image.getAttribute("alt")?.trim();
	if (alt) return alt;
	const src = image.getAttribute("data-image-src") ?? image.getAttribute("src") ?? "";
	const file = decodeURIComponent(src.split(/[?#]/)[0].split("/").pop() ?? "");
	return file || "image";
}

function copy(source: Node, into: Element, doc: Document, base: string | undefined, depth: number) {
	if (depth > 60) return;
	for (const node of [...source.childNodes]) {
		if (node.nodeType === Node.TEXT_NODE) {
			into.append(doc.createTextNode(node.textContent ?? ""));
			continue;
		}
		if (node.nodeType !== Node.ELEMENT_NODE) continue;
		const element = node as Element;
		const tag = element.localName.toLowerCase();
		if (DROP.has(tag)) continue;
		if (tag === "img") {
			// Emoticons read as their text; anything else as a named placeholder.
			const name = imageName(element);
			if (/\bemoticon\b/.test(element.getAttribute("class") ?? "")) into.append(doc.createTextNode(name));
			else {
				const placeholder = doc.createElement("span");
				placeholder.className = "aw-rich-image";
				placeholder.textContent = name;
				into.append(placeholder);
			}
			continue;
		}
		if (!KEEP.has(tag)) {
			// Unknown containers (div, span, section...) keep their content; a few keep a class of the world's own.
			const kind = classFor(element);
			const block = /^(div|section|article|aside|header|footer|main|nav|center)$/.test(tag);
			if (kind || block) {
				const wrapper = doc.createElement(block ? "div" : "span");
				if (kind) wrapper.className = kind;
				copy(element, wrapper, doc, base, depth + 1);
				into.append(wrapper);
			} else copy(element, into, doc, base, depth + 1);
			continue;
		}
		const out = doc.createElement(tag);
		if (tag === "a") {
			const href = linkFor(element.getAttribute("href"), base);
			if (href) {
				out.setAttribute("href", href);
				out.setAttribute("title", href);
				out.setAttribute("rel", "noreferrer noopener");
				out.className = classFor(element) === "aw-rich-mention" ? "aw-rich-link aw-rich-mention" : "aw-rich-link";
			} else {
				// Not a web link: its text stays, as text.
				copy(element, into, doc, base, depth + 1);
				continue;
			}
		}
		if (tag === "td" || tag === "th") {
			const colspan = number(element.getAttribute("colspan"), 50);
			const rowspan = number(element.getAttribute("rowspan"), 200);
			if (colspan) out.setAttribute("colspan", colspan);
			if (rowspan) out.setAttribute("rowspan", rowspan);
		}
		if (tag === "ol") {
			const start = number(element.getAttribute("start"), 100_000);
			if (start) out.setAttribute("start", start);
		}
		if (tag === "abbr") {
			const title = element.getAttribute("title");
			if (title) out.setAttribute("title", title);
		}
		if (tag === "span" || tag === "code") {
			const kind = classFor(element);
			if (kind) out.className = kind;
		}
		copy(element, out, doc, base, depth + 1);
		into.append(out);
	}
}

/**
 * Untrusted HTML as HTML safe to show: only allowed elements and attributes, links made absolute against `base` (the
 * Atlassian site) and limited to web and mail addresses, images as their names. Empty input gives "".
 */
export function safeHtml(html: string | null | undefined, base?: string): string {
	if (!html?.trim()) return "";
	const parsed = new DOMParser().parseFromString(html, "text/html");
	const doc = document.implementation.createHTMLDocument("");
	const root = doc.createElement("div");
	copy(parsed.body, root, doc, base, 0);
	// Drop empty paragraphs Jira and Confluence leave between blocks.
	for (const p of [...root.querySelectorAll("p")])
		if (!p.textContent?.trim() && !p.querySelector("br, span")) p.remove();
	return root.innerHTML;
}

/** Plain text as safe HTML paragraphs (when only the text was given). */
export function textHtml(text: string): string {
	const doc = document.implementation.createHTMLDocument("");
	const root = doc.createElement("div");
	for (const block of text.split(/\n{2,}/)) {
		if (!block.trim()) continue;
		const p = doc.createElement("p");
		block.split("\n").forEach((line, i) => {
			if (i) p.append(doc.createElement("br"));
			p.append(doc.createTextNode(line));
		});
		root.append(p);
	}
	return root.innerHTML;
}
