import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { basename, join, posix } from "node:path";
import { setImmediate } from "node:timers/promises";
import { getShellConfig } from "@earendil-works/pi-coding-agent";
import { killProcessTree } from "../components/tasks/src/process-killer.js";

type RecordValue = Record<string, any>;
export interface EvidenceEnvironment {
	cwd: string;
	signal?: AbortSignal;
}

/** All evidence calls use keyword arguments and the normal host-call budget. */
export const EVIDENCE_FUNCTION_NAMES = [
	"git_change",
	"git_patch",
	"repo_change_neighborhood",
	"context_required",
	"context_clippable",
	"context_droppable",
	"context_fit",
	"context_pack",
	"dev_find_relevant_tests",
	"dev_run_relevant_tests",
] as const;
export type EvidenceFunctionName = (typeof EVIDENCE_FUNCTION_NAMES)[number];
export function evidencePythonStubs(): string {
	return [
		"async def git_change(*, compare: str = ..., paths: list[str] = ...) -> dict[str, Any]: ...",
		"async def git_patch(*, compare: str = ..., paths: list[str] = ...) -> str: ...",
		"async def repo_change_neighborhood(*, compare: str = ..., paths: list[str] = ..., include: list[str] = ...) -> dict[str, Any]: ...",
		"async def context_required(*, value: Any) -> dict[str, Any]: ...",
		"async def context_clippable(*, value: str, max_chars: int = ..., strategy: str = ..., marker: str = ..., priority: float = ...) -> dict[str, Any]: ...",
		"async def context_droppable(*, value: Any, priority: float = ...) -> dict[str, Any]: ...",
		"async def context_fit(*, value: Any, max_serialized_chars: int = ..., flags: dict[str, str] = ...) -> dict[str, Any]: ...",
		"async def context_pack(*, items: list[Any], id: str = ..., priority: str = ..., fields: dict[str, int] = ..., max_serialized_chars: int = ...) -> dict[str, Any]: ...",
		"async def dev_find_relevant_tests(*, compare: str = ..., paths: list[str] = ...) -> dict[str, Any]: ...",
		"async def dev_run_relevant_tests(*, compare: str = ..., paths: list[str] = ..., command: str = ..., max_tests: int = ..., timeout: float = ...) -> dict[str, Any]: ...",
	].join("\n");
}

const unique = <T>(values: T[]): T[] => [...new Set(values)];
function integer(value: unknown, name: string, min = 0): number {
	if (!Number.isSafeInteger(value) || (value as number) < min)
		throw new TypeError(`${name} must be an integer >= ${min}`);
	return value as number;
}
function object(value: unknown, name: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
	return value as RecordValue;
}
function strings(value: unknown, name: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.includes("\0")))
		throw new TypeError(`${name} must be a list of strings`);
	return value;
}
const measure = (value: unknown): number => JSON.stringify(value).length;
const quote = (value: string): string => `'${value.replaceAll("'", "'\"'\"'")}'`;

/** Bounded output, deadline, and process-tree cancellation also apply to test commands. */
function command(
	file: string,
	args: string[],
	env: EvidenceEnvironment,
	timeout = 60,
	stdin?: string,
): Promise<{ ok: boolean; output: string }> {
	if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 600)
		throw new TypeError("timeout must be > 0 and <= 600 seconds");
	env.signal?.throwIfAborted();
	return new Promise((resolve, reject) => {
		const child = spawn(file, args, {
			cwd: env.cwd,
			detached: process.platform !== "win32",
			stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		let output = "";
		let bytes = 0;
		let failure: Error | undefined;
		const stop = (reason: Error) => {
			failure ??= reason;
			if (child.pid) killProcessTree(child.pid);
		};
		const abort = () => stop(new Error("Evidence call aborted"));
		const timer = setTimeout(() => stop(new Error(`Evidence command timed out after ${timeout}s`)), timeout * 1000);
		const append = (chunk: string) => {
			bytes += Buffer.byteLength(chunk);
			if (bytes > 8 * 1024 * 1024) stop(new Error("Evidence command output exceeded 8 MiB; narrow the paths"));
			else output += chunk;
		};
		child.stdout!.setEncoding("utf8").on("data", append);
		child.stderr!.setEncoding("utf8").on("data", append);
		if (stdin !== undefined) {
			child.stdin?.on("error", () => {});
			child.stdin?.end(stdin);
		}
		const cleanup = () => {
			clearTimeout(timer);
			env.signal?.removeEventListener("abort", abort);
		};
		child.once("error", (error) => {
			cleanup();
			reject(error);
		});
		child.once("close", (code) => {
			cleanup();
			if (failure) reject(failure);
			else resolve({ ok: code === 0, output });
		});
		env.signal?.addEventListener("abort", abort, { once: true });
		if (env.signal?.aborted) abort();
	});
}
async function git(args: string[], env: EvidenceEnvironment): Promise<string> {
	const result = await command("git", ["-c", "color.ui=false", ...args], env);
	if (!result.ok) throw new Error(result.output || "git command failed");
	return result.output;
}
function pathArgs(options: RecordValue): string[] {
	const paths = options.paths === undefined ? [] : strings(options.paths, "paths");
	return paths.length ? ["--", ...paths] : [];
}
function comparison(options: RecordValue): string {
	const compare = options.compare ?? "HEAD";
	if (typeof compare !== "string" || !compare || compare.startsWith("-") || /[\s\0]/.test(compare))
		throw new TypeError("compare must be a git revision or range, not an option");
	return compare;
}
function nameStatus(output: string): RecordValue[] {
	const fields = output.split("\0").filter(Boolean);
	const result: RecordValue[] = [];
	for (let i = 0; i < fields.length; ) {
		const status = fields[i++];
		const code = status[0];
		if (code === "R" || code === "C") result.push({ status, code, from: fields[i++], path: fields[i++] });
		else result.push({ status, code, path: fields[i++] });
	}
	return result;
}
async function gitPatch(options: RecordValue, env: EvidenceEnvironment): Promise<string> {
	return git(["diff", "--no-ext-diff", "--no-textconv", "--unified=3", comparison(options), ...pathArgs(options)], env);
}
async function gitChange(options: RecordValue, env: EvidenceEnvironment): Promise<RecordValue> {
	const compare = comparison(options);
	const paths = pathArgs(options);
	const diff = ["diff", "--no-ext-diff", "--no-textconv"];
	const [porcelain, statText, patch, names, untracked, numstat] = await Promise.all([
		git(["status", "--porcelain=v1", "-z", "--untracked-files=all", ...paths], env),
		git([...diff, "--stat", compare, ...paths], env),
		gitPatch(options, env),
		git([...diff, "--name-status", "-z", compare, ...paths], env),
		// Committed comparisons do not acquire unrelated working-tree files.
		compare.includes("..")
			? Promise.resolve("")
			: git(["ls-files", "--others", "--exclude-standard", "-z", ...paths], env),
		git([...diff, "--numstat", compare, ...paths], env),
	]);
	const entries: RecordValue[] = [];
	const fields = porcelain.split("\0").filter(Boolean);
	for (let i = 0; i < fields.length; i++) {
		const field = fields[i];
		const entry: RecordValue = {
			index: field[0],
			worktree: field[1],
			path: field.slice(3),
			untracked: field.startsWith("??"),
		};
		if (/[RC]/.test(field.slice(0, 2))) entry.from = fields[++i];
		entries.push(entry);
	}
	const totals = { additions: 0, deletions: 0 };
	for (const line of numstat.split("\n")) {
		const [add, del] = line.split("\t");
		totals.additions += Number(add) || 0;
		totals.deletions += Number(del) || 0;
	}
	const namesParsed = nameStatus(names);
	return {
		compare,
		...(options.paths ? { paths: options.paths } : {}),
		status: {
			entries,
			dirty: entries.length > 0,
			untrackedFiles: entries.filter((entry) => entry.untracked).map((entry) => entry.path),
		},
		statusText: entries
			.map((entry) => `${entry.index}${entry.worktree} ${entry.path}${entry.from ? ` <- ${entry.from}` : ""}`)
			.join("\n"),
		stat: statText,
		patch,
		changedFiles: unique(namesParsed.flatMap((entry) => (entry.from ? [entry.from, entry.path] : [entry.path]))),
		untrackedFiles: untracked.split("\0").filter(Boolean),
		renames: namesParsed.filter((entry) => entry.code === "R"),
		...totals,
		nameStatus: namesParsed,
	};
}

// Marks cross Monty's JSON boundary, so they are explicit records, not WeakMap identities.
const MARK = "__pi_context_policy__";
type Policy = {
	kind: "required" | "clippable" | "droppable";
	max_chars?: number;
	strategy?: string;
	marker?: string;
	priority?: number;
};
function policy(value: unknown): Policy | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value) || !(MARK in value)) return undefined;
	const p = object((value as RecordValue)[MARK], "context policy") as Policy;
	if (!["required", "clippable", "droppable"].includes(p.kind)) throw new TypeError("Unknown context policy");
	return p;
}
export function containsContextMarks(value: unknown): boolean {
	if (policy(value)) return true;
	return !!value && typeof value === "object" && Object.values(value).some(containsContextMarks);
}
function mark(kind: Policy["kind"], args: RecordValue): RecordValue {
	if (!("value" in args)) throw new TypeError("context mark requires value");
	if (kind === "clippable" && typeof args.value !== "string")
		throw new TypeError("context_clippable requires a string");
	if (args.max_chars !== undefined) integer(args.max_chars, "max_chars");
	if (args.priority !== undefined && !Number.isFinite(args.priority)) throw new TypeError("priority must be finite");
	if (args.strategy !== undefined && !["head", "tail", "head-tail"].includes(args.strategy))
		throw new TypeError("strategy must be head, tail, or head-tail");
	if (args.marker !== undefined && typeof args.marker !== "string") throw new TypeError("marker must be a string");
	const { value, ...options } = args;
	return { [MARK]: { ...options, kind }, value };
}
function clip(text: string, max: number, options: Policy = { kind: "clippable" }): string {
	if (text.length <= max) return text;
	const marker = options.marker ?? "\n[… clipped …]\n";
	if (max <= marker.length) return text.slice(0, max);
	const count = max - marker.length;
	if (options.strategy === "head") return text.slice(0, count) + marker;
	if (options.strategy === "tail") return marker + text.slice(-count);
	const tail = Math.floor(count / 2);
	return text.slice(0, Math.ceil(count / 2)) + marker + (tail ? text.slice(-tail) : "");
}
interface Slot {
	path: string;
	policy: Policy;
	value: any;
	active: boolean;
	original: any;
}
export interface ContextFit {
	value: unknown;
	truncated: string[];
	dropped: string[];
	serializedChars: number;
}
/** Unmarked and required values are never silently removed to make a context fit. */
export function fitContext(value: unknown, options: RecordValue = {}): ContextFit {
	const max = integer(options.max_serialized_chars ?? 48_000, "max_serialized_chars", 2);
	const flags = object(options.flags ?? {}, "flags");
	const slots: Slot[] = [];
	const slotSet = new Set<Slot>();
	const truncated: string[] = [];
	const dropped: string[] = [];
	const materialize = (item: any, path: string): any => {
		const p = policy(item);
		if (p) {
			mark(p.kind, { ...p, value: item.value });
			const original = item.value;
			const child =
				p.kind === "clippable" ? clip(original, p.max_chars ?? original.length, p) : materialize(original, path);
			const slot = { path, policy: p, original, value: child, active: true };
			slots.push(slot);
			slotSet.add(slot);
			if (p.kind === "clippable" && child !== original) truncated.push(path);
			return slot;
		}
		if (Array.isArray(item)) return item.map((child, index) => materialize(child, `${path}[${index}]`));
		if (item && typeof item === "object")
			return Object.fromEntries(
				Object.entries(item).map(([key, child]) => [key, materialize(child, `${path}.${key}`)]),
			);
		return item;
	};
	const tree = materialize(value, "$");
	if (Object.keys(flags).length && (!tree || typeof tree !== "object" || Array.isArray(tree) || slotSet.has(tree)))
		throw new TypeError("flags require an unmarked object root");
	for (const [key, path] of Object.entries(flags)) {
		if (typeof path !== "string" || !slots.some((slot) => slot.path === path))
			throw new TypeError(`flags references unknown slot ${path}`);
		if (key in tree) throw new TypeError(`flag would overwrite context field ${key}`);
		tree[key] = false;
	}
	const resolve = (item: any): any => {
		if (slotSet.has(item)) return item.active ? resolve(item.value) : undefined;
		if (Array.isArray(item)) return item.map((child) => resolve(child) ?? null);
		if (item && typeof item === "object")
			return Object.fromEntries(
				Object.entries(item)
					.filter(([, child]) => !slotSet.has(child as Slot) || (child as Slot).active)
					.map(([key, child]) => [key, resolve(child)]),
			);
		return item;
	};
	const size = () => {
		const current = resolve(tree);
		return current === undefined ? 0 : measure(current);
	};
	const ordered = (kind: Policy["kind"]) =>
		slots
			.filter((slot) => slot.policy.kind === kind)
			.sort((a, b) => (a.policy.priority ?? 0) - (b.policy.priority ?? 0));
	for (const slot of ordered("droppable")) {
		if (size() <= max) break;
		slot.active = false;
		dropped.push(slot.path);
	}
	for (const slot of ordered("clippable")) {
		if (size() <= max) break;
		const original = slot.value as string;
		let low = 0;
		let high = original.length;
		// Serialized escaping can be larger than the string; measure each candidate.
		while (low < high) {
			const middle = Math.ceil((low + high) / 2);
			slot.value = clip(original, middle, slot.policy);
			if (size() <= max) low = middle;
			else high = middle - 1;
		}
		slot.value = clip(original, low, slot.policy);
		if (slot.value !== original && !truncated.includes(slot.path)) truncated.push(slot.path);
	}
	for (const [key, path] of Object.entries(flags)) tree[key] = truncated.includes(path);
	const result = resolve(tree);
	const serializedChars = result === undefined ? 0 : measure(result);
	if (serializedChars > max)
		throw new Error("context_fit cannot meet the context budget without dropping required data");
	return { value: result ?? null, truncated, dropped, serializedChars };
}
function packContext(args: RecordValue): RecordValue {
	if (!Array.isArray(args.items)) throw new TypeError("items must be an array");
	const max = integer(args.max_serialized_chars ?? 48_000, "max_serialized_chars", 2);
	const fields = object(args.fields ?? {}, "fields");
	for (const [field, length] of Object.entries(fields)) integer(length, `fields.${field}`);
	const clipped: string[] = [];
	const prepared = args.items.map((item: any, index: number) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return item;
		const copy = { ...item };
		for (const [field, length] of Object.entries(fields)) {
			if (typeof copy[field] !== "string") continue;
			copy[field] = clip(copy[field], length);
			if (copy[field] !== item[field]) clipped.push(`$[${index}].${field}`);
		}
		return copy;
	});
	const priority = args.priority ?? "priority";
	const id = args.id ?? "id";
	prepared.sort((a: any, b: any) => (Number(b?.[priority]) || 0) - (Number(a?.[priority]) || 0));
	const kept: any[] = [];
	const omitted: any[] = [];
	for (const item of prepared) (measure([...kept, item]) <= max ? kept : omitted).push(item);
	return {
		items: kept,
		omitted,
		omittedIds: omitted.map((item) => item?.[id]).filter((item) => item !== undefined),
		clipped,
		serializedChars: measure(kept),
	};
}

async function exists(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}
async function repositoryFiles(env: EvidenceEnvironment): Promise<string[]> {
	const files = unique(
		(await git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"], env)).split("\0").filter(Boolean),
	);
	if (files.length > 20_000) throw new Error("Repository discovery exceeded 20000 files; use a narrower repository");
	return files;
}
async function neighboringTests(
	changed: string[],
	files: string[],
	env: EvidenceEnvironment,
): Promise<Record<string, string[]>> {
	if (changed.length === 0) return {};
	const byStem = new Map<string, string[]>();
	const byName = new Map<string, string[]>();
	let entries = 0;
	const index = (map: Map<string, string[]>, key: string, path: string) => {
		if (++entries > 100_000) throw new Error("Related-test index exceeded 100000 entries; narrow the repository");
		const paths = map.get(key) ?? [];
		paths.push(path);
		map.set(key, paths);
	};
	// Index each candidate once rather than filtering every repository path for every changed file.
	for (const [position, path] of files.entries()) {
		if (position % 1000 === 0) await setImmediate();
		env.signal?.throwIfAborted();
		if (!/(^|\/|\.)(test|spec)[./]|__tests__\//.test(path) || !(await exists(join(env.cwd, path)))) continue;
		const name = basename(path);
		index(byName, name, path);
		for (let dot = name.indexOf("."); dot !== -1; dot = name.indexOf(".", dot + 1))
			index(byStem, name.slice(0, dot), path);
	}
	const result: Record<string, string[]> = Object.create(null);
	let outputBytes = 0;
	for (const [position, file] of changed.entries()) {
		if (position % 1000 === 0) await setImmediate();
		env.signal?.throwIfAborted();
		const name = basename(file);
		const stem = name.replace(/\.[^.]+$/, "").replace(/\.(test|spec)$/, "");
		const prefixes = byStem.get(stem) ?? [];
		const exact = byName.get(name) ?? [];
		if (prefixes.length > 256 || exact.length > 256) throw new Error("Related-test discovery exceeded 256 files");
		const matches = unique([...prefixes, ...exact]);
		if (matches.length > 256) throw new Error("Related-test discovery exceeded 256 files");
		outputBytes += Buffer.byteLength(file) + 8;
		for (const path of matches) outputBytes += Buffer.byteLength(path) + 4;
		if (outputBytes > 2_000_000)
			throw new Error("Related-test discovery exceeded 2 MB of evidence; narrow the changed paths");
		result[file] = matches;
	}
	return result;
}
async function configFor(file: string, env: EvidenceEnvironment): Promise<string[]> {
	const parts = file.split("/").slice(0, -1);
	const candidates = Array.from({ length: parts.length + 1 }, (_, index) =>
		["AGENTS.md", ".editorconfig", "tsconfig.json", "package.json"].map((name) =>
			posix.join(...parts.slice(0, index), name),
		),
	).flat();
	return (
		await Promise.all(candidates.map(async (path) => ((await exists(join(env.cwd, path))) ? path : null)))
	).filter((path): path is string => path !== null);
}
async function scanReferences(
	kind: string,
	changed: string[],
	allFiles: string[],
	env: EvidenceEnvironment,
): Promise<RecordValue> {
	const evidence: RecordValue = Object.fromEntries(changed.map((file) => [file, []]));
	if (changed.length === 0) return evidence;
	let scanBytes = 0;
	let scanWork = 0;
	let outputBytes = 0;
	let lineChecks = 0;
	for (const path of allFiles) {
		env.signal?.throwIfAborted();
		if (!(await exists(join(env.cwd, path)))) continue;
		const bytes = (await stat(join(env.cwd, path))).size;
		scanBytes += bytes;
		scanWork += bytes * changed.length;
		if (bytes > 1_000_000 || scanBytes > 16_000_000 || scanWork > 32_000_000)
			throw new Error("Reference discovery exceeded scan budget; narrow the changed paths");
		const text = await readFile(join(env.cwd, path), { encoding: "utf8", signal: env.signal });
		if (text.includes("\0")) continue;
		for (const file of changed) {
			const term = basename(file).replace(/\.[^.]+$/, "");
			const definition = new RegExp(
				`\\b(function|class|interface|type|const|let|var|def)\\s+${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
			);
			for (const [index, line] of text.split("\n").entries()) {
				if (++lineChecks > 200_000)
					throw new Error("Reference discovery exceeded 200000 line checks; narrow the changed paths");
				if (lineChecks % 1000 === 0) await setImmediate();
				env.signal?.throwIfAborted();
				if (!line.includes(term) || (kind === "definitions" && !definition.test(line))) continue;
				if (evidence[file].length >= 100) throw new Error(`Reference discovery exceeded 100 matches for ${file}`);
				outputBytes += Buffer.byteLength(line) + Buffer.byteLength(path) + 64;
				if (outputBytes > 1_000_000) throw new Error("Reference discovery exceeded 1 MB of evidence");
				evidence[file].push({ path, line: index + 1, text: line });
			}
		}
	}
	return evidence;
}
async function neighborhood(args: RecordValue, env: EvidenceEnvironment): Promise<RecordValue> {
	const include = new Set(strings(args.include ?? ["tests", "config"], "include"));
	for (const item of include)
		if (!["definitions", "references", "tests", "config", "owners"].includes(item))
			throw new TypeError(`Unsupported neighborhood include: ${item}`);
	const change = await gitChange(args, env);
	const changed = unique<string>([...change.changedFiles, ...change.untrackedFiles]);
	const result: RecordValue = { change };
	const allFiles =
		include.has("tests") || include.has("definitions") || include.has("references") ? await repositoryFiles(env) : [];
	if (include.has("tests")) result.tests = await neighboringTests(changed, allFiles, env);
	if (include.has("config"))
		result.config = Object.fromEntries(
			await Promise.all(changed.map(async (file) => [file, await configFor(file, env)])),
		);
	if (include.has("owners")) {
		result.owners = null;
		for (const path of ["CODEOWNERS", ".github/CODEOWNERS"])
			if (await exists(join(env.cwd, path))) {
				result.owners = await readFile(join(env.cwd, path), "utf8");
				break;
			}
	}
	for (const kind of ["definitions", "references"]) {
		if (include.has(kind)) result[kind] = await scanReferences(kind, changed, allFiles, env);
	}
	return result;
}
async function testCommands(env: EvidenceEnvironment): Promise<RecordValue> {
	const path = join(env.cwd, "package.json");
	if (!(await exists(path))) return {};
	return object(JSON.parse(await readFile(path, "utf8")).scripts ?? {}, "package scripts");
}
async function findTests(args: RecordValue, env: EvidenceEnvironment): Promise<RecordValue> {
	const nearby = await neighborhood({ ...args, include: ["tests"] }, env);
	return {
		files: unique([...nearby.change.changedFiles, ...nearby.change.untrackedFiles]),
		tests: nearby.tests,
		commands: await testCommands(env),
	};
}
async function runTests(args: RecordValue, env: EvidenceEnvironment): Promise<RecordValue> {
	if (args.command !== undefined && (typeof args.command !== "string" || !args.command.includes("{tests}")))
		throw new TypeError("command must contain the {tests} placeholder");
	const maxTests = integer(args.max_tests ?? 128, "max_tests", 1);
	const tests = await findTests(args, env);
	const selectedTests = unique<string>(Object.values(tests.tests).flat() as string[]);
	if (selectedTests.length > maxTests)
		throw new Error(`Discovered ${selectedTests.length} tests, exceeding max_tests ${maxTests}`);
	if (!selectedTests.length)
		return { status: "not_run", reason: "No neighboring tests discovered", selectedTests, tests };
	const quoted = selectedTests.map(quote).join(" ");
	const cmd = args.command
		? args.command.replaceAll("{tests}", quoted)
		: tests.commands["test:unit"]
			? `npm run test:unit -- ${quoted}`
			: tests.commands.test
				? `npm test -- ${quoted}`
				: undefined;
	if (!cmd)
		return {
			status: "not_run",
			reason: "No explicit command template and no package test script found",
			selectedTests,
			tests,
		};
	// Reuse Pi's Bash discovery (including Git Bash on Windows and WSL stdin transport).
	const shell = getShellConfig();
	const stdin = shell.commandTransport === "stdin";
	const result = await command(
		shell.shell,
		stdin ? shell.args : [...shell.args, cmd],
		env,
		args.timeout ?? 60,
		stdin ? cmd : undefined,
	);
	return { status: result.ok ? "passed" : "failed", command: cmd, output: result.output, selectedTests, tests };
}

export async function runEvidenceFunction(name: string, args: RecordValue, env: EvidenceEnvironment): Promise<unknown> {
	env.signal?.throwIfAborted();
	switch (name) {
		case "git_change":
			return gitChange(args, env);
		case "git_patch":
			return gitPatch(args, env);
		case "repo_change_neighborhood":
			return neighborhood(args, env);
		case "context_required":
			return mark("required", args);
		case "context_clippable":
			return mark("clippable", args);
		case "context_droppable":
			return mark("droppable", args);
		case "context_fit":
			return fitContext(args.value, args);
		case "context_pack":
			return packContext(args);
		case "dev_find_relevant_tests":
			return findTests(args, env);
		case "dev_run_relevant_tests":
			return runTests(args, env);
		default:
			throw new Error(`Unknown evidence function: ${name}`);
	}
}
