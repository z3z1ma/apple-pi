#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

const SOURCE = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|css)$/;
const SKIP = /(^|\/)(dist|node_modules|\.ledger)\//;
const DIRECTIVE =
	/^(\/\/\s*(biome-ignore|@ts-(expect-error|ignore|nocheck))|\/\/\/\s*<reference|\/\*\s*(biome-ignore|@vite-ignore|[#@]__PURE__|webpackIgnore))/;

function tracked(paths) {
	return execFileSync("git", ["ls-files", "-z", ...paths], { encoding: "utf8" })
		.split("\0")
		.filter((file) => file && SOURCE.test(file) && !SKIP.test(file));
}

function comments(file, text) {
	if (file.endsWith(".css"))
		return [...text.matchAll(/\/\*[\s\S]*?\*\//g)].map((match) => [
			text.slice(0, match.index).split("\n").length,
			match[0],
		]);
	const found = [];
	const variant = /\.(tsx|jsx)$/.test(file) ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard;
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.(tsx|jsx)$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
	const seen = new Set();
	const visit = (node) => {
		for (const ranges of [ts.getLeadingCommentRanges(text, node.pos), ts.getTrailingCommentRanges(text, node.end)])
			for (const range of ranges ?? []) {
				if (seen.has(range.pos)) continue;
				seen.add(range.pos);
				found.push([source.getLineAndCharacterOfPosition(range.pos).line + 1, text.slice(range.pos, range.end)]);
			}
		ts.forEachChild(node, visit);
	};
	visit(source);
	if (variant === ts.LanguageVariant.JSX)
		for (const match of text.matchAll(/\{\s*(\/\*[\s\S]*?\*\/)\s*\}/g)) {
			const at = match.index + match[0].indexOf(match[1]);
			if (seen.has(at)) continue;
			seen.add(at);
			found.push([text.slice(0, at).split("\n").length, match[1]]);
		}
	return found;
}

const files = tracked(process.argv.slice(2));
let count = 0;
for (const file of files) {
	const text = readFileSync(file, "utf8");
	for (const [line, comment] of comments(file, text)) {
		if (DIRECTIVE.test(comment.trimStart())) continue;
		count++;
		console.log(`${file}:${line}: ${comment.split("\n")[0].slice(0, 100)}`);
	}
}
if (count) {
	console.log(`\n${count} comments. Move the rationale to a name, a test, or .context/<path>.md (see lint/README.md).`);
	process.exit(1);
}
