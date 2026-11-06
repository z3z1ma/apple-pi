import { isAbsolute, relative, resolve } from "node:path";
import { resolveToolPath } from "../../shared/src/tool-path.js";

export const RULE_EVENTS = ["call", "edit"] as const;
export type RuleEventKind = (typeof RULE_EVENTS)[number];

export interface CallFacts {
	id: string;
	tool: string;
	input: Record<string, unknown>;
	path: string | null;
	paths: string[];
	words: string[] | null;
}

export interface CallEvent extends CallFacts {
	on: "call";
	nested: boolean;
	batch: CallFacts[];
}

export interface EditEvent {
	on: "edit";
	tool: string;
	path: string;
	content: string | null;
	added: string[];
}

export type RuleEvent = CallEvent | EditEvent;

export interface RecordedCall {
	id: string;
	name: string;
	arguments?: Record<string, unknown>;
}

const PATH_TOOLS = new Set(["read", "edit", "write", "ls", "find", "grep"]);

function shellWord(command: string, index: number): { value: string; end: number } | undefined {
	let value = "";
	let quote: "'" | '"' | undefined;
	while (index < command.length) {
		const current = command[index]!;
		if (!quote && /[ \t\r\n;&|<>]/.test(current)) break;
		if (!quote && /[(){}]/.test(current)) return undefined;
		if (current === "\\" && quote !== "'") {
			const next = command[index + 1];
			if (next === undefined) return undefined;
			if (!quote || /["\\`$\n]/.test(next)) {
				value += next;
				index += 2;
				continue;
			}
		}
		if (current === quote) quote = undefined;
		else if (!quote && (current === "'" || current === '"')) quote = current;
		else value += current;
		index++;
	}
	return quote ? undefined : { value, end: index };
}

export function shellWords(command: string): string[] | null {
	if (/[`$]|<<|\\\n/.test(command)) return null;
	const words: string[] = [];
	let index = 0;
	while (index < command.length) {
		const char = command[index]!;
		if (/[ \t\r\n;&|<>]/.test(char)) {
			if (/[\n;&|]/.test(char) && words.at(-1) !== ";") words.push(";");
			index++;
			continue;
		}
		if (char === "#") break;
		const word = shellWord(command, index);
		if (!word) return null;
		words.push(word.value);
		index = word.end;
	}
	return words;
}

export function shellPaths(command: string, cwd: string): string[] {
	const words = shellWords(command);
	if (!words) return [];
	const paths: string[] = [];
	let commandStart = true;
	let directoryArgument = false;
	for (const word of words) {
		if (word === ";") {
			if (directoryArgument) return [];
			commandStart = true;
			continue;
		}
		if (directoryArgument && resolve(cwd, word) !== resolve(cwd)) return [];
		directoryArgument = commandStart && word === "cd";
		if (commandStart && /^[A-Za-z_]\w*=/.test(word)) continue;
		commandStart = false;
		paths.push(resolve(cwd, word));
	}
	return directoryArgument ? [] : paths;
}

export function shown(base: string, path: string): string {
	const inside = relative(base, path);
	return inside && !inside.startsWith("..") && !isAbsolute(inside) ? inside : inside === "" ? "." : path;
}

export function callFacts(call: RecordedCall, cwd: string, base: string): CallFacts {
	const input = call.arguments ?? {};
	let path: string | null = null;
	if (PATH_TOOLS.has(call.name) && typeof input.path === "string") {
		try {
			path = shown(base, resolveToolPath(input.path, cwd));
		} catch {
			path = null;
		}
	}
	const command = call.name === "bash" && typeof input.command === "string" ? input.command : undefined;
	const words = command === undefined ? null : shellWords(command);
	const paths =
		command === undefined ? (path ? [path] : []) : shellPaths(command, cwd).map((each) => shown(base, each));
	return { id: call.id, tool: call.name, input, path, paths, words };
}

export function callEvent(
	call: RecordedCall,
	batch: RecordedCall[],
	cwd: string,
	base: string,
	nested: boolean,
): CallEvent {
	const siblings = batch.some((each) => each.id === call.id) ? batch : [call, ...batch];
	return {
		on: "call",
		nested,
		...callFacts(call, cwd, base),
		batch: siblings.map((each) => callFacts(each, cwd, base)),
	};
}

export function editEvent(
	tool: string,
	path: string,
	base: string,
	content: string | null,
	added: string[],
): EditEvent {
	return { on: "edit", tool, path: shown(base, path), content, added };
}

export function addedTexts(tool: string, input: Record<string, unknown>): { texts: string[] } | { reason: string } {
	if (tool === "write")
		return typeof input.content === "string" ? { texts: [input.content] } : { reason: "the write has no content" };
	let edits = input.edits;
	if (typeof edits === "string") {
		try {
			edits = JSON.parse(edits);
		} catch {
			return { reason: "its edits are not valid JSON" };
		}
	}
	const list: unknown[] = Array.isArray(edits) ? [...edits] : edits && typeof edits === "object" ? [edits] : [];
	if (typeof input.oldText === "string" && typeof input.newText === "string") list.push({ newText: input.newText });
	const texts: string[] = [];
	for (const edit of list) {
		const text = edit && typeof edit === "object" ? (edit as { newText?: unknown }).newText : undefined;
		if (typeof text !== "string") return { reason: "an edit has no replacement text" };
		texts.push(text);
	}
	return texts.length ? { texts } : { reason: "the edit has no replacements" };
}
