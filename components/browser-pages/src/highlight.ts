import { bundledLanguages, createHighlighter, type BundledLanguage, type Highlighter } from "shiki";

import type { Segment } from "./page-data.js";

const THEMES = { light: "one-light", dark: "one-dark-pro" } as const;
const NAMED: Record<string, BundledLanguage> = { Dockerfile: "docker", Makefile: "make", Justfile: "just" };

let highlighter: Promise<Highlighter> | undefined;

export function languageOf(path: string): BundledLanguage | undefined {
	const name = path.slice(path.lastIndexOf("/") + 1);
	if (NAMED[name]) return NAMED[name];
	const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
	return ext in bundledLanguages ? (ext as BundledLanguage) : undefined;
}

/** Token segments for every line of `code`, with light and dark colors. Unknown languages come back plain. */
export async function highlightLines(code: string, path: string): Promise<Segment[][]> {
	const lines = code.replace(/\n$/, "").split("\n");
	const lang = languageOf(path);
	if (!lang) return lines.map((line) => [{ t: line.replace(/\r$/, "") }]);
	highlighter ??= createHighlighter({ themes: [THEMES.light, THEMES.dark], langs: [] });
	const h = await highlighter;
	if (!h.getLoadedLanguages().includes(lang)) await h.loadLanguage(lang);
	const lightFg = h.getTheme(THEMES.light).fg.toLowerCase();
	const darkFg = h.getTheme(THEMES.dark).fg.toLowerCase();
	const { tokens } = h.codeToTokens(code.replace(/\r\n/g, "\n"), { lang, themes: THEMES });
	return tokens.map((line) =>
		line.map((token) => {
			const style = (token.htmlStyle ?? {}) as Record<string, string>;
			const c = style.color?.toLowerCase();
			const d = style["--shiki-dark"]?.toLowerCase();
			if ((!c || c === lightFg) && (!d || d === darkFg)) return { t: token.content };
			return { t: token.content, c, d };
		}),
	);
}

/** Splits segments at the `[from, to)` character range and flags the pieces inside it. */
export function markRange(segments: Segment[], from: number, to: number): Segment[] {
	const out: Segment[] = [];
	let pos = 0;
	for (const seg of segments) {
		const start = pos;
		const end = pos + seg.t.length;
		pos = end;
		const cuts = [start, Math.min(Math.max(from, start), end), Math.min(Math.max(to, start), end), end];
		for (let i = 0; i < 3; i++) {
			const a = cuts[i];
			const b = cuts[i + 1];
			if (a === b) continue;
			const piece: Segment = { ...seg, t: seg.t.slice(a - start, b - start) };
			if (a >= from && b <= to) piece.m = 1;
			out.push(piece);
		}
	}
	return out;
}
