import { Marked, type Tokens } from "marked";

const escapeHtml = (s: string) =>
	s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

function markdownParser(wikiLinks?: Record<string, string>) {
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
	if (wikiLinks)
		marked.use({
			extensions: [
				{
					name: "wikiLink",
					level: "inline",
					start: (source) => source.indexOf("[["),
					tokenizer(source) {
						const match = /^\[\[([^\]\n]+)\]\]/.exec(source);
						if (match) return { type: "wikiLink", raw: match[0], text: match[1] };
					},
					renderer(token) {
						const value = String(token.text);
						const target = value.split(/[|#]/)[0]!.trim().normalize("NFKC").toLowerCase();
						const label = value.includes("|") ? value.slice(value.indexOf("|") + 1) : value;
						const id = wikiLinks[target];
						return id
							? `<a class="aw-md-link" href="#knowledge/${encodeURIComponent(id)}">${escapeHtml(label)}</a>`
							: `<span class="aw-md-link-dead">${escapeHtml(label)}</span>`;
					},
				},
			],
		});
	return marked;
}
const marked = markdownParser();

const cache = new Map<string, string>();
const CACHE_MAX = 800;

export function markdownHtml(text: string, wikiLinks?: Record<string, string>): string {
	if (wikiLinks) return markdownParser(wikiLinks).parse(text, { async: false }) as string;
	let html = cache.get(text);
	if (html === undefined) {
		html = marked.parse(text, { async: false }) as string;
		if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
		cache.set(text, html);
	}
	return html;
}
