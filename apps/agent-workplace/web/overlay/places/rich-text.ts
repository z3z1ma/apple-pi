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

export function safeHtml(html: string | null | undefined, base?: string): string {
	if (!html?.trim()) return "";
	const parsed = new DOMParser().parseFromString(html, "text/html");
	const doc = document.implementation.createHTMLDocument("");
	const root = doc.createElement("div");
	copy(parsed.body, root, doc, base, 0);

	for (const p of [...root.querySelectorAll("p")])
		if (!p.textContent?.trim() && !p.querySelector("br, span")) p.remove();
	return root.innerHTML;
}

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
