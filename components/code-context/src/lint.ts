import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { wikiPageExists } from "../../wiki/src/graph.js";
import { CONTEXT_DIRECTORY, projectRoot, CONTEXT_FILE_EXTENSION } from "./context-file.js";

export type ContextFindingKind =
	| "orphaned-context-file"
	| "invalid-heading"
	| "duplicate-heading"
	| "missing-symbol"
	| "broken-coupled"
	| "broken-verify"
	| "broken-wiki-link";

export interface ContextFinding {
	kind: ContextFindingKind;
	/** Project-relative context file path, under `.context/`. */
	path: string;
	line?: number;
	message: string;
}

export interface ContextLintResult {
	contextFileCount: number;
	findings: ContextFinding[];
}

const HEADING = /^#{1,6}\s/;
const SECTION = /^## (file|symbol:(\S+))$/;
const PATH_FIELD = /^(Coupled|Verify):(.*)$/;
const WIKI_LINK = /\[\[([^\]|#]*)[^\]]*\]\]/g;
const FENCE = /^\s*(```|~~~)/;

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Project-relative paths of the Markdown files under `.context/`. */
function contextFilePaths(root: string): string[] {
	const directory = join(root, CONTEXT_DIRECTORY);
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(CONTEXT_FILE_EXTENSION))
		.map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"))
		.sort();
}

interface LintedContextFile {
	path: string;
	sourcePath: string;
	/** The source text, or undefined when the source file is gone. */
	source: string | undefined;
	seen: Set<string>;
}

function headingFindings(file: LintedContextFile, line: string, at: { path: string; line: number }): ContextFinding[] {
	const where = `${at.path}:${at.line}`;
	const section = SECTION.exec(line);
	if (!section)
		return [
			{ kind: "invalid-heading", ...at, message: `${where}: "${line}" is neither "## file" nor "## symbol:<name>"` },
		];
	const findings: ContextFinding[] = [];
	if (file.seen.has(line))
		findings.push({ kind: "duplicate-heading", ...at, message: `${where}: "${line}" appears more than once` });
	file.seen.add(line);
	const leaf = section[2]?.split(".").pop();
	if (file.source !== undefined && leaf && !new RegExp(`\\b${escapeRegExp(leaf)}\\b`).test(file.source))
		findings.push({
			kind: "missing-symbol",
			...at,
			message: `${where}: "${leaf}" does not appear in ${file.sourcePath}`,
		});
	return findings;
}

function referenceFindings(
	root: string,
	line: string,
	at: { path: string; line: number },
	isWikiPage: (target: string) => boolean,
): ContextFinding[] {
	const where = `${at.path}:${at.line}`;
	const findings: ContextFinding[] = [];
	const field = PATH_FIELD.exec(line);
	for (const listed of field?.[2]?.split(",") ?? []) {
		const path = listed.trim();
		if (path && !existsSync(join(root, path)))
			findings.push({
				kind: field?.[1] === "Coupled" ? "broken-coupled" : "broken-verify",
				...at,
				message: `${where}: ${field?.[1]} path ${path} does not exist`,
			});
	}
	for (const link of line.matchAll(WIKI_LINK))
		if (!isWikiPage((link[1] ?? "").trim()))
			findings.push({ kind: "broken-wiki-link", ...at, message: `${where}: ${link[0]} names no .wiki page` });
	return findings;
}

function lintContextFile(root: string, path: string, isWikiPage: (target: string) => boolean): ContextFinding[] {
	const sourcePath = path.slice(CONTEXT_DIRECTORY.length + 1, -CONTEXT_FILE_EXTENSION.length);
	const source = statSync(join(root, sourcePath), { throwIfNoEntry: false })?.isFile()
		? readFileSync(join(root, sourcePath), "utf8")
		: undefined;
	const file: LintedContextFile = { path, sourcePath, source, seen: new Set() };
	const findings: ContextFinding[] =
		source === undefined
			? [
					{
						kind: "orphaned-context-file",
						path,
						message: `${path}: source file ${sourcePath} does not exist or is not a file`,
					},
				]
			: [];
	let fenced = false;
	for (const [index, raw] of readFileSync(join(root, path), "utf8").split(/\r?\n/).entries()) {
		const line = raw.trimEnd();
		const at = { path, line: index + 1 };
		if (FENCE.test(line)) fenced = !fenced;
		if (fenced) continue;
		findings.push(
			...(HEADING.test(line) ? headingFindings(file, line, at) : referenceFindings(root, line, at, isWikiPage)),
		);
	}
	return findings;
}

/** Check every context file of the project holding `cwd` for structure and references that no longer hold. */
export async function lintContext(cwd: string, signal?: AbortSignal): Promise<ContextLintResult> {
	const root = projectRoot(cwd);
	const paths = contextFilePaths(root);
	const isWikiPage = existsSync(join(root, ".wiki")) ? await wikiPageExists(root, signal) : () => false;
	const findings: ContextFinding[] = [];
	for (const path of paths) {
		signal?.throwIfAborted();
		findings.push(...lintContextFile(root, path, isWikiPage));
	}
	return { contextFileCount: paths.length, findings };
}
