// Agents' replies as HTML: GitHub-flavoured Markdown through `marked`, the parser the repository already ships. A
// transcript is untrusted text, so raw HTML shows as text, links show their target without navigating (the window
// opens nothing), and images show as their alt text (the page loads no remote content).
import { Marked, type Tokens } from "marked";

const escapeHtml = (s: string) =>
	s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const marked = new Marked({ gfm: true, breaks: false });
marked.use({
	renderer: {
		html: (token: Tokens.HTML | Tokens.Tag) => escapeHtml(token.text),
		link(token: Tokens.Link) {
			const text = this.parser.parseInline(token.tokens);
			return `<span class="aw-md-link" title="${escapeHtml(token.href)}">${text}</span>`;
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

/** The HTML for one piece of Markdown; parsed once per text, since pages re-render as older history arrives. */
export function markdownHtml(text: string): string {
	let html = cache.get(text);
	if (html === undefined) {
		html = marked.parse(text, { async: false }) as string;
		if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
		cache.set(text, html);
	}
	return html;
}
