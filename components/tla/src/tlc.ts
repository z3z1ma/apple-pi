import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import {
	type ConfigOverrides,
	cacheDir,
	configWith,
	download,
	pinned,
	readConfig,
	runJava,
	stageModules,
	type TlaResult,
	type TlaState,
	type TlaStats,
} from "./toolchain.js";

export const TLA_TOOLS_VERSION = "1.7.4";
const TOOLS_CHECKSUM = "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88";
export const COMMUNITY_MODULES_VERSION = "202610262215";
const COMMUNITY_CHECKSUM = "5c1ecfc4c40e30b5a2658643b5afe9116300ffe1d1a2274753865f8e0cba4493";

export type TlcMode = "exhaustive" | "simulate" | "depth-first";

export interface TlcOptions extends ConfigOverrides {
	spec: string;
	config?: string;
	mode?: TlcMode;
	workers?: number;
	depth?: number;
	traces?: number;
	seed?: number;
	timeLimit?: number;
	signal?: AbortSignal;
	onLine?: (line: string) => void;
}

export async function tlaTools(signal?: AbortSignal): Promise<string> {
	const jar = cacheDir("tla2tools", TLA_TOOLS_VERSION, "tla2tools.jar");
	await pinned(jar, TOOLS_CHECKSUM, () =>
		download(
			`https://github.com/tlaplus/tlaplus/releases/download/v${TLA_TOOLS_VERSION}/tla2tools.jar`,
			TOOLS_CHECKSUM,
			signal,
		),
	);
	return jar;
}

function jarModules(jar: Buffer): Map<string, Buffer> {
	const end = jar.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	if (end < 0) throw new Error("community modules archive is not a zip file");
	const modules = new Map<string, Buffer>();
	let entry = jar.readUInt32LE(end + 16);
	for (let i = jar.readUInt16LE(end + 10); i > 0; i--) {
		const method = jar.readUInt16LE(entry + 10);
		const size = jar.readUInt32LE(entry + 20);
		const nameLength = jar.readUInt16LE(entry + 28);
		const name = jar.toString("utf8", entry + 46, entry + 46 + nameLength);
		const local = jar.readUInt32LE(entry + 42);
		if (/^[^/]+\.tla$/.test(name)) {
			const start = local + 30 + jar.readUInt16LE(local + 26) + jar.readUInt16LE(local + 28);
			const data = jar.subarray(start, start + size);
			modules.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
		}
		entry += 46 + nameLength + jar.readUInt16LE(entry + 30) + jar.readUInt16LE(entry + 32);
	}
	return modules;
}

export async function communityModules(signal?: AbortSignal): Promise<string> {
	const dir = cacheDir("tla-community-modules", COMMUNITY_MODULES_VERSION);
	const library = join(dir, "modules");
	const bytes = await pinned(join(dir, "CommunityModules.jar"), COMMUNITY_CHECKSUM, () =>
		download(
			`https://github.com/tlaplus/CommunityModules/releases/download/${COMMUNITY_MODULES_VERSION}/CommunityModules-${COMMUNITY_MODULES_VERSION}.jar`,
			COMMUNITY_CHECKSUM,
			signal,
		),
	);
	try {
		if ((await readdir(library)).length) return library;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const pending = `${library}.${process.pid}.tmp`;
	try {
		await mkdir(pending, { recursive: true });
		for (const [name, source] of jarModules(bytes)) await writeFile(join(pending, name), source);
		await rename(pending, library).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== "ENOTEMPTY" && error.code !== "EEXIST") throw error;
		});
	} finally {
		await rm(pending, { recursive: true, force: true });
	}
	return library;
}

function parseState(header: RegExpExecArray, body: string[]): TlaState {
	const variables: Record<string, string> = {};
	let current: string | undefined;
	for (const line of body) {
		const start = /^(?:\/\\ )?(\w+) = (.*)$/.exec(line);
		if (start && (line.startsWith("/\\ ") || !current)) {
			current = start[1]!;
			variables[current] = start[2]!;
		} else if (current) variables[current] = `${variables[current]} ${line.trim()}`;
	}
	return {
		number: Number(header[1]),
		action: header[2]?.replace(/ line \d+, col .*$/, "") ?? "",
		variables,
	};
}

const count = (text: string | undefined) => (text === undefined ? undefined : Number(text.replaceAll(",", "")));

function parseStats(output: string): TlaStats | undefined {
	const depth = count(/The depth of the complete state graph search is (\d+)/.exec(output)?.[1]);
	const last = [
		...output.matchAll(
			/^([\d,]+) states generated(?: \([^)]*\))?, ([\d,]+) distinct states found(?:, ([\d,]+) states left on queue)?\.$/gm,
		),
	].at(-1);
	if (last)
		return {
			generated: count(last[1])!,
			distinct: count(last[2]),
			...(last[3] === undefined ? {} : { left: count(last[3]) }),
			...(depth === undefined ? {} : { depth }),
		};
	const simulated =
		/The number of states generated: ([\d,]+)/.exec(output)?.[1] ??
		[...output.matchAll(/^Progress: ([\d,]+) states checked/gm)].at(-1)?.[1];
	return simulated === undefined ? undefined : { generated: count(simulated)! };
}

function parseCoverage(output: string): string[] {
	const start = output.lastIndexOf("The coverage statistics at");
	if (start < 0) return [];
	const block = output.slice(start, output.indexOf("End of statistics.", start));
	const unused: string[] = [];
	for (const match of block.matchAll(
		/^<(\w+) line (\d+), col \d+ to .*? of module (\w+)(?: \((\d+) (\d+) \d+ \d+\))?>: \d+:(\d+)$/gm,
	)) {
		if (match[6] !== "0") continue;
		const [, name, line, module, partLine, partColumn] = match;
		unused.push(
			partLine ? `${name} (line ${partLine}, col ${partColumn} of ${module})` : `${name} (line ${line} of ${module})`,
		);
	}
	return unused;
}

export function parseTlcOutput(
	output: string,
	exitCode: number | null,
	mode: TlcMode = "exhaustive",
): Omit<TlaResult, "version"> {
	const lines = output.split(/\r?\n/);
	const trace: TlaState[] = [];
	for (let i = 0; i < lines.length; i++) {
		const header = /^State (\d+):(?: <(.*)>)?$/.exec(lines[i]!);
		if (!header) continue;
		const body: string[] = [];
		for (i++; i < lines.length && lines[i]!.trim() !== ""; i++) body.push(lines[i]!);
		trace.push(parseState(header, body));
	}
	const stats = parseStats(output);
	const seed = mode === "simulate" ? /with seed (-?\d+)/.exec(output)?.[1] : undefined;
	const base = { trace, stats, unused: [] as string[], seed, exitCode, output };
	const invariant = /Error: Invariant (\S+) is violated/.exec(output);
	const property = /Error: (?:Action property|Property) (\S+) is violated/.exec(output);
	if (invariant)
		return { ...base, verdict: "violation", property: invariant[1], message: `Invariant ${invariant[1]} is violated.` };
	if (property)
		return { ...base, verdict: "violation", property: property[1], message: `Property ${property[1]} is violated.` };
	if (/Error: Temporal properties were violated/.test(output))
		return { ...base, verdict: "violation", message: "Temporal properties were violated." };
	if (/Error: Deadlock reached/.test(output)) return { ...base, verdict: "deadlock", message: "Deadlock reached." };
	const finished = /^Finished in /m.test(output);
	const noError = /Model checking completed\. No error has been found\./.test(output);
	const searched = { ...base, unused: parseCoverage(output) };
	if (exitCode === 0 && finished) {
		if (mode === "simulate")
			return {
				...searched,
				verdict: "incomplete",
				message: `No violation in ${stats?.generated ?? "the"} states of random simulation; simulation does not cover every state.`,
			};
		if (noError && !stats?.left)
			return { ...searched, verdict: "pass", message: "Model checking completed. No error has been found." };
		if (noError)
			return {
				...searched,
				verdict: "incomplete",
				message: `Stopped at the time limit with ${stats?.left} states left on the queue; no violation among the ${stats?.distinct} distinct states reached.`,
			};
		if (mode === "depth-first")
			return {
				...searched,
				verdict: "incomplete",
				message: "No violation up to the depth bound; deeper states were not explored.",
			};
	}
	const reason = lines.find((line) => /^(Error:|\*\*\*|Fatal|TLC threw)/.test(line.trim()));
	return { ...base, verdict: "error", message: reason?.trim() ?? `TLC exited with code ${exitCode}.` };
}

function searchArguments(options: TlcOptions): string[] {
	const mode = options.mode ?? "exhaustive";
	if (mode === "simulate") {
		if (options.traces === undefined && options.timeLimit === undefined)
			throw new Error("simulate needs traces or timeLimit; random simulation otherwise runs until cancelled");
		return [
			"-simulate",
			...(options.traces === undefined ? [] : [`num=${options.traces}`]),
			...(options.depth === undefined ? [] : ["-depth", String(options.depth)]),
			...(options.seed === undefined ? [] : ["-seed", String(options.seed)]),
		];
	}
	if (mode === "depth-first") {
		if (options.depth === undefined) throw new Error("depth-first needs depth, the bound on behavior length");
		return ["-dfid", String(options.depth)];
	}
	return [];
}

export async function runTlc(options: TlcOptions): Promise<TlaResult> {
	const [jar, library] = await Promise.all([tlaTools(options.signal), communityModules(options.signal)]);
	const search = searchArguments(options);
	const scratch = await mkdtemp(join(tmpdir(), "tlc-"));
	try {
		const module = await stageModules(options.spec, scratch);
		const config = await readConfig(options.spec, options.config);
		if (config === undefined) throw new Error(`no TLC config beside ${options.spec}; pass config`);
		await writeFile(join(scratch, `${module}.cfg`), configWith(config, options));
		const { output, exitCode } = await runJava({
			args: [
				"-XX:+UseParallelGC",
				`-DTLA-Library=${library}`,
				...(options.timeLimit === undefined ? [] : [`-Dtlc2.TLC.stopAfter=${options.timeLimit}`]),
				"-cp",
				jar,
				"tlc2.TLC",
				"-workers",
				String(options.workers ?? (options.mode === "depth-first" ? 1 : "auto")),
				"-coverage",
				"60",
				...search,
				"-config",
				`${module}.cfg`,
				module,
			],
			cwd: scratch,
			signal: options.signal,
			onLine: options.onLine,
		});
		return { ...parseTlcOutput(output, exitCode, options.mode), version: TLA_TOOLS_VERSION };
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}
