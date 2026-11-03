import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	cacheDir,
	configWith,
	download,
	pinned,
	readConfig,
	runJava,
	stageModules,
	type TlaResult,
	type TlaState,
} from "./toolchain.js";

export const APALACHE_VERSION = "0.62.4";
const ARCHIVE_CHECKSUM = "b781b53bba32fac14ac2e02b0332e1dc2edc64cb7b850c0608d8142cc7aa2ef4";
const JAR_CHECKSUM = "e5223915507b65cc5f1638bd037ede60f8a4fc1644aff46355779f9b05df9262";

export type ApalacheMode = "bounded" | "inductive";

export interface ApalacheOptions {
	spec: string;
	config?: string;
	mode?: ApalacheMode;
	invariants?: string[];
	inductive?: string;
	length?: number;
	constInit?: string;
	constants?: Record<string, string>;
	init?: string;
	next?: string;
	temporal?: string[];
	checkDeadlock?: boolean;
	timeLimit?: number;
	signal?: AbortSignal;
	onLine?: (line: string) => void;
}

export async function apalacheJar(signal?: AbortSignal, onLine?: (line: string) => void): Promise<string> {
	const jar = cacheDir("apalache", APALACHE_VERSION, "apalache.jar");
	await pinned(jar, JAR_CHECKSUM, async () => {
		onLine?.(`Downloading Apalache ${APALACHE_VERSION} (192 MB, first use only)`);
		const archive = await download(
			`https://github.com/apalache-mc/apalache/releases/download/v${APALACHE_VERSION}/apalache-${APALACHE_VERSION}.tgz`,
			ARCHIVE_CHECKSUM,
			signal,
		);
		const scratch = await mkdtemp(join(tmpdir(), "apalache-"));
		try {
			await writeFile(join(scratch, "apalache.tgz"), archive);
			const member = `apalache-${APALACHE_VERSION}/lib/apalache.jar`;
			await promisify(execFile)("tar", ["-xzf", "apalache.tgz", member], { cwd: scratch, signal });
			return await readFile(join(scratch, member));
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});
	return jar;
}

export function itfValue(value: unknown): string {
	if (Array.isArray(value)) return `<<${value.map(itfValue).join(", ")}>>`;
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
	if (value === null || typeof value !== "object") return String(value);
	const record = value as Record<string, unknown>;
	if ("#bigint" in record) return String(record["#bigint"]);
	if ("#set" in record) return `{${(record["#set"] as unknown[]).map(itfValue).join(", ")}}`;
	if ("#tup" in record) return `<<${(record["#tup"] as unknown[]).map(itfValue).join(", ")}>>`;
	if ("#map" in record) {
		const pairs = record["#map"] as [unknown, unknown][];
		return pairs.length ? `(${pairs.map(([k, v]) => `${itfValue(k)} :> ${itfValue(v)}`).join(" @@ ")})` : "<<>>";
	}
	if ("#unserializable" in record) return String(record["#unserializable"]);
	return `[${Object.entries(record)
		.map(([k, v]) => `${k} |-> ${itfValue(v)}`)
		.join(", ")}]`;
}

export function itfTrace(itf: string, first: string): TlaState[] {
	const states = (JSON.parse(itf) as { states: Record<string, unknown>[] }).states;
	return states.map((state, index) => ({
		number: index + 1,
		action: index === 0 ? first : "Next",
		variables: Object.fromEntries(
			Object.entries(state)
				.filter(([name]) => name !== "#meta")
				.map(([name, value]) => [name, itfValue(value)]),
		),
	}));
}

export function configInvariants(config: string): string[] {
	const tokens = config
		.replace(/\\\*.*$/gm, "")
		.replace(/\(\*[\s\S]*?\*\)/g, "")
		.split(/\s+/);
	const names: string[] = [];
	let collecting = false;
	for (const token of tokens) {
		if (/^[A-Z_]+$/.test(token) && token.length > 2) collecting = token === "INVARIANT" || token === "INVARIANTS";
		else if (collecting && token) names.push(token);
	}
	return names;
}

interface Check {
	init: string;
	invariants: string[];
	length: number;
	first: string;
	deadlock: boolean;
	temporal?: string[];
}

type CheckOutcome =
	| { kind: "ok"; tooShort: boolean; output: string; exitCode: number | null }
	| { kind: "failed"; result: Omit<TlaResult, "version"> };

const logLine = (line: string) => line.replace(/\s+[EIW]@\d\d:\d\d:\d\d\.\d+\s*$/, "").trim();

async function check(
	run: Check,
	context: { jar: string; scratch: string; module: string; config?: string; options: ApalacheOptions },
	deadline?: number,
	index = 0,
): Promise<CheckOutcome> {
	const runDir = join(context.scratch, `run-${index}`);
	const { options } = context;
	const remaining = deadline === undefined ? undefined : Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
	const { output, exitCode, timedOut } = await runJava({
		args: [
			"-jar",
			context.jar,
			"check",
			`--out-dir=${join(context.scratch, "out")}`,
			`--run-dir=${runDir}`,
			...(context.config ? [`--config=${context.config}`] : []),
			...(options.constInit ? [`--cinit=${options.constInit}`] : []),
			`--init=${run.init}`,
			`--next=${options.next ?? "Next"}`,
			...(run.invariants.length ? [`--inv=${run.invariants.join(",")}`] : []),
			...(run.temporal?.length ? [`--temporal=${run.temporal.join(",")}`] : []),
			`--length=${run.length}`,
			...(run.deadlock ? [] : ["--no-deadlock"]),
			`${context.module}.tla`,
		],
		cwd: context.scratch,
		signal: options.signal,
		timeLimit: remaining,
		onLine: options.onLine,
	});
	const base = { trace: [] as TlaState[], unused: [] as string[], exitCode, output };
	if (timedOut) {
		const step = [...output.matchAll(/^State (\d+): Checking/gm)].at(-1)?.[1];
		return {
			kind: "failed",
			result: {
				...base,
				verdict: "incomplete",
				message: `Stopped at the time limit${step === undefined ? "" : ` while checking step ${step}`}; no violation found before it.`,
			},
		};
	}
	const outcome = /The outcome is: (\w+)/.exec(output)?.[1];
	if (exitCode === 0 && (outcome === "NoError" || outcome === "ExecutionsTooShort"))
		return { kind: "ok", tooShort: outcome === "ExecutionsTooShort", output, exitCode };
	const itf = await readFile(join(runDir, "violation1.itf.json"), "utf8").catch(() =>
		readFile(join(runDir, "violation.itf.json"), "utf8").catch(() => undefined),
	);
	const trace = itf ? itfTrace(itf, run.first) : [];
	if (outcome === "Deadlock")
		return { kind: "failed", result: { ...base, trace, verdict: "deadlock", message: "Deadlock reached." } };
	if (outcome === "Error" && trace.length) {
		const property = run.invariants.length === 1 ? run.invariants[0] : undefined;
		const formula = /InvariantViolation ==\s*~\(([\s\S]*?)\)\s*\n\s*\n/.exec(
			await readFile(join(runDir, "violation1.tla"), "utf8").catch(() => ""),
		)?.[1];
		const part = formula ? ` The broken part: ${formula.replace(/\s+/g, " ")}.` : "";
		return {
			kind: "failed",
			result: {
				...base,
				trace,
				verdict: "violation",
				property,
				message: `${property ? `Invariant ${property} is violated.` : "An invariant is violated."}${part}`,
			},
		};
	}
	const lines = output.split(/\r?\n/);
	const reasons = lines
		.filter((line) => / E@\d/.test(line) || /^(Parsing error|\*\*\*|Error)/.test(line.trim()))
		.map(logLine);
	const version = /UnsupportedClassVersionError/.test(output) ? "Apalache needs Java 17 or newer." : undefined;
	return {
		kind: "failed",
		result: {
			...base,
			verdict: "error",
			message: version ?? (reasons.slice(0, 3).join(" ") || `Apalache exited with code ${exitCode}.`),
		},
	};
}

export async function runApalache(options: ApalacheOptions): Promise<TlaResult> {
	const jar = await apalacheJar(options.signal, options.onLine);
	const deadline = options.timeLimit === undefined ? undefined : Date.now() + options.timeLimit * 1000;
	const scratch = await mkdtemp(join(tmpdir(), "apalache-"));
	try {
		const module = await stageModules(options.spec, scratch);
		const source = await readConfig(options.spec, options.config);
		let config: string | undefined;
		if (source !== undefined || options.constants) {
			config = join(scratch, "apalache.cfg");
			const entry = /\b(?:INIT|SPECIFICATION)\b/.test(source ?? "")
				? ""
				: `INIT ${options.init ?? "Init"}\nNEXT ${options.next ?? "Next"}\n`;
			await writeFile(config, configWith(`${entry}${source ?? ""}`, { constants: options.constants }));
		}
		const invariants = options.invariants ?? configInvariants(source ?? "");
		const deadlock = options.checkDeadlock ?? !/CHECK_DEADLOCK\s+FALSE/.test(source ?? "");
		const context = { jar, scratch, module, config, options };
		const init = options.init ?? "Init";
		const done = (result: Omit<TlaResult, "version">): TlaResult => ({ ...result, version: APALACHE_VERSION });
		const constants = options.constInit ? `, for every constant value ${options.constInit} allows` : "";
		if ((options.mode ?? "bounded") === "bounded") {
			if (!invariants.length && !options.temporal?.length && !deadlock)
				throw new Error("name invariants or temporal properties to check");
			const length = options.length ?? 10;
			const outcome = await check(
				{ init, invariants, length, first: init, deadlock, temporal: options.temporal },
				context,
				deadline,
			);
			if (outcome.kind === "failed") return done(outcome.result);
			const base = { trace: [], unused: [], exitCode: outcome.exitCode, output: outcome.output };
			return done(
				outcome.tooShort
					? {
							...base,
							verdict: "pass",
							message: `Every behavior ends within ${length} steps and none violates the properties${constants}.`,
						}
					: {
							...base,
							verdict: "incomplete",
							message: `No violation in any behavior up to ${length} steps${constants}. Longer behaviors were not checked; mode "inductive" proves an invariant for every length.`,
						},
			);
		}
		const inductive = options.inductive;
		if (!inductive) throw new Error('mode "inductive" needs `inductive`, the inductive invariant');
		if (!invariants.length) throw new Error('mode "inductive" needs `invariants`, the properties to prove');
		const steps: [Check, string][] = [
			[
				{ init, invariants: [inductive], length: 0, first: init, deadlock: false },
				`${init} does not establish ${inductive}: the trace is an initial state where it is false.`,
			],
			[
				{
					init: inductive,
					invariants: [inductive],
					length: 1,
					first: `${inductive} (any state satisfying it, possibly unreachable)`,
					deadlock: false,
				},
				`${inductive} is not inductive: from a state satisfying it, one step breaks it. That state may be unreachable; strengthen ${inductive} to exclude it.`,
			],
			[
				{
					init: inductive,
					invariants,
					length: 0,
					first: `${inductive} (any state satisfying it, possibly unreachable)`,
					deadlock: false,
				},
				`${inductive} does not imply the invariant: a state satisfying ${inductive} breaks it.`,
			],
		];
		let last: CheckOutcome | undefined;
		for (const [index, [run, failure]] of steps.entries()) {
			last = await check(run, context, deadline, index);
			if (last.kind === "failed")
				return done(
					last.result.verdict === "violation"
						? { ...last.result, message: `${failure}${/ The broken part:.*$/.exec(last.result.message)?.[0] ?? ""}` }
						: last.result,
				);
		}
		return done({
			trace: [],
			unused: [],
			exitCode: last?.kind === "ok" ? last.exitCode : null,
			output: last?.kind === "ok" ? last.output : "",
			verdict: "pass",
			message: `Proved: ${init} establishes ${inductive}, every step preserves it, and it implies ${invariants.join(", ")}. They hold in every reachable state, for behaviors of any length${constants}.`,
		});
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}
