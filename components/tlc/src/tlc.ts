import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export const TLA_TOOLS_VERSION = "1.7.4";
const CHECKSUM = "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88";

export type TlcVerdict = "pass" | "violation" | "deadlock" | "error";

export interface TlcState {
	number: number;
	action: string;
	variables: Record<string, string>;
}

export interface TlcResult {
	verdict: TlcVerdict;
	message: string;
	property?: string;
	trace: TlcState[];
	stats?: { generated: number; distinct: number; left: number; depth?: number };
	exitCode: number | null;
	version: string;
	output: string;
}

function jarPath(): string {
	const cache = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
	return join(cache, "apple-pi", "tla2tools", TLA_TOOLS_VERSION, "tla2tools.jar");
}

function verify(bytes: Buffer, jar: string): void {
	if (createHash("sha256").update(bytes).digest("hex") !== CHECKSUM)
		throw new Error(`tla2tools ${TLA_TOOLS_VERSION} checksum mismatch: remove ${jar} and retry`);
}

export async function tlaTools(signal?: AbortSignal): Promise<string> {
	const jar = jarPath();
	try {
		verify(await readFile(jar), jar);
		return jar;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const url = `https://github.com/tlaplus/tlaplus/releases/download/v${TLA_TOOLS_VERSION}/tla2tools.jar`;
	const response = await fetch(url, { signal });
	if (!response.ok) throw new Error(`tla2tools download failed: ${response.status} ${response.statusText}`);
	const bytes = Buffer.from(await response.arrayBuffer());
	verify(bytes, jar);
	const dir = join(jar, "..");
	await mkdir(dir, { recursive: true });
	const pending = `${jar}.${process.pid}.tmp`;
	try {
		await writeFile(pending, bytes);
		await rename(pending, jar);
	} finally {
		await rm(pending, { force: true });
	}
	return jar;
}

function parseState(header: RegExpExecArray, body: string[]): TlcState {
	const variables: Record<string, string> = {};
	let current: string | undefined;
	for (const line of body) {
		const start = /^(?:\/\\ )?(\w+) = (.*)$/.exec(line);
		if (start && (line.startsWith("/\\ ") || !current)) {
			current = start[1]!;
			variables[current] = start[2]!;
		} else if (current) variables[current] = `${variables[current]} ${line.trim()}`;
	}
	return { number: Number(header[1]), action: header[2]!.replace(/ line \d+, col .*$/, ""), variables };
}

export function parseTlcOutput(output: string, exitCode: number | null): Omit<TlcResult, "version"> {
	const lines = output.split(/\r?\n/);
	const trace: TlcState[] = [];
	for (let i = 0; i < lines.length; i++) {
		const header = /^State (\d+): <(.*)>$/.exec(lines[i]!);
		if (!header) continue;
		const body: string[] = [];
		for (i++; i < lines.length && lines[i]!.trim() !== ""; i++) body.push(lines[i]!);
		trace.push(parseState(header, body));
	}
	const counts = /(\d+) states generated, (\d+) distinct states found, (\d+) states left on queue/.exec(output);
	const depth = /The depth of the complete state graph search is (\d+)/.exec(output);
	const stats = counts
		? {
				generated: Number(counts[1]),
				distinct: Number(counts[2]),
				left: Number(counts[3]),
				...(depth ? { depth: Number(depth[1]) } : {}),
			}
		: undefined;
	const invariant = /Error: Invariant (\S+) is violated/.exec(output);
	const property = /Error: (?:Action property|Property) (\S+) is violated/.exec(output);
	const base = { trace, stats, exitCode, output };
	if (invariant)
		return { ...base, verdict: "violation", property: invariant[1], message: `Invariant ${invariant[1]} is violated.` };
	if (property)
		return { ...base, verdict: "violation", property: property[1], message: `Property ${property[1]} is violated.` };
	if (/Error: Temporal properties were violated/.test(output))
		return { ...base, verdict: "violation", message: "Temporal properties were violated." };
	if (/Error: Deadlock reached/.test(output)) return { ...base, verdict: "deadlock", message: "Deadlock reached." };
	if (exitCode === 0 && /Model checking completed\. No error has been found\./.test(output))
		return { ...base, verdict: "pass", message: "Model checking completed. No error has been found." };
	const reason = lines.find((line) => /^(Error:|\*\*\*|Fatal|TLC threw)/.test(line.trim()));
	return { ...base, verdict: "error", message: reason?.trim() ?? `TLC exited with code ${exitCode}.` };
}

export async function runTlc(options: {
	spec: string;
	config?: string;
	signal?: AbortSignal;
	onLine?: (line: string) => void;
}): Promise<TlcResult> {
	const jar = await tlaTools(options.signal);
	const source = await readFile(options.spec, "utf8");
	const module = /^-{4,}\s+MODULE\s+(\w+)\s+-{4,}\s*$/m.exec(source)?.[1];
	if (!module) throw new Error(`${options.spec} has no "---- MODULE Name ----" header`);
	const config = options.config ?? options.spec.replace(/\.tla$/, ".cfg");
	const scratch = await mkdtemp(join(tmpdir(), "tlc-"));
	try {
		await writeFile(join(scratch, `${module}.tla`), source);
		await writeFile(join(scratch, `${module}.cfg`), await readFile(config));
		const child = spawn(
			"java",
			["-XX:+UseParallelGC", "-cp", jar, "tlc2.TLC", "-workers", "1", "-config", `${module}.cfg`, module],
			{ cwd: scratch, stdio: ["ignore", "pipe", "pipe"] },
		);
		let output = "";
		let partial = "";
		const take = (chunk: Buffer) => {
			const text = chunk.toString();
			output += text;
			const pieces = (partial + text).split(/\r?\n/);
			partial = pieces.pop() ?? "";
			for (const line of pieces) options.onLine?.(line);
		};
		child.stdout.on("data", take);
		child.stderr.on("data", take);
		const stop = () => child.kill("SIGTERM");
		options.signal?.addEventListener("abort", stop, { once: true });
		if (options.signal?.aborted) stop();
		try {
			const exitCode = await new Promise<number | null>((resolve, reject) => {
				child.once("error", (error) =>
					reject(
						(error as NodeJS.ErrnoException).code === "ENOENT"
							? new Error("TLC needs Java on PATH (Java 11 or newer).")
							: error,
					),
				);
				child.once("close", (code) => resolve(code));
			});
			options.signal?.throwIfAborted();
			return { ...parseTlcOutput(output, exitCode), version: TLA_TOOLS_VERSION };
		} finally {
			options.signal?.removeEventListener("abort", stop);
		}
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}
