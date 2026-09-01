import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BASELINE_PROTECTED_ROOTS, loadSearchRootGuardConfig, type SearchRootGuardConfig } from "./config.js";

const PI_SEARCH_TOOLS = new Set(["grep", "find", "glob"]);
const SEARCH_COMMANDS = new Set(["rg", "ripgrep", "grep", "egrep", "fgrep", "find", "fd", "fdfind"]);
const CONTROL_PREFIXES = new Set(["!", "{", "do", "elif", "if", "then", "until", "while"]);
const SUDO_OPTIONS_WITH_VALUE = new Set(["-C", "-D", "-g", "-h", "-p", "-R", "-r", "-T", "-t", "-u"]);
const ENV_OPTIONS_WITH_VALUE = new Set(["-C", "-S", "-u", "--chdir", "--split-string", "--unset"]);
const TIMEOUT_OPTIONS_WITH_VALUE = new Set(["-k", "-s", "--kill-after", "--signal"]);
const XARGS_OPTIONS_WITH_VALUE = new Set([
	"-a",
	"-d",
	"-E",
	"-I",
	"-L",
	"-n",
	"-P",
	"-s",
	"--arg-file",
	"--delimiter",
	"--eof",
	"--max-args",
	"--max-chars",
	"--max-lines",
	"--max-procs",
	"--replace",
]);
const BRACED_HOME = "$" + "{HOME}";

type ShellSeparator = "&&" | "||" | ";" | "|" | "&" | "\n";
type ShellSegment = { text: string; next?: ShellSeparator };
type ShellWord = { value: string; raw: string; start: number };
type SearchInvocation = {
	command: string;
	dynamicRoot: boolean;
	index: number;
	verified: boolean;
	words: ShellWord[];
};
type SearchAnalysis = { invocations: SearchInvocation[]; unverified: boolean };
type RootParse = { nonTraversal?: boolean; roots: ShellWord[]; verified: boolean };
type EvaluatedPayload = { raw: string; text: string };

export interface SearchRootPolicy extends SearchRootGuardConfig {
	home: string;
}

type CwdState = {
	active: string[];
	deferred: string[];
	lastConditional?: "&&" | "||";
	mixedConditional: boolean;
	uncertain: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function expandHome(value: string, home: string, expandTilde = true): string {
	let path = value.startsWith("@") ? value.slice(1) : value;
	const userHome = `~${basename(home)}`;
	if (expandTilde && (path === "~" || path === userHome)) path = home;
	else if (expandTilde && path.startsWith("~/")) path = `${home}/${path.slice(2)}`;
	else if (expandTilde && path.startsWith(`${userHome}/`)) path = `${home}/${path.slice(userHome.length + 1)}`;
	return path.replaceAll(BRACED_HOME, home).replace(/\$HOME(?![A-Za-z0-9_])/g, home);
}

function canonicalPath(path: string): string {
	try {
		return realpathSync.native(path);
	} catch {
		return resolve(path);
	}
}

function canonicalRoot(value: string, cwd: string, home: string, expandTilde = true): string {
	const expanded = value.startsWith("file://") ? fileURLToPath(value) : expandHome(value, home, expandTilde);
	return canonicalPath(isAbsolute(expanded) ? expanded : `${cwd}/${expanded}`);
}

function protectedSearchRoots(cwd: string, policy: SearchRootPolicy): string[] {
	return policy.protectedRoots.map((root) => canonicalRoot(root, cwd, policy.home));
}

function matchingProtectedRoot(
	value: string,
	cwd: string,
	policy: SearchRootPolicy,
	expandTilde = true,
): string | undefined {
	const root = canonicalRoot(value, cwd, policy.home, expandTilde);
	return protectedSearchRoots(cwd, policy).find((protectedRoot) => {
		const pathToProtectedRoot = relative(root, protectedRoot);
		return (
			pathToProtectedRoot === "" ||
			(pathToProtectedRoot !== ".." && !pathToProtectedRoot.startsWith("../") && !isAbsolute(pathToProtectedRoot))
		);
	});
}

function shellSegments(command: string): ShellSegment[] {
	const segments: ShellSegment[] = [];
	let start = 0;
	let quote: "'" | '"' | undefined;
	let escaped = false;
	let backtick = false;
	let substitutionDepth = 0;

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
		if (character === "`" && quote !== "'") {
			backtick = !backtick;
			continue;
		}
		if (backtick) continue;
		if (quote) {
			if (character === quote) quote = undefined;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			continue;
		}
		if (character === "(" && (["$", "<", ">"].includes(command[index - 1] ?? "") || substitutionDepth > 0)) {
			substitutionDepth += 1;
			continue;
		}
		if (character === ")" && substitutionDepth > 0) {
			substitutionDepth -= 1;
			continue;
		}
		if (substitutionDepth > 0 || (character !== ";" && character !== "|" && character !== "&" && character !== "\n"))
			continue;

		let separator = character as ShellSeparator;
		if ((character === "|" || character === "&") && command[index + 1] === character) {
			separator = `${character}${character}` as ShellSeparator;
			index += 1;
		}
		segments.push({ text: command.slice(start, index - (separator.length - 1)), next: separator });
		start = index + 1;
	}
	segments.push({ text: command.slice(start) });
	return segments;
}

function shellWords(command: string): ShellWord[] {
	const words: ShellWord[] = [];
	let index = 0;
	while (index < command.length) {
		while (index < command.length && /[\s;&|()]/.test(command[index]!)) index += 1;
		if (index >= command.length) break;
		const start = index;
		let value = "";
		let quote: "'" | '"' | undefined;
		while (index < command.length) {
			const character = command[index]!;
			if (!quote && /[\s;&|()]/.test(character)) break;
			if (character === "\\" && quote !== "'") {
				index += 1;
				if (index < command.length) value += command[index]!;
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
		words.push({ value, raw: command.slice(start, index), start });
	}
	return words;
}

function hasUnquotedRedirection(raw: string): boolean {
	let quote: "'" | '"' | undefined;
	let escaped = false;
	for (const character of raw) {
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
		if (character === "'" || character === '"') quote = character;
		else if (character === "<" || character === ">") return true;
	}
	return false;
}

function stripRedirections(words: ShellWord[]): { verified: boolean; words: ShellWord[] } {
	const kept: ShellWord[] = [];
	let verified = true;
	for (let index = 0; index < words.length; index += 1) {
		const match = words[index]!.raw.match(/^(?:\d+)?(<<<|<<|>>|<>|>&|<&|>|<)(.*)$/);
		if (!match) {
			if (hasUnquotedRedirection(words[index]!.raw)) verified = false;
			kept.push(words[index]!);
			continue;
		}
		if (match[1] === "<<" || match[1] === "<<<") verified = false;
		if (match[2] === "" && words[index + 1]) index += 1;
	}
	return { verified, words: kept };
}

function commandSubstitutionEnd(command: string, start: number): number | undefined {
	let depth = 1;
	let quote: "'" | '"' | undefined;
	let escaped = false;
	for (let index = start; index < command.length; index += 1) {
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
		if (character === "(") depth += 1;
		else if (character === ")" && --depth === 0) return index;
	}
	return undefined;
}

function backtickEnd(command: string, start: number): number | undefined {
	let index = start;
	while (index < command.length && command[index] !== "`") index += command[index] === "\\" ? 2 : 1;
	return index < command.length ? index : undefined;
}

function nestedShellCommands(command: string): string[] {
	const nested: string[] = [];
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
		if (quote === "'") {
			if (character === "'") quote = undefined;
			continue;
		}
		if (character === "'") {
			quote = "'";
			continue;
		}
		if (character === '"') {
			quote = quote === '"' ? undefined : '"';
			continue;
		}
		const substitution = ["$", "<", ">"].includes(character) && command[index + 1] === "(";
		const end =
			character === "`"
				? backtickEnd(command, index + 1)
				: substitution
					? commandSubstitutionEnd(command, index + 2)
					: undefined;
		if (end === undefined) continue;
		const contentStart = character === "`" ? index + 1 : index + 2;
		nested.push(command.slice(contentStart, end));
		index = end;
	}
	return nested;
}

function commandName(value: string): string {
	return value.split("/").at(-1) ?? value;
}

function isAssignment(value: string): boolean {
	return /^[A-Za-z_]\w*=/.test(value);
}

function skipWrapperOptions(words: ShellWord[], start: number, optionsWithValue: Set<string>): number {
	let index = start;
	while (words[index]?.value.startsWith("-")) {
		const option = words[index]!.value.includes("=")
			? words[index]!.value.slice(0, words[index]!.value.indexOf("="))
			: words[index]!.value;
		index += optionsWithValue.has(option) && words[index]!.value === option ? 2 : 1;
	}
	return index;
}

function commandPosition(words: ShellWord[]): { dynamicRoot: boolean; index: number; verified: boolean } | undefined {
	let index = 0;
	let dynamicRoot = false;
	let verified = true;
	while (index < words.length) {
		while (isAssignment(words[index]?.value ?? "") || CONTROL_PREFIXES.has(words[index]?.value ?? "")) index += 1;
		const command = commandName(words[index]?.value ?? "");
		if (!command) return undefined;
		if (command === "sudo") {
			const next = skipWrapperOptions(words, index + 1, SUDO_OPTIONS_WITH_VALUE);
			verified &&= !words
				.slice(index + 1, next)
				.some(
					(word) =>
						["-D", "--chdir"].includes(optionName(word.value)) ||
						/^-D.+/.test(word.value) ||
						word.value.startsWith("--chdir="),
				);
			index = next;
			continue;
		}
		if (command === "env") {
			const next = skipWrapperOptions(words, index + 1, ENV_OPTIONS_WITH_VALUE);
			verified &&= !words
				.slice(index + 1, next)
				.some(
					(word) =>
						["-C", "--chdir", "-S", "--split-string"].includes(optionName(word.value)) ||
						/^-[A-Za-z]*[CS]/.test(word.value) ||
						word.value.startsWith("--chdir="),
				);
			index = next;
			continue;
		}
		if (command === "nice") {
			index = skipWrapperOptions(words, index + 1, new Set(["-n"]));
			continue;
		}
		if (command === "timeout") {
			index = skipWrapperOptions(words, index + 1, TIMEOUT_OPTIONS_WITH_VALUE) + 1;
			continue;
		}
		if (command === "stdbuf") {
			index = skipWrapperOptions(words, index + 1, new Set(["-e", "-i", "-o"]));
			continue;
		}
		if (command === "command" || command === "nohup" || command === "time") {
			index = skipWrapperOptions(words, index + 1, new Set());
			continue;
		}
		if (command === "xargs") {
			dynamicRoot = true;
			index = skipWrapperOptions(words, index + 1, XARGS_OPTIONS_WITH_VALUE);
			continue;
		}
		return { dynamicRoot, index, verified };
	}
	return undefined;
}

function gitGrepPosition(words: ShellWord[], gitIndex: number): number | undefined {
	let index = gitIndex + 1;
	const optionsWithValue = new Set(["-C", "-c", "--git-dir", "--namespace", "--work-tree"]);
	index = skipWrapperOptions(words, index, optionsWithValue);
	return commandName(words[index]?.value ?? "") === "grep" ? index : undefined;
}

function isCommandProbe(words: ShellWord[]): boolean {
	return commandName(words[0]?.value ?? "") === "command" && ["-v", "-V"].includes(words[1]?.value ?? "");
}

function searchAnalysis(segment: string): SearchAnalysis {
	const stripped = stripRedirections(shellWords(segment));
	const inputRedirect = /(?:^|\s)\d*<(?!\()/.test(segment);
	const words = stripped.words;
	if (isCommandProbe(words)) return { invocations: [], unverified: false };
	const primary = commandPosition(words);
	const gitGrep =
		primary && commandName(words[primary.index]?.value ?? "") === "git"
			? gitGrepPosition(words, primary.index)
			: undefined;
	const gitCwdOverride =
		gitGrep !== undefined &&
		words
			.slice((primary?.index ?? 0) + 1, gitGrep)
			.some((word) => ["-C", "--git-dir", "--work-tree"].includes(optionName(word.value)));
	const invocations = words.flatMap((word, index) => {
		const command = commandName(word.value);
		if (!SEARCH_COMMANDS.has(command)) return [];
		const nested = /[(!]$/.test(segment.slice(0, word.start).trimEnd());
		const invoked = index === primary?.index || index === gitGrep || nested;
		return invoked
			? [
					{
						command,
						dynamicRoot: index === primary?.index && primary.dynamicRoot,
						index,
						verified:
							stripped.verified &&
							(index !== primary?.index || primary.verified) &&
							(index !== gitGrep || !gitCwdOverride),
						words: words.slice(index + 1),
					},
				]
			: [];
	});
	const accounted = new Set(invocations.map((invocation) => invocation.index));
	const hasUnaccountedSearch = words.some(
		(word, index) => SEARCH_COMMANDS.has(commandName(word.value)) && !accounted.has(index),
	);
	const primaryCommand = commandName(words[primary?.index ?? -1]?.value ?? "");
	const harmlessArguments = primaryCommand === "echo" || primaryCommand === "printf";
	const dynamicEvaluator =
		primary?.dynamicRoot && ["bash", "dash", "eval", "ksh", "sh", "zsh"].includes(primaryCommand);
	return {
		invocations,
		unverified: inputRedirect || !stripped.verified || dynamicEvaluator || (hasUnaccountedSearch && !harmlessArguments),
	};
}

function evaluatedShellPayloads(segment: string): EvaluatedPayload[] {
	const words = stripRedirections(shellWords(segment)).words;
	const primary = commandPosition(words);
	if (primary) {
		const command = commandName(words[primary.index]?.value ?? "");
		if (command === "eval") {
			const payloadWords = words.slice(primary.index + 1);
			const text = payloadWords.map((word) => word.value).join(" ");
			return text ? [{ raw: payloadWords.map((word) => word.raw).join(" "), text }] : [];
		}
		if (["bash", "dash", "ksh", "sh", "zsh"].includes(command)) {
			const args = words.slice(primary.index + 1);
			const attached = args.find((word) => /^-[A-Za-z]*c=?[^=\s].*/.test(word.value));
			if (attached) {
				const commandStart = attached.value.indexOf("c") + 1;
				return [{ raw: attached.raw, text: attached.value.slice(commandStart).replace(/^=/, "") }];
			}
			const commandOption = args.findIndex((word) => /^-[A-Za-z]*c[A-Za-z]*$/.test(word.value));
			const payload = commandOption >= 0 ? args[commandOption + 1] : undefined;
			return payload ? [{ raw: payload.raw, text: payload.value }] : [];
		}
	}
	const envIndex = words.findIndex((word) => commandName(word.value) === "env");
	if (envIndex >= 0) {
		const envArgs = words.slice(envIndex + 1);
		const attached = envArgs.find(
			(word) => word.value.startsWith("--split-string=") || /^-[A-Za-z]*S.+/.test(word.value),
		);
		if (attached) {
			return [
				{
					raw: attached.raw,
					text: attached.value.startsWith("--split-string=")
						? attached.value.slice("--split-string=".length)
						: attached.value.slice(attached.value.indexOf("S") + 1),
				},
			];
		}
		const splitIndex = envArgs.findIndex((word) => word.value === "--split-string" || /^-[A-Za-z]*S$/.test(word.value));
		const payloadIndex = splitIndex < 0 ? -1 : envIndex + splitIndex + 2;
		if (payloadIndex >= 0 && words[payloadIndex]) {
			return [{ raw: words[payloadIndex]!.raw, text: words[payloadIndex]!.value }];
		}
	}
	return [];
}

function dynamicEvaluatorPayload(raw: string): boolean {
	const withoutHome = raw.replaceAll(BRACED_HOME, "").replace(/\$HOME(?![A-Za-z0-9_])/g, "");
	return /[$`]/.test(withoutHome);
}

function optionName(value: string): string {
	return value.includes("=") ? value.slice(0, value.indexOf("=")) : value;
}

const PATTERN_OPTIONS = new Set(["-e", "--regexp", "-f", "--file"]);
const SEARCH_OPTIONS_WITH_VALUE = new Set([
	"-A",
	"-B",
	"-C",
	"-g",
	"-j",
	"-m",
	"-T",
	"-t",
	"--after-context",
	"--before-context",
	"--binary-files",
	"--colors",
	"--context-separator",
	"--devices",
	"--directories",
	"--encoding",
	"--engine",
	"--exclude",
	"--exclude-dir",
	"--exclude-from",
	"--field-context-separator",
	"--field-match-separator",
	"--glob",
	"--iglob",
	"--ignore-file",
	"--include",
	"--label",
	"--max-count",
	"--max-depth",
	"--path-separator",
	"--pre",
	"--pre-glob",
	"--replace",
	"--sort",
	"--sortr",
	"--threads",
	"--type",
	"--type-add",
	"--type-not",
]);

const RG_FLAGS = new Set([
	"--case-sensitive",
	"--count",
	"--count-matches",
	"--files-with-matches",
	"--files-without-match",
	"--fixed-strings",
	"--follow",
	"--heading",
	"--hidden",
	"--ignore-case",
	"--invert-match",
	"--json",
	"--line-number",
	"--line-regexp",
	"--multiline",
	"--no-filename",
	"--no-heading",
	"--no-ignore",
	"--no-line-number",
	"--no-messages",
	"--null",
	"--one-file-system",
	"--pcre2",
	"--quiet",
	"--search-zip",
	"--smart-case",
	"--stats",
	"--text",
	"--unrestricted",
	"--with-filename",
	"--word-regexp",
]);
const GREP_FLAGS = new Set([
	"--basic-regexp",
	"--color",
	"--context",
	"--count",
	"--extended-regexp",
	"--files-with-matches",
	"--files-without-match",
	"--fixed-strings",
	"--ignore-binary",
	"--ignore-case",
	"--invert-match",
	"--line-number",
	"--line-regexp",
	"--no-filename",
	"--no-messages",
	"--null",
	"--only-matching",
	"--perl-regexp",
	"--quiet",
	"--recursive",
	"--text",
	"--with-filename",
	"--word-regexp",
]);
const RG_SHORT_FLAGS = new Set("0acFhHilLnNqSsuUvwxzP".split(""));
const GREP_SHORT_FLAGS = new Set("aAbcEFGhHilLnNoqRrsvwxyzZP".split(""));

function knownFlag(value: string, command: string): boolean {
	const longFlags = command === "rg" || command === "ripgrep" ? RG_FLAGS : GREP_FLAGS;
	const shortFlags = command === "rg" || command === "ripgrep" ? RG_SHORT_FLAGS : GREP_SHORT_FLAGS;
	if (longFlags.has(optionName(value))) return true;
	return /^-[A-Za-z0-9]+$/.test(value) && [...value.slice(1)].every((flag) => shortFlags.has(flag));
}

function rgOrGrepRoots(words: ShellWord[], command: string): RootParse {
	const roots: ShellWord[] = [];
	let patternSeen = false;
	let filesMode = false;
	for (let index = 0; index < words.length; index += 1) {
		const word = words[index]!;
		const option = optionName(word.value);
		if (["--help", "--version"].includes(word.value)) return { nonTraversal: true, roots: [], verified: true };
		if (word.value === "--") {
			for (const positional of words.slice(index + 1)) {
				if (!patternSeen && !filesMode) patternSeen = true;
				else roots.push(positional);
			}
			break;
		}
		if (word.value === "--files") {
			filesMode = true;
			continue;
		}
		if (PATTERN_OPTIONS.has(option) || /^-[ef].+/.test(word.value)) {
			patternSeen = true;
			if (PATTERN_OPTIONS.has(option) && word.value === option) index += 1;
			continue;
		}
		const rgCommand = command === "rg" || command === "ripgrep";
		const followsSymlinks =
			(rgCommand &&
				(option === "--follow" || (/^-[A-Za-z0-9]+$/.test(word.value) && word.value.slice(1).includes("L")))) ||
			(!rgCommand &&
				(option === "--dereference-recursive" ||
					(/^-[A-Za-z0-9]+$/.test(word.value) && word.value.slice(1).includes("R"))));
		if (followsSymlinks || (rgCommand && option === "--pre")) return { roots: [], verified: false };
		const rgValueOption = rgCommand && ["-r", "--color", "--context"].includes(option);
		if (word.value.startsWith("-") && word.value !== "-") {
			if ((SEARCH_OPTIONS_WITH_VALUE.has(option) || rgValueOption) && word.value === option) {
				if (!words[index + 1]) return { roots: [], verified: false };
				index += 1;
				continue;
			}
			if (!SEARCH_OPTIONS_WITH_VALUE.has(option) && !rgValueOption && !knownFlag(word.value, command)) {
				return { roots: [], verified: false };
			}
			continue;
		}
		if (filesMode) roots.push(word);
		else if (!patternSeen) patternSeen = true;
		else roots.push(word);
	}
	return { roots, verified: true };
}

const FD_OPTIONS_WITH_VALUE = new Set([
	"-d",
	"-E",
	"-e",
	"-j",
	"-S",
	"-t",
	"--changed-before",
	"--changed-within",
	"--color",
	"--exclude",
	"--extension",
	"--format",
	"--max-depth",
	"--max-results",
	"--min-depth",
	"--owner",
	"--size",
	"--threads",
	"--type",
]);

const FD_FLAGS = new Set([
	"--absolute-path",
	"--case-sensitive",
	"--fixed-strings",
	"--follow",
	"--full-path",
	"--glob",
	"--hidden",
	"--ignore-case",
	"--no-ignore",
	"--print0",
	"--quiet",
	"--show-errors",
	"--strip-cwd-prefix",
	"--unrestricted",
]);
const FD_SHORT_FLAGS = new Set("0aFfHhIilpqsug".split(""));

function fdRoots(words: ShellWord[]): RootParse {
	const positional: ShellWord[] = [];
	const roots: ShellWord[] = [];
	for (let index = 0; index < words.length; index += 1) {
		const word = words[index]!;
		const option = optionName(word.value);
		if (["--help", "--version"].includes(word.value)) return { nonTraversal: true, roots: [], verified: true };
		if (option === "--base-directory" || option === "--search-path") {
			if (word.value === option && words[index + 1]) {
				index += 1;
				roots.push(words[index]!);
			} else if (word.value !== option) {
				const value = word.value.slice(option.length + 1);
				roots.push({ value, raw: value, start: word.start + option.length + 1 });
			} else return { roots: [], verified: false };
			continue;
		}
		if (word.value.startsWith("-") && word.value !== "-") {
			if (option === "--follow" || ["--exec", "--exec-batch"].includes(option)) {
				return { roots: [], verified: false };
			}
			if (/^-t.+/.test(word.value)) continue;
			if (FD_OPTIONS_WITH_VALUE.has(option) && word.value === option) {
				if (!words[index + 1]) return { roots: [], verified: false };
				index += 1;
				continue;
			}
			const knownShort =
				/^-[A-Za-z0-9]+$/.test(word.value) && [...word.value.slice(1)].every((flag) => FD_SHORT_FLAGS.has(flag));
			if (!FD_OPTIONS_WITH_VALUE.has(option) && !FD_FLAGS.has(word.value) && !knownShort) {
				return { roots: [], verified: false };
			}
			continue;
		}
		positional.push(word);
	}
	return { roots: roots.concat(positional.slice(1)), verified: true };
}

function findRoots(words: ShellWord[]): RootParse {
	if (words.some((word) => word.value === "-L")) return { roots: [], verified: false };
	for (let index = 0; index < words.length; index += 1) {
		if (!["-exec", "-execdir", "-ok", "-okdir"].includes(words[index]!.value)) continue;
		const executable = commandName(words[index + 1]?.value ?? "");
		if (
			!executable ||
			SEARCH_COMMANDS.has(executable) ||
			["bash", "builtin", "dash", "env", "eval", "ksh", "sh", "xargs", "zsh"].includes(executable)
		) {
			return { roots: [], verified: false };
		}
	}
	let index = 0;
	const roots: ShellWord[] = [];
	const prePathFlags = new Set(["-E", "-H", "-L", "-P", "-X", "-d", "-s", "-x", "-O0", "-O1", "-O2", "-O3"]);
	const prePathValues = new Set(["-D", "-O", "-maxdepth", "-mindepth"]);
	const expressionStarters = new Set([
		"!",
		"(",
		",",
		"-delete",
		"-empty",
		"-exec",
		"-execdir",
		"-false",
		"-name",
		"-path",
		"-print",
		"-print0",
		"-prune",
		"-regex",
		"-type",
		"-true",
	]);
	while (index < words.length) {
		const value = words[index]!.value;
		if (prePathFlags.has(value)) {
			index += 1;
			continue;
		}
		if (prePathValues.has(value)) {
			if (!words[index + 1]) return { roots: [], verified: false };
			index += 2;
			continue;
		}
		if (value === "-f" && words[index + 1]) {
			roots.push(words[index + 1]!);
			index += 2;
			continue;
		}
		if (value === "--") {
			index += 1;
			break;
		}
		if (value === "-exec" || value === "-execdir") return { roots: [], verified: false };
		if (expressionStarters.has(value)) return { roots, verified: true };
		if (value.startsWith("-")) return { roots: [], verified: false };
		break;
	}
	for (; index < words.length; index += 1) {
		const value = words[index]!.value;
		if (value.startsWith("-") || value === "!" || value === "(" || value === ")" || value === ",") break;
		roots.push(words[index]!);
	}
	if (["-exec", "-execdir"].includes(words[index]?.value ?? "")) return { roots: [], verified: false };
	return { roots, verified: true };
}

function invocationRoots(invocation: SearchInvocation): RootParse {
	if (invocation.command === "find") return findRoots(invocation.words);
	if (invocation.command === "fd" || invocation.command === "fdfind") return fdRoots(invocation.words);
	return rgOrGrepRoots(invocation.words, invocation.command);
}

function hasUnresolvedExpansion(word: ShellWord, home: string): boolean {
	if (/[?*+@!]\(/.test(word.raw)) return true;
	let quote: "'" | '"' | undefined;
	for (let index = 0; index < word.raw.length; index += 1) {
		const character = word.raw[index]!;
		if (quote === "'") {
			if (character === "'") quote = undefined;
			continue;
		}
		if (character === "'") {
			quote = "'";
			continue;
		}
		if (character === '"') {
			quote = quote === '"' ? undefined : '"';
			continue;
		}
		if (character === "`") return true;
		if (character === "$") {
			const expansion = word.raw.slice(index);
			if (expansion.startsWith(BRACED_HOME)) {
				index += BRACED_HOME.length - 1;
				continue;
			}
			if (expansion.startsWith("$HOME") && !/[A-Za-z0-9_]/.test(expansion[5] ?? "")) {
				index += "$HOME".length - 1;
				continue;
			}
			return true;
		}
		if (!quote && character === "{") return true;
	}
	if (word.raw.startsWith("~")) {
		const userHome = `~${basename(home)}`;
		return !(
			word.raw === "~" ||
			word.raw.startsWith("~/") ||
			word.raw === userHome ||
			word.raw.startsWith(`${userHome}/`)
		);
	}
	return false;
}

function rootValue(word: ShellWord, home: string): { value: string; expandTilde: boolean } {
	const expandTilde = word.raw.startsWith("~");
	const quotedLiteral = word.raw.startsWith("'") && word.raw.endsWith("'");
	return { value: quotedLiteral ? word.value : expandHome(word.value, home, expandTilde), expandTilde };
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

function parsedPrimaryCommand(segment: string): { command: string; index: number; words: ShellWord[] } | undefined {
	const words = stripRedirections(shellWords(segment)).words;
	const primary = commandPosition(words);
	if (!primary) return undefined;
	return { command: commandName(words[primary.index]?.value ?? ""), index: primary.index, words };
}

function cdWord(segment: string): ShellWord | undefined {
	const primary = parsedPrimaryCommand(segment);
	if (primary?.command !== "cd") return undefined;
	return (
		primary.words.slice(primary.index + 1).find((word) => !word.value.startsWith("-")) ?? {
			value: "~",
			raw: "~",
			start: 0,
		}
	);
}

function startConditional(state: CwdState, separator: "&&" | "||"): void {
	if (state.lastConditional && state.lastConditional !== separator) {
		state.mixedConditional = true;
		state.active = unique(state.active.concat(state.deferred));
		state.deferred = [];
	}
	state.lastConditional = separator;
}

function advanceAfterCommand(state: CwdState, separator?: ShellSeparator): void {
	if (separator === "&&" || separator === "||") {
		startConditional(state, separator);
		state.deferred = unique(state.deferred.concat(state.active));
		return;
	}
	if (separator !== "|") {
		state.active = unique(state.active.concat(state.deferred));
		state.deferred = [];
		state.lastConditional = undefined;
		state.mixedConditional = false;
	}
}

function applyCd(
	state: CwdState,
	target: ShellWord,
	separator: ShellSeparator | undefined,
	policy: SearchRootPolicy,
): void {
	if (hasUnresolvedExpansion(target, policy.home)) {
		state.uncertain = true;
		advanceAfterCommand(state, separator);
		return;
	}
	const expanded = rootValue(target, policy.home).value;
	const previous = state.active;
	const next = previous.map((cwd) => canonicalPath(isAbsolute(expanded) ? expanded : `${cwd}/${expanded}`));
	if (separator === "&&") {
		startConditional(state, separator);
		state.active = unique(next);
		state.deferred = unique(state.deferred.concat(previous));
	} else if (separator === "||") {
		startConditional(state, separator);
		state.deferred = unique(state.deferred.concat(next));
	} else if (separator === "|") {
		state.active = previous;
	} else {
		state.active = unique(previous.concat(next, state.deferred));
		state.deferred = [];
		state.lastConditional = undefined;
		state.mixedConditional = false;
	}
}

function searchCwds(state: CwdState): string[] {
	return state.mixedConditional ? unique(state.active.concat(state.deferred)) : state.active;
}

function nestedSearchBlockReason(text: string, state: CwdState, policy: SearchRootPolicy): string | undefined {
	for (const nested of nestedShellCommands(text)) {
		const analysis = searchAnalysis(nested);
		if (state.uncertain && (analysis.unverified || analysis.invocations.length > 0)) {
			return "Blocked bash: a nested shell search working directory cannot be verified. Use a literal specific repository, worktree, or subdirectory.";
		}
		for (const activeCwd of searchCwds(state)) {
			const reason = bashSearchBlockReason(nested, activeCwd, policy);
			if (reason) return reason;
		}
	}
	return undefined;
}

function implicitSearchBlockReason(state: CwdState, policy: SearchRootPolicy): string | undefined {
	if (state.uncertain) {
		return "Blocked bash: the shell search working directory cannot be verified. Use a literal specific repository, worktree, or subdirectory.";
	}
	for (const activeCwd of searchCwds(state)) {
		const protectedRoot = matchingProtectedRoot(activeCwd, activeCwd, policy);
		if (protectedRoot) return protectedRoot;
	}
	return undefined;
}

function explicitSearchBlockReason(roots: ShellWord[], state: CwdState, policy: SearchRootPolicy): string | undefined {
	for (const root of roots) {
		if (hasUnresolvedExpansion(root, policy.home)) {
			return `Blocked bash: cannot verify shell search root ${JSON.stringify(root.raw)}. Use a literal specific repository, worktree, or subdirectory.`;
		}
		const resolved = rootValue(root, policy.home);
		if (/[*?[]/.test(resolved.value)) resolved.value = globPatternRoot(resolved.value);
		if (state.uncertain && !isAbsolute(resolved.value)) {
			return `Blocked bash: cannot resolve relative shell search root ${JSON.stringify(root.raw)} from an uncertain working directory.`;
		}
		for (const activeCwd of searchCwds(state)) {
			const protectedRoot = matchingProtectedRoot(resolved.value, activeCwd, policy, resolved.expandTilde);
			if (protectedRoot) return protectedRoot;
		}
	}
	return undefined;
}

function invocationBlockReason(
	invocation: SearchInvocation,
	state: CwdState,
	policy: SearchRootPolicy,
): string | undefined {
	if (!invocation.verified) {
		return "Blocked bash: cannot verify wrapper or redirection semantics around a search command.";
	}
	if (invocation.dynamicRoot) {
		return "Blocked bash: cannot verify search roots supplied dynamically through xargs. Use a direct search command with a literal specific root.";
	}
	const parsed = invocationRoots(invocation);
	if (!parsed.verified) {
		return `Blocked bash: cannot verify ${invocation.command} option and root syntax. Use a directly invoked search with a literal specific root.`;
	}
	if (parsed.nonTraversal) return undefined;
	return parsed.roots.length === 0
		? implicitSearchBlockReason(state, policy)
		: explicitSearchBlockReason(parsed.roots, state, policy);
}

function bashSearchBlockReason(command: string, cwd: string, policy: SearchRootPolicy): string | undefined {
	const state: CwdState = {
		active: [canonicalPath(cwd)],
		deferred: [],
		mixedConditional: false,
		uncertain: false,
	};
	for (const segment of shellSegments(command)) {
		const text = segment.text.trim();
		for (const payload of evaluatedShellPayloads(text)) {
			if (dynamicEvaluatorPayload(payload.raw)) {
				return "Blocked bash: cannot verify a dynamic shell-evaluator payload. Use a literal command and search root.";
			}
			for (const activeCwd of searchCwds(state)) {
				const payloadReason = bashSearchBlockReason(payload.text, activeCwd, policy);
				if (payloadReason) return payloadReason;
			}
		}
		const nestedReason = nestedSearchBlockReason(text, state, policy);
		if (nestedReason) return nestedReason;
		const target = cdWord(text);
		if (target) {
			if (/\bCDPATH=/.test(text)) state.uncertain = true;
			else applyCd(state, target, segment.next, policy);
			continue;
		}
		const primary = parsedPrimaryCommand(text);
		const builtinCommand =
			primary?.command === "builtin" ? commandName(primary.words[primary.index + 1]?.value ?? "") : undefined;
		if (builtinCommand === "eval") {
			return "Blocked bash: cannot verify a builtin shell-evaluator payload. Use a literal direct search command.";
		}
		if (primary?.command.includes("$") || primary?.command.includes("`")) {
			return "Blocked bash: cannot verify a dynamic executable name.";
		}
		const uncertainShellState =
			(primary && [".", "eval", "source", "pushd", "popd"].includes(primary.command)) ||
			(builtinCommand !== undefined && [".", "cd", "pushd", "popd", "source"].includes(builtinCommand)) ||
			/^\s*(?:function\s+)?[A-Za-z_]\w*\s*\(\s*\)\s*\{/.test(text) ||
			/^\s*(?:case|for|select|until|while)\b/.test(text);
		if (uncertainShellState) state.uncertain = true;
		if (primary?.command === "exit" && state.lastConditional === "||") {
			state.active = unique(state.deferred);
			state.deferred = [];
			state.lastConditional = undefined;
			state.mixedConditional = false;
			advanceAfterCommand(state, segment.next);
			continue;
		}
		const analysis = searchAnalysis(text);
		if (analysis.unverified) {
			return "Blocked bash: cannot verify shell syntax around a search command. Use a directly invoked search with a literal specific root.";
		}
		for (const invocation of analysis.invocations) {
			const reason = invocationBlockReason(invocation, state, policy);
			if (reason) return reason;
		}
		advanceAfterCommand(state, segment.next);
	}
	return undefined;
}

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
		typeof input[field] === "string" ? [input[field]] : [],
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
	if (
		toolName === "glob" &&
		typeof input.pattern === "string" &&
		(input.pattern.includes("{") || /[?*+@!]\(/.test(input.pattern))
	) {
		return "Blocked glob: cannot verify alternative-expanded search roots. Use one literal specific root.";
	}
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
		if (!reason) return undefined;
		return reason.startsWith("Blocked ")
			? reason
			: `Blocked bash: refusing to search from protected root ${reason}. Choose a specific repository, worktree, or subdirectory.`;
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
