// Agents' replies as HTML: GitHub-flavoured Markdown through `marked`, the parser the repository already ships. A
// transcript is untrusted text, so raw HTML shows as text, web links (http and https) become links the transcript
// opens in the system browser through the main process (the window itself never navigates), any other link shows its
// target as a title only, and images show as their alt text (the page loads no remote content).
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
			if (!/^https?:\/\//i.test(token.href))
				return `<span class="aw-md-link aw-md-link-dead" title="${href}">${text}</span>`;
			return `<a class="aw-md-link" href="${href}" title="${href}" rel="noreferrer noopener">${text}</a>`;
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
