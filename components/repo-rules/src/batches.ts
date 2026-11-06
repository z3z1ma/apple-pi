import { resolve } from "node:path";
import { resolveToolPath } from "../../shared/src/tool-path.js";

export interface BatchCall {
	id: string;
	name: string;
	arguments?: Record<string, unknown>;
}

export interface BatchConflict {
	callId: string;
	path: string;
	kind: "duplicate-write" | "read-during-write" | "shell-during-write";
}

function pathOf(call: BatchCall, cwd: string): string | undefined {
	const path = call.arguments?.path;
	if (typeof path !== "string") return undefined;
	try {
		return resolveToolPath(path, cwd);
	} catch {
		return undefined;
	}
}

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

function shellPaths(command: string, cwd: string): string[] {
	if (/[`$]|<<|\\\n/.test(command)) return [];
	const paths: string[] = [];
	let commandStart = true;
	let directoryArgument = false;
	let index = 0;
	while (index < command.length) {
		const char = command[index]!;
		if (/[ \t\r\n;&|<>]/.test(char)) {
			if (/[\n;&|]/.test(char)) commandStart = true;
			index++;
			continue;
		}
		if (char === "#") break;
		const word = shellWord(command, index);
		if (!word) return [];
		index = word.end;
		if (directoryArgument && resolve(cwd, word.value) !== resolve(cwd)) return [];
		directoryArgument = commandStart && word.value === "cd";
		if (commandStart && /^[A-Za-z_]\w*=/.test(word.value)) continue;
		commandStart = false;
		paths.push(resolve(cwd, word.value));
	}
	return directoryArgument ? [] : paths;
}

export function batchConflicts(calls: BatchCall[], cwd: string): BatchConflict[] {
	const writers = new Map<string, BatchCall[]>();
	for (const call of calls) {
		if (call.name !== "edit" && call.name !== "write") continue;
		const path = pathOf(call, cwd);
		if (path) writers.set(path, [...(writers.get(path) ?? []), call]);
	}
	const conflicts: BatchConflict[] = [];
	for (const [path, edits] of writers) {
		if (edits.length > 1) for (const call of edits) conflicts.push({ callId: call.id, path, kind: "duplicate-write" });
		for (const call of calls) {
			if (call.name === "read" && pathOf(call, cwd) === path)
				conflicts.push({ callId: call.id, path, kind: "read-during-write" });
			if (
				call.name === "bash" &&
				typeof call.arguments?.command === "string" &&
				shellPaths(call.arguments.command, cwd).includes(path)
			)
				conflicts.push({ callId: call.id, path, kind: "shell-during-write" });
		}
	}
	return conflicts;
}
