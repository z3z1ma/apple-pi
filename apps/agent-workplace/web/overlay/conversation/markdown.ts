import { Marked, type Tokens } from "marked";

const escapeHtml = (s: string) =>
	s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const marked = new Marked({ gfm: true, breaks: false });
marked.use({
	renderer: {
		html: (token: Tokens.HTML | Tokens.Tag) => escapeHtml(token.text),
		link(token: Tokens.Link) {
			const text = this.parser.parseInline(token.tokens);
			const href = escapeHtml(token.href);
			if (/^https?:\/\//i.test(token.href))
				return `<a class="aw-md-link" href="${href}" title="${href}" rel="noreferrer noopener">${text}</a>`;

			if (/^file:/i.test(token.href) || !/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(token.href))
				return `<a class="aw-md-link aw-md-file" href="${href}" title="${href}" data-file="">${text}</a>`;
			return `<span class="aw-md-link aw-md-link-dead" title="${href}">${text}</span>`;
		},
		image: (token: Tokens.Image) => `<span class="aw-md-image">${escapeHtml(token.text || "image")}</span>`,
		code(token: Tokens.Code) {
			const lang = (token.lang ?? "").trim().split(/\s/)[0];
			const label = lang ? `<span class="aw-md-lang">${escapeHtml(lang)}</span>` : "";
			return `<pre class="aw-md-code">${label}<code>${escapeHtml(token.text)}</code></pre>`;
		},
	},
});

const cache = new Map<string, string>();
const CACHE_MAX = 800;

export function markdownHtml(text: string): string {
	let html = cache.get(text);
	if (html === undefined) {
		html = marked.parse(text, { async: false }) as string;
		if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
		cache.set(text, html);
	}
	return html;
}
