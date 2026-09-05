import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BASELINE_PROTECTED_ROOTS, loadSearchRootGuardConfig, type SearchRootGuardConfig } from "./config.js";

// This guard is deliberately dumb and best-effort. Its only job is to stop the obvious case of an
// agent grepping or globbing over a directory we know is huge and slow (home, "/", or a configured
// root) by no fault of its own. It is not a shell interpreter and does not try to resist deliberate
// evasion. Anywhere a command gets genuinely ambiguous (a shell variable, command substitution,
// pipeline, wrapper command, loop, function, eval, xargs, an unresolvable `cd` target, ...), it gives
// up and lets the command run rather than trying to be clever about it.

const PI_SEARCH_TOOLS = new Set(["grep", "find", "glob"]);
const SEARCH_COMMANDS = new Set(["rg", "ripgrep", "grep", "egrep", "fgrep", "find", "fd", "fdfind"]);
// Only bare `find` takes paths with no leading pattern argument; `fd`/`fdfind` (like rg/grep) take
// PATTERN first.
const NO_LEADING_PATTERN_COMMANDS = new Set(["find"]);
const BRACED_HOME = "$" + "{HOME}";

type ShellWord = { raw: string; value: string };

export interface SearchRootPolicy extends SearchRootGuardConfig {
	home: string;
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function commandName(value: string): string {
	return value.split("/").at(-1) ?? value;
}

// Callers always pass an already-absolute path (canonicalRoot resolves relative input against the
// invocation cwd first), so resolve() here only normalizes (strips trailing slashes, collapses
// "..") — it never falls back to process.cwd().
function canonicalPath(path: string): string {
	try {
		return realpathSync.native(path);
	} catch {
		return resolve(path);
	}
}

// Plain-string $HOME/${HOME}/~ expansion for JSON-string inputs (protected-root config entries and
// PI grep/find/glob tool path fields) that have no shell-quoting nuance to worry about.
function expandHome(value: string, home: string): string {
	if (value === "~") return home;
	if (value.startsWith("~/")) return `${home}/${value.slice(2)}`;
	if (value === "$HOME" || value === BRACED_HOME) return home;
	if (value.startsWith("$HOME/")) return `${home}/${value.slice("$HOME/".length)}`;
	if (value.startsWith(`${BRACED_HOME}/`)) return `${home}/${value.slice(BRACED_HOME.length + 1)}`;
	return value;
}

// Expands ~/$HOME, joins a relative result against the invocation's cwd (never the process's own
// cwd), and resolves symlinks.
function canonicalRoot(value: string, cwd: string, home: string): string {
	const expanded = value.startsWith("file://") ? fileURLToPath(value) : expandHome(value, home);
	return canonicalPath(isAbsolute(expanded) ? expanded : resolve(cwd, expanded));
}

function protectedSearchRoots(cwd: string, policy: SearchRootPolicy): string[] {
	return policy.protectedRoots.map((root) => canonicalRoot(root, cwd, policy.home));
}

// A search root is blocked when it is exactly a protected root, or an ancestor of one (searching "/"
// necessarily walks into "~", so it must also be treated as touching the protected home directory).
function matchingProtectedRoot(value: string, cwd: string, policy: SearchRootPolicy): string | undefined {
	const root = canonicalRoot(value, cwd, policy.home);
	return protectedSearchRoots(cwd, policy).find((protectedRoot) => {
		if (root === protectedRoot) return true;
		const prefix = root === "/" ? "/" : `${root}/`;
		return protectedRoot.startsWith(prefix);
	});
}

// --- best-effort heredoc-body masking ------------------------------------------------------------
//
// A heredoc body is data being written by the command, not shell syntax, so its content (which
// might innocently mention "grep" or "cd /" as plain text) must never be tokenized as if it were a
// real command. This is the one piece of real shell-parsing precision this guard keeps, because
// heredocs are an extremely common, everyday pattern for agents writing scripts or documents.

type PendingHeredoc = { dashed: boolean; delimiter: string };

function heredocDelimiterEnd(command: string, start: number): { delimiter: string; end: number } | undefined {
	let index = start;
	while (command[index] === " " || command[index] === "\t") index += 1;
	let delimiter = "";
	let quote: "'" | '"' | undefined;
	let escaped = false;
	let sawAny = false;
	while (index < command.length) {
		const character = command[index]!;
		if (escaped) {
			delimiter += character;
			escaped = false;
			index += 1;
			sawAny = true;
			continue;
		}
		if (character === "\\" && quote !== "'") {
			escaped = true;
			index += 1;
			continue;
		}
		if (quote) {
			if (character === quote) quote = undefined;
			else delimiter += character;
			index += 1;
			sawAny = true;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			index += 1;
			sawAny = true;
			continue;
		}
		if (/[\s;&|()<>\n]/.test(character)) break;
		delimiter += character;
		sawAny = true;
		index += 1;
	}
	return sawAny ? { delimiter, end: index } : undefined;
}

function heredocTerminatorEnd(command: string, bodyStart: number, heredoc: PendingHeredoc): number {
	let cursor = bodyStart;
	while (cursor <= command.length) {
		const newlineIndex = command.indexOf("\n", cursor);
		const lineEnd = newlineIndex === -1 ? command.length : newlineIndex;
		const line = command.slice(cursor, lineEnd);
		const comparable = heredoc.dashed ? line.replace(/^\t+/, "") : line;
		if (comparable === heredoc.delimiter || newlineIndex === -1) {
			return newlineIndex === -1 ? command.length : newlineIndex + 1;
		}
		cursor = newlineIndex + 1;
	}
	return command.length;
}

function consumeHeredocBodies(command: string, pending: PendingHeredoc[], newlineIndex: number): number {
	let bodyStart = newlineIndex + 1;
	for (const heredoc of pending) bodyStart = heredocTerminatorEnd(command, bodyStart, heredoc);
	return bodyStart;
}

function maskHeredocBodies(command: string): string {
	let output = "";
	let index = 0;
	let quote: "'" | '"' | undefined;
	let escaped = false;
	const pending: PendingHeredoc[] = [];
	while (index < command.length) {
		const character = command[index]!;
		if (escaped) {
			output += character;
			escaped = false;
			index += 1;
			continue;
		}
		if (character === "\\" && quote !== "'") {
			escaped = true;
			output += character;
			index += 1;
			continue;
		}
		if (quote) {
			output += character;
			if (character === quote) quote = undefined;
			index += 1;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			output += character;
			index += 1;
			continue;
		}
		if (character === "<") {
			let run = index;
			while (command[run] === "<") run += 1;
			if (run - index === 2) {
				let cursor = run;
				let dashed = false;
				if (command[cursor] === "-") {
					dashed = true;
					cursor += 1;
				}
				const parsed = heredocDelimiterEnd(command, cursor);
				if (parsed?.delimiter) {
					output += command.slice(index, parsed.end);
					pending.push({ dashed, delimiter: parsed.delimiter });
					index = parsed.end;
					continue;
				}
			}
			output += command.slice(index, run);
			index = run;
			continue;
		}
		if (character === "\n" && pending.length > 0) {
			index = consumeHeredocBodies(command, pending, index);
			pending.length = 0;
			output += "\n";
			continue;
		}
		output += character;
		index += 1;
	}
	return output;
}

// --- best-effort bash tokenizing ------------------------------------------------------------------
//
// Split on top-level `;`, `|`, `&`, and newline, respecting quotes only. Unlike a real shell, this
// does not track `$(...)`/backtick/paren nesting: a separator character inside a command
// substitution can cause an over-eager split. That is an accepted, deliberate imprecision — this
// guard does not try to fully parse nested shell constructs, it gives up on them.
function bashSegments(command: string): string[] {
	const segments: string[] = [];
	let start = 0;
	let quote: "'" | '"' | undefined;
	let escaped = false;
	for (let index = 0; index < command.length; index += 1) {
		const character = command[index]!;
		if (escaped) {
			escaped = false;
			continue;
		}
		if (character === "\\" && quote !== "'") {
			escaped = true;
			continue;
		}
		if (quote) {
			if (character === quote) quote = undefined;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			continue;
		}
		if (character === ";" || character === "|" || character === "&" || character === "\n") {
			segments.push(command.slice(start, index));
			start = index + 1;
		}
	}
	segments.push(command.slice(start));
	return segments;
}

function shellWords(segment: string): ShellWord[] {
	const words: ShellWord[] = [];
	let index = 0;
	while (index < segment.length) {
		while (index < segment.length && /[\s;&|()]/.test(segment[index]!)) index += 1;
		if (index >= segment.length) break;
		const start = index;
		let value = "";
		let quote: "'" | '"' | undefined;
		while (index < segment.length) {
			const character = segment[index]!;
			if (!quote && /[\s;&|()]/.test(character)) break;
			if (character === "\\" && quote !== "'") {
				index += 1;
				if (index < segment.length) value += segment[index]!;
				index += 1;
				continue;
			}
			if (quote) {
				if (character === quote) quote = undefined;
				else value += character;
				index += 1;
				continue;
			}
			if (character === "'" || character === '"') {
				quote = character;
				index += 1;
				continue;
			}
			value += character;
			index += 1;
		}
		words.push({ raw: segment.slice(start, index), value });
	}
	return words;
}

function isAssignment(value: string): boolean {
	return /^[A-Za-z_]\w*=/.test(value);
}

// Recognizes a search command as the effective first word of a segment, seeing through a glued
// assignment and/or command-substitution prefix (e.g. `result=$(grep`) so the very common
// "capture a search into a variable" pattern is still caught without any real nested parsing.
function leadingCommandName(word: string): string {
	return commandName(word.replace(/^[A-Za-z_]\w*=/, "").replace(/^[`$(]+/, ""));
}

// --- best-effort search-root resolution -----------------------------------------------------------

function resolveLiteralPath(word: ShellWord, home: string, cwd: string): string | undefined {
	const { raw, value } = word;
	if (raw.startsWith("~")) {
		const userHome = `~${basename(home)}`;
		if (value === "~" || value.startsWith("~/")) return value === "~" ? home : `${home}/${value.slice(2)}`;
		if (value === userHome || value.startsWith(`${userHome}/`)) {
			return value === userHome ? home : `${home}/${value.slice(userHome.length + 1)}`;
		}
		return undefined; // another user's home directory — cannot resolve without a passwd lookup
	}
	if (value === "$HOME" || value === BRACED_HOME) return home;
	if (value.startsWith("$HOME/")) return `${home}/${value.slice("$HOME/".length)}`;
	if (value.startsWith(`${BRACED_HOME}/`)) return `${home}/${value.slice(BRACED_HOME.length + 1)}`;
	if (/[$`]/.test(value)) return undefined; // shell variable or command substitution — cannot resolve
	let path = value;
	const wildcard = path.search(/[*?[{]/);
	if (wildcard >= 0) {
		const prefix = path.slice(0, wildcard);
		const slash = prefix.lastIndexOf("/");
		path = slash < 0 ? "." : prefix.slice(0, slash + 1) || "/";
	}
	return isAbsolute(path) ? path : resolve(cwd, path);
}

// grep/rg/egrep/fgrep take PATTERN first, then any path arguments; find/fd take path arguments
// first with no pattern. Either way, flags are simply skipped wherever they appear — this does not
// try to know which flags take a value, so a flag's value word is occasionally (harmlessly)
// re-checked as if it were a root too.
function candidateRoots(command: string, args: ShellWord[]): ShellWord[] {
	const roots: ShellWord[] = [];
	let patternSeen = NO_LEADING_PATTERN_COMMANDS.has(command);
	for (const word of args) {
		if (word.value !== "-" && word.value.startsWith("-")) continue;
		if (!patternSeen) {
			patternSeen = true;
			continue;
		}
		roots.push(word);
	}
	return roots;
}

function bashSearchBlockReason(command: string, cwd: string, policy: SearchRootPolicy): string | undefined {
	let trackedCwd: string | undefined = canonicalPath(cwd);
	for (const rawSegment of bashSegments(maskHeredocBodies(command))) {
		const words = shellWords(rawSegment);
		let index = 0;
		while (index < words.length && isAssignment(words[index]!.value)) index += 1;
		const first = words[index];
		if (!first) continue;
		const args = words.slice(index + 1);

		if (leadingCommandName(first.value) === "cd") {
			const target = args.find((word) => word.value !== "-" && !word.value.startsWith("-")) ?? {
				raw: "~",
				value: "~",
			};
			trackedCwd = trackedCwd === undefined ? undefined : resolveLiteralPath(target, policy.home, trackedCwd);
			continue;
		}

		const invokedCommand = leadingCommandName(first.value);
		if (!SEARCH_COMMANDS.has(invokedCommand)) continue;
		// --help/--version don't traverse anything at all; don't treat them as an implicit search.
		if (args.some((word) => word.value === "--help" || word.value === "--version")) continue;
		const roots = candidateRoots(invokedCommand, args);
		if (roots.length === 0) {
			if (trackedCwd === undefined) continue;
			const protectedRoot = matchingProtectedRoot(trackedCwd, trackedCwd, policy);
			if (protectedRoot) {
				return `refusing to search from protected root ${protectedRoot}. Choose a specific repository, worktree, or subdirectory.`;
			}
			continue;
		}
		for (const root of roots) {
			const effectiveCwd = trackedCwd ?? cwd;
			const resolved = resolveLiteralPath(root, policy.home, effectiveCwd);
			if (resolved === undefined) continue;
			const protectedRoot = matchingProtectedRoot(resolved, effectiveCwd, policy);
			if (protectedRoot) {
				return `refusing to search from protected root ${protectedRoot}. Choose a specific repository, worktree, or subdirectory.`;
			}
		}
	}
	return undefined;
}

// --- PI grep/find/glob tools -------------------------------------------------------------------

function globPatternRoot(pattern: string): string {
	const wildcard = pattern.search(/[*?[{]/);
	if (wildcard < 0) return pattern;
	const prefix = pattern.slice(0, wildcard);
	const slash = prefix.lastIndexOf("/");
	if (slash < 0) return ".";
	return prefix.slice(0, slash + 1) || "/";
}

function piSearchRoots(toolName: string, input: Record<string, unknown>, cwd: string): string[] {
	if (toolName !== "glob") return [typeof input.path === "string" ? input.path : cwd];
	const roots = ["root", "path", "cwd", "directory", "base"].flatMap((field) =>
		typeof input[field] === "string" ? [input[field] as string] : [],
	);
	if (typeof input.pattern === "string") {
		const patternRoot = globPatternRoot(input.pattern);
		if (isAbsolute(patternRoot) || patternRoot.startsWith("file://")) roots.push(patternRoot);
		else {
			const base = roots[0] ?? cwd;
			const resolvedBase = base.startsWith("file://")
				? fileURLToPath(base)
				: isAbsolute(base)
					? base
					: resolve(cwd, base);
			roots.push(resolve(resolvedBase, patternRoot));
		}
	}
	return roots.length > 0 ? roots : [cwd];
}

export function searchRootBlockReason(
	toolName: string,
	rawInput: unknown,
	cwd: string,
	policy: SearchRootPolicy = { home: homedir(), protectedRoots: [...BASELINE_PROTECTED_ROOTS] },
): string | undefined {
	const input = asRecord(rawInput);
	if (PI_SEARCH_TOOLS.has(toolName)) {
		for (const root of piSearchRoots(toolName, input, cwd)) {
			const protectedRoot = matchingProtectedRoot(root, cwd, policy);
			if (protectedRoot) {
				return `Blocked ${toolName}: refusing to search from protected root ${protectedRoot}. Choose a specific repository, worktree, or subdirectory.`;
			}
		}
	}
	if (toolName === "bash" && typeof input.command === "string") {
		const reason = bashSearchBlockReason(input.command, cwd, policy);
		return reason ? `Blocked bash: ${reason}` : undefined;
	}
	return undefined;
}

export function installSearchRootGuard(
	pi: ExtensionAPI,
	options: {
		home?: string;
		loadConfig?: (cwd: string, projectTrusted: boolean) => SearchRootGuardConfig;
	} = {},
): void {
	const home = options.home ?? homedir();
	const loadConfig = options.loadConfig ?? loadSearchRootGuardConfig;
	pi.on("tool_call", (event, ctx) => {
		if (!PI_SEARCH_TOOLS.has(event.toolName) && event.toolName !== "bash") return undefined;
		try {
			const config = loadConfig(ctx.cwd, ctx.isProjectTrusted?.() ?? false);
			const reason = searchRootBlockReason(event.toolName, event.input, ctx.cwd, { home, ...config });
			return reason ? { block: true, reason } : undefined;
		} catch (error) {
			return {
				block: true,
				reason: `Blocked ${event.toolName}: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	});
}

export default installSearchRootGuard;
