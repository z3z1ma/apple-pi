import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { cacheDir, download, pinned, runJava } from "./toolchain.js";

export const ALLOY_VERSION = "6.2.0";
const ALLOY_CHECKSUM = "6b8c1cb5bc93bedfc7c61435c4e1ab6e688a242dc702a394628d9a9801edb78d";
export const ALLOY_SOLVERS = ["sat4j", "sat4j.light", "minisat", "minisat.prover", "glucose"] as const;

export type AlloyVerdict = "pass" | "violation" | "incomplete" | "error";
export type AlloyOutcome = "counterexample" | "no counterexample" | "instance" | "no instance" | "not run";
export type AlloySolver = (typeof ALLOY_SOLVERS)[number];

export interface AlloyCommand {
	index: number;
	kind: "check" | "run";
	name: string;
	source: string;
	outcome: AlloyOutcome;
	expected?: "instance" | "none";
	instance?: string;
}

export interface AlloyResult {
	verdict: AlloyVerdict;
	message: string;
	commands: AlloyCommand[];
	version: string;
	output: string;
}

export interface AlloyOptions {
	spec: string;
	commands?: string[];
	solver?: AlloySolver;
	timeLimit?: number;
	signal?: AbortSignal;
	onLine?: (line: string) => void;
}

type Listed = Omit<AlloyCommand, "outcome">;

export async function alloyJar(signal?: AbortSignal): Promise<string> {
	const jar = cacheDir("alloy", ALLOY_VERSION, "org.alloytools.alloy.dist.jar");
	await pinned(jar, ALLOY_CHECKSUM, () =>
		download(
			`https://github.com/AlloyTools/org.alloytools.alloy/releases/download/v${ALLOY_VERSION}/org.alloytools.alloy.dist.jar`,
			ALLOY_CHECKSUM,
			signal,
		),
	);
	return jar;
}

export function alloyError(output: string): string {
	const lines: string[] = [];
	for (const line of output.split("\n")) {
		if (/^\s+at |^Error$|^\s+\d+\. \[|^\[main\] ERROR/.test(line) || !line.trim()) continue;
		if (lines.includes(line)) continue;
		lines.push(line);
	}
	return lines.join("\n");
}

export function listedCommands(output: string): Listed[] {
	return [...output.matchAll(/^(\d+) \. (Check|Run) (\S+)(.*)$/gm)].map((match) => {
		const expect = /\bexpect\s+(\d+)\s*$/.exec(match[4])?.[1];
		return {
			index: Number(match[1]),
			kind: match[2] === "Check" ? "check" : "run",
			name: match[3],
			source: `${match[2].toLowerCase()} ${match[3]}${match[4]}`,
			...(expect === undefined ? {} : { expected: expect === "0" ? "none" : "instance" }),
		};
	});
}

const BUILTIN = /^(?:univ|Int|seq\/Int|String|none)=/;

export function instanceText(text: string): string {
	const lines = text
		.split("\n")
		.filter((line) => line.trim() && !BUILTIN.test(line) && line !== "---Trace---")
		.map((line) => line.replace(/^this\//, "").replace(/^-+(State \d+(?: \(loop\))?)-+$/, "$1:"));
	const states = lines.filter((line) => /^State \d+/.test(line)).length;
	return (states === 1 ? lines.filter((line) => !/^State \d+/.test(line)) : lines).join("\n");
}

function select(listed: Listed[], wanted: string[] | undefined): Listed[] | string {
	if (!wanted?.length) return listed;
	const unmatched = wanted.filter(
		(item) => !listed.some((command) => item === command.name || item === String(command.index)),
	);
	if (unmatched.length)
		return `No command matches ${unmatched.join(", ")}; the model has ${listed.map((command) => `${command.index} ${command.name}`).join(", ")}.`;
	return listed.filter((command) => wanted.some((item) => item === command.name || item === String(command.index)));
}

function expectationReport(command: Listed, output: string): boolean | undefined {
	if (!command.expected) return undefined;
	const label = `${command.kind === "check" ? "Check" : "Run"} ${command.name}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const report = new RegExp(`^\\s*\\d+\\. '${label}\\b[^']*' was (not )?satisfied against expectation$`, "m").exec(
		output,
	);
	return report ? !report[1] : undefined;
}

function solverResult(receipt: unknown, command: Listed, solver: string): boolean | undefined {
	const root = receipt as { solver?: unknown; commands?: unknown };
	if (typeof root !== "object" || root === null || root.solver !== solver) return undefined;
	if (typeof root.commands !== "object" || root.commands === null) return undefined;
	const entries = Object.entries(root.commands);
	if (entries.length !== 1 || entries[0][0] !== command.name) return undefined;
	const entry = entries[0][1] as { name?: unknown; type?: unknown; transformPath?: unknown; solution?: unknown };
	if (typeof entry !== "object" || entry === null || entry.name !== command.name || entry.type !== command.kind)
		return undefined;
	if (entry.transformPath !== undefined) return undefined;
	if (entry.solution === undefined) return false;
	if (!Array.isArray(entry.solution) || !entry.solution.length) return undefined;
	const valid = entry.solution.every(
		(solution) =>
			typeof solution === "object" &&
			solution !== null &&
			Array.isArray((solution as { instances?: unknown }).instances) &&
			(solution as { instances: unknown[] }).instances.length > 0,
	);
	return valid ? true : undefined;
}

type Executed = { command: AlloyCommand; output: string } | { error: string; output: string };

async function execute(
	jar: string,
	spec: string,
	command: Listed,
	scratch: string,
	options: AlloyOptions,
	timeLimit: number | undefined,
): Promise<Executed> {
	const out = join(scratch, String(command.index));
	const run = await runJava({
		args: [
			"-jar",
			jar,
			"exec",
			"-q",
			"-f",
			"-t",
			"text",
			"-o",
			out,
			"-c",
			String(command.index),
			"-s",
			options.solver ?? "sat4j",
			spec,
		],
		cwd: dirname(spec),
		signal: options.signal,
		timeLimit,
		onLine: options.onLine,
	});
	const output = run.output;
	if (run.timedOut) return { command: { ...command, outcome: "not run" }, output };
	const missed = expectationReport(command, output);
	if (run.exitCode !== 0 && !(run.exitCode === 1 && missed !== undefined))
		return {
			error: `Alloy ${run.exitCode === null ? "was stopped by a signal" : `exited with status ${run.exitCode}`} on ${command.name}:\n${alloyError(output)}`,
			output,
		};
	let receipt: unknown;
	try {
		receipt = JSON.parse(await readFile(join(out, "receipt.json"), "utf8"));
	} catch (error) {
		return { error: `Alloy left no readable result for ${command.name}: ${(error as Error).message}`, output };
	}
	const found = solverResult(receipt, command, options.solver ?? "sat4j");
	if (found === undefined)
		return { error: `Alloy's result for ${command.name} is not a solver result for that command.`, output };
	if (missed !== undefined && (run.exitCode !== 1 || missed !== found || found === (command.expected === "instance")))
		return { error: `Alloy's report of a missed expect for ${command.name} does not match its result.`, output };
	const solution = (await readdir(out)).find((file) => file.endsWith(".txt"));
	if (found && !solution) return { error: `Alloy found an instance for ${command.name} but wrote none.`, output };
	return {
		command: {
			...command,
			outcome:
				command.kind === "check"
					? found
						? "counterexample"
						: "no counterexample"
					: found
						? "instance"
						: "no instance",
			instance: found && solution ? instanceText(await readFile(join(out, solution), "utf8")) : undefined,
		},
		output,
	};
}

const found = (command: AlloyCommand) => command.outcome === "counterexample" || command.outcome === "instance";

export function judge(commands: AlloyCommand[]): [AlloyVerdict, string] {
	const ran = commands.filter((command) => command.outcome !== "not run");
	const missed = ran.filter((command) => command.expected && found(command) !== (command.expected === "instance"));
	const properties = ran.filter((command) => command.kind === "check" && command.expected !== "instance");
	const refuted = properties.filter((command) => command.outcome === "counterexample" && !command.expected);
	const violations = [
		...refuted.map((command) => `${command.name} has a counterexample within its scope.`),
		...missed.map((command) => `${command.name} found ${found(command) ? "one" : "none"}, against its expect.`),
	];
	if (violations.length) return ["violation", violations.join(" ")];
	const skipped = commands.filter((command) => command.outcome === "not run");
	const empty = ran.filter((command) => command.kind === "run" && !command.expected && !found(command));
	const witness = ran.some((command) => command.kind === "run" && command.expected !== "none" && found(command));
	const gaps = [
		skipped.length ? `the time limit stopped ${skipped.map((command) => command.name).join(", ")}` : "",
		empty.length
			? `${empty.map((command) => command.name).join(", ")} found no instance, so the facts may rule out what ${empty.length === 1 ? "it asks" : "they ask"} for`
			: "",
		properties.length ? "" : "no property check ran (a check with `expect 1` is a control, not a property)",
		witness
			? ""
			: "no run found an instance, so nothing shows the facts are satisfiable and the checks may hold vacuously",
	].filter(Boolean);
	if (gaps.length) return ["incomplete", `Not established: ${gaps.join("; ")}.`];
	const controls = ran.filter((command) => command.kind === "check" && command.expected === "instance");
	return [
		"pass",
		`Every property check found no counterexample within its scope, and a run shows the facts admit an instance${controls.length ? `; ${controls.length} control check${controls.length === 1 ? "" : "s"} found the expected counterexample` : ""}. A larger scope may still hold a counterexample.`,
	];
}

export async function runAlloy(options: AlloyOptions): Promise<AlloyResult> {
	if (options.solver && !ALLOY_SOLVERS.includes(options.solver))
		throw new Error(`solver must be one of ${ALLOY_SOLVERS.join(", ")}`);
	const jar = await alloyJar(options.signal);
	const spec = resolve(options.spec);
	const fingerprint = async () =>
		createHash("sha256")
			.update(await readFile(spec))
			.digest("hex");
	const before = await fingerprint();
	const base = { version: ALLOY_VERSION, commands: [] as AlloyCommand[] };
	const listing = await runJava({
		args: ["-jar", jar, "commands", spec],
		cwd: dirname(spec),
		signal: options.signal,
	});
	const listed = listedCommands(listing.output);
	if (listing.exitCode !== 0 || !listed.length)
		return {
			...base,
			verdict: "error",
			message: listing.exitCode === 0 ? "The model has no check or run command." : alloyError(listing.output),
			output: listing.output,
		};
	const chosen = select(listed, options.commands);
	if (typeof chosen === "string") return { ...base, verdict: "error", message: chosen, output: listing.output };
	const deadline = options.timeLimit === undefined ? undefined : Date.now() + options.timeLimit * 1000;
	const scratch = await mkdtemp(join(tmpdir(), "alloy-"));
	const commands: AlloyCommand[] = [];
	let output = listing.output;
	try {
		for (const command of chosen) {
			const remaining = deadline === undefined ? undefined : Math.max(0, (deadline - Date.now()) / 1000);
			if (remaining === 0) {
				commands.push({ ...command, outcome: "not run" });
				continue;
			}
			const result = await execute(jar, spec, command, scratch, options, remaining);
			output += result.output;
			if ("error" in result) return { ...base, commands, verdict: "error", message: result.error, output };
			commands.push(result.command);
		}
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
	if ((await fingerprint()) !== before)
		return { ...base, commands, verdict: "error", message: "The model changed while it was being checked.", output };
	const [verdict, message] = judge(commands);
	return { ...base, commands, verdict, message, output };
}
