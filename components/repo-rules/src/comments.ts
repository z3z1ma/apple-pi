import ts from "typescript";

export const COMMENTED_SOURCE = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|css)$/;

const DIRECTIVE =
	/^(\/\/\s*(biome-ignore|@ts-(expect-error|ignore|nocheck))|\/\/\/\s*<reference|\/\*\s*(biome-ignore|@vite-ignore|[#@]__PURE__|webpackIgnore))/;

export interface SourceComment {
	line: number;
	text: string;
}

function allComments(path: string, text: string): SourceComment[] {
	if (path.endsWith(".css"))
		return [...text.matchAll(/\/\*[\s\S]*?\*\//g)].map((match) => ({
			line: text.slice(0, match.index).split("\n").length,
			text: match[0],
		}));
	const jsx = /\.(tsx|jsx)$/.test(path);
	const source = ts.createSourceFile(
		path,
		text,
		ts.ScriptTarget.Latest,
		true,
		jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const seen = new Set<number>();
	const found: SourceComment[] = [];
	const add = (pos: number, end: number) => {
		if (seen.has(pos)) return;
		seen.add(pos);
		found.push({ line: source.getLineAndCharacterOfPosition(pos).line + 1, text: text.slice(pos, end) });
	};
	const visit = (node: ts.Node) => {
		for (const ranges of [ts.getLeadingCommentRanges(text, node.pos), ts.getTrailingCommentRanges(text, node.end)])
			for (const range of ranges ?? []) add(range.pos, range.end);
		ts.forEachChild(node, visit);
	};
	visit(source);
	if (jsx)
		for (const match of text.matchAll(/\{\s*(\/\*[\s\S]*?\*\/)\s*\}/g)) {
			const at = (match.index ?? 0) + match[0].indexOf(match[1]!);
			add(at, at + match[1]!.length);
		}
	return found;
}

export function sourceComments(path: string, text: string): SourceComment[] {
	if (!COMMENTED_SOURCE.test(path)) return [];
	return allComments(path, text).filter((comment) => !DIRECTIVE.test(comment.text.trimStart()));
}

export function addedComments(path: string, before: string, after: string): SourceComment[] {
	const remaining = new Map<string, number>();
	for (const comment of sourceComments(path, before))
		remaining.set(comment.text, (remaining.get(comment.text) ?? 0) + 1);
	return sourceComments(path, after).filter((comment) => {
		const left = remaining.get(comment.text) ?? 0;
		if (left > 0) {
			remaining.set(comment.text, left - 1);
			return false;
		}
		return true;
	});
}
