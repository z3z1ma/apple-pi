import { Marked, type Tokens } from "marked";

import type { MarkdownBlock, Segment } from "../../src/page-data.js";

const escapeHtml = (s: string) =>
	s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/**
 * The page holds the session token, so document content must never run script. A URL is allowed when, after
 * decoding entities and percent escapes and dropping control characters, it has no scheme (a relative link or
 * an anchor) or an http, https, or mailto scheme.
 */
export function safeUrl(href: string): string | undefined {
	let decoded = href.replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)));
	decoded = decoded.replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d)));
	try {
		decoded = decodeURIComponent(decoded);
	} catch {
		return undefined;
	}
	decoded = decoded.replace(/[\u0000-\u0020\u007f-\u009f]/g, "").toLowerCase();
	const scheme = /^([a-z][a-z0-9+.-]*):/.exec(decoded)?.[1];
	return !scheme || scheme === "http" || scheme === "https" || scheme === "mailto" ? href : undefined;
}

const marked = new Marked({ gfm: true });
marked.use({
	renderer: {
		// Raw HTML is shown as text, never parsed.
		html: (token: Tokens.HTML | Tokens.Tag) => escapeHtml(token.text),
		link(token: Tokens.Link) {
			const text = this.parser.parseInline(token.tokens);
			const href = safeUrl(token.href);
			if (!href) return text;
			const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
			return `<a href="${escapeHtml(href)}"${title} target="_blank" rel="noopener noreferrer">${text}</a>`;
		},
		// Images load only from the web; local paths are not served, so they show as their alt text.
		image(token: Tokens.Image) {
			const href = safeUrl(token.href);
			if (!href || !/^https?:/i.test(href.trim()))
				return `<span class="img-alt">${escapeHtml(token.text || "image")}</span>`;
			return `<img src="${escapeHtml(href)}" alt="${escapeHtml(token.text)}" loading="lazy" />`;
		},
	},
});

const ALERT = /^\s*>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/i;
const COLOR = /^#[0-9a-f]{3,8}$/i;

/** HTML for one highlighted line: its text escaped, and only colour tokens let into the style. */
export function lineHtml(line: Segment[]): string {
	return line
		.map((seg) => {
			const style = [seg.c && COLOR.test(seg.c) ? `--c:${seg.c}` : "", seg.d && COLOR.test(seg.d) ? `--d:${seg.d}` : ""]
				.filter(Boolean)
				.join(";");
			return style ? `<span class="tk" style="${style}">${escapeHtml(seg.t)}</span>` : escapeHtml(seg.t);
		})
		.join("");
}

function codeHtml(lang: string, lines: Segment[][]): string {
	const body = lines.map(lineHtml).join("\n");
	return `<pre class="code">${lang ? `<span class="lang">${escapeHtml(lang)}</span>` : ""}<code>${body}</code></pre>`;
}

/** The fence body of a Mermaid block. */
export function mermaidSource(raw: string): string {
	const match = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?\1\s*$/.exec(raw.trim());
	return match ? match[2] : raw;
}

/** HTML for one block. Every path escapes the document's text; no raw HTML or unsafe URL survives. */
export function renderBlock(block: MarkdownBlock, raw = block.raw): string {
	if (raw === block.raw && block.code) return codeHtml(block.code.lang, block.code.lines);
	if (raw === block.raw && block.mermaid)
		return `<div class="mermaid-box"><pre class="mermaid">${escapeHtml(mermaidSource(raw))}</pre></div>`;
	const alert = ALERT.exec(raw);
	if (alert) {
		const kind = alert[1].toLowerCase();
		const body = raw.slice(alert[0].length).replace(/^\s*>\s?/gm, "");
		return `<div class="alert ${kind}"><div class="alert-t">${kind}</div>${marked.parse(body, { async: false })}</div>`;
	}
	return marked.parse(raw, { async: false });
}
