import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type TlaVerdict = "pass" | "violation" | "deadlock" | "incomplete" | "error";

export interface TlaState {
	number: number;
	action: string;
	variables: Record<string, string>;
}

export interface TlaStats {
	generated: number;
	distinct?: number;
	left?: number;
	depth?: number;
}

export interface TlaResult {
	verdict: TlaVerdict;
	message: string;
	property?: string;
	trace: TlaState[];
	stats?: TlaStats;
	unused: string[];
	seed?: string;
	exitCode: number | null;
	version: string;
	output: string;
}

export interface ConfigOverrides {
	constants?: Record<string, string>;
	checkDeadlock?: boolean;
	invariants?: string[];
	properties?: string[];
}

export function cacheDir(...parts: string[]): string {
	return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "apple-pi", ...parts);
}

export async function pinned(file: string, checksum: string, produce: () => Promise<Buffer>): Promise<Buffer> {
	const verify = (bytes: Buffer) => {
		if (createHash("sha256").update(bytes).digest("hex") !== checksum)
			throw new Error(`checksum mismatch for ${file}: remove it and retry`);
		return bytes;
	};
	try {
		return verify(await readFile(file));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const bytes = verify(await produce());
	await mkdir(dirname(file), { recursive: true });
	const pending = `${file}.${process.pid}.tmp`;
	try {
		await writeFile(pending, bytes);
		await rename(pending, file);
	} finally {
		await rm(pending, { force: true });
	}
	return bytes;
}

export async function download(url: string, checksum: string, signal?: AbortSignal): Promise<Buffer> {
	const response = await fetch(url, { signal });
	if (!response.ok) throw new Error(`download failed: ${url}: ${response.status} ${response.statusText}`);
	const bytes = Buffer.from(await response.arrayBuffer());
	if (createHash("sha256").update(bytes).digest("hex") !== checksum) throw new Error(`checksum mismatch for ${url}`);
	return bytes;
}

export function moduleName(source: string): string | undefined {
	return /^-{4,}\s+MODULE\s+(\w+)\s+-{4,}\s*$/m.exec(source)?.[1];
}

export async function stageModules(spec: string, scratch: string): Promise<string> {
	const source = await readFile(spec, "utf8");
	const module = moduleName(source);
	if (!module) throw new Error(`${spec} has no "---- MODULE Name ----" header`);
	const directory = dirname(spec);
	const staged = new Map<string, string>([[module, spec]]);
	for (const file of await readdir(directory)) {
		const path = join(directory, file);
		if (!file.endsWith(".tla") || path === spec) continue;
		const text = await readFile(path, "utf8");
		const name = moduleName(text);
		if (!name || name === module) continue;
		const other = staged.get(name);
		if (other) throw new Error(`module ${name} is declared by both ${other} and ${path}`);
		staged.set(name, path);
		await writeFile(join(scratch, `${name}.tla`), text);
	}
	await writeFile(join(scratch, `${module}.tla`), source);
	return module;
}

export async function readConfig(spec: string, config: string | undefined): Promise<string | undefined> {
	const path = config ?? spec.replace(/\.tla$/, ".cfg");
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT" && config === undefined) return undefined;
		if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`no TLC config at ${path}`);
		throw error;
	}
}

function valueEnd(text: string, start: number): number {
	if (text[start] === '"') return text.indexOf('"', start + 1) + 1;
	if (text[start] === "{") {
		let depth = 0;
		for (let i = start; i < text.length; i++) {
			if (text[i] === "{") depth++;
			else if (text[i] === "}" && --depth === 0) return i + 1;
		}
		return text.length;
	}
	return start + (/^-?[\w.]+/.exec(text.slice(start))?.[0].length ?? 0);
}

export function configWith(config: string, options: ConfigOverrides): string {
	let text = config;
	for (const [name, value] of Object.entries(options.constants ?? {})) {
		if (!/^\w+$/.test(name)) throw new Error(`constant name ${JSON.stringify(name)} is not a TLA+ identifier`);
		const assignment = new RegExp(`(?<![\\w!])${name}\\s*(?:=|<-)\\s*`, "g");
		let found = false;
		for (let match = assignment.exec(text); match; match = assignment.exec(text)) {
			const line = text.slice(text.lastIndexOf("\n", match.index) + 1, match.index);
			if (line.includes("\\*")) continue;
			const end = valueEnd(text, match.index + match[0].length);
			const replacement = `${name} = ${value}`;
			text = text.slice(0, match.index) + replacement + text.slice(end);
			assignment.lastIndex = match.index + replacement.length;
			found = true;
		}
		if (!found) text += `\nCONSTANT ${name} = ${value}\n`;
	}
	if (options.checkDeadlock !== undefined)
		text = `${text.replace(/^[ \t]*CHECK_DEADLOCK[ \t]+(?:TRUE|FALSE)[ \t]*$/gm, "")}\nCHECK_DEADLOCK ${options.checkDeadlock ? "TRUE" : "FALSE"}\n`;
	if (options.invariants?.length) text += `\nINVARIANT ${options.invariants.join(" ")}\n`;
	if (options.properties?.length) text += `\nPROPERTY ${options.properties.join(" ")}\n`;
	return text;
}

export interface ProcessOptions {
	args: string[];
	cwd: string;
	env?: NodeJS.ProcessEnv;
	input?: string;
	signal?: AbortSignal;
	timeLimit?: number;
	onLine?: (line: string) => void;
}

export interface ProcessResult {
	output: string;
	stdout: string;
	exitCode: number | null;
	timedOut: boolean;
}

const STOP_GRACE_MS = 5000;

export function runJava(options: ProcessOptions): Promise<ProcessResult> {
	return runProcess("java", options, "This tool needs Java on PATH (Java 17 or newer).");
}

export async function runProcess(command: string, options: ProcessOptions, missing: string): Promise<ProcessResult> {
	const child = spawn(command, options.args, {
		cwd: options.cwd,
		env: options.env ?? process.env,
		stdio: ["pipe", "pipe", "pipe"],
		detached: true,
	});
	child.stdin.on("error", () => undefined);
	child.stdin.end(options.input ?? "");
	let output = "";
	let stdout = "";
	let partial = "";
	let timedOut = false;
	const take = (chunk: Buffer) => {
		const text = chunk.toString();
		output += text;
		const pieces = (partial + text).split(/\r?\n/);
		partial = pieces.pop() ?? "";
		for (const line of pieces) options.onLine?.(line);
	};
	child.stdout.on("data", (chunk: Buffer) => {
		stdout += chunk.toString();
		take(chunk);
	});
	child.stderr.on("data", take);
	const signalGroup = (signal: NodeJS.Signals) => {
		try {
			if (child.pid) process.kill(-child.pid, signal);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
		}
	};
	let escalation: NodeJS.Timeout | undefined;
	const stop = () => {
		signalGroup("SIGTERM");
		escalation ??= setTimeout(() => signalGroup("SIGKILL"), STOP_GRACE_MS);
	};
	options.signal?.addEventListener("abort", stop, { once: true });
	if (options.signal?.aborted) stop();
	const timer =
		options.timeLimit === undefined
			? undefined
			: setTimeout(() => {
					timedOut = true;
					stop();
				}, options.timeLimit * 1000);
	try {
		const exitCode = await new Promise<number | null>((resolve, reject) => {
			child.once("error", (error) =>
				reject((error as NodeJS.ErrnoException).code === "ENOENT" ? new Error(missing) : error),
			);
			child.once("close", (code) => resolve(code));
		});
		options.signal?.throwIfAborted();
		return { output, stdout, exitCode, timedOut };
	} finally {
		clearTimeout(timer);
		clearTimeout(escalation);
		options.signal?.removeEventListener("abort", stop);
	}
}
