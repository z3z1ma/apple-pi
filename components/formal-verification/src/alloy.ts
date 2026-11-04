import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { cacheDir, download, pinned, runJava } from "./toolchain.js";

export const ALLOY_VERSION = "6.2.0";
const ALLOY_CHECKSUM = "6b8c1cb5bc93bedfc7c61435c4e1ab6e688a242dc702a394628d9a9801edb78d";

export type AlloyVerdict = "pass" | "violation" | "incomplete" | "error";
export type AlloyOutcome = "counterexample" | "no counterexample" | "instance" | "no instance" | "not run";

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
	solver?: string;
	timeLimit?: number;
	signal?: AbortSignal;
	onLine?: (line: string) => void;
}

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

export function listedCommands(output: string): Omit<AlloyCommand, "outcome">[] {
	return [...output.matchAll(/^(\d+) \. (Check|Run) (\S+)(.*)$/gm)].map((match) => ({
		index: Number(match[1]),
		kind: match[2] === "Check" ? "check" : "run",
		name: match[3],
		source: `${match[2].toLowerCase()} ${match[3]}${match[4]}`,
	}));
}

const BUILTIN = /^(?:univ|Int|seq\/Int|String|none)=/;

export function instanceText(text: string): string {
	return text
		.split("\n")
		.filter((line) => line.trim() && !BUILTIN.test(line) && line !== "---Trace---")
		.map((line) => line.replace(/^this\//, "").replace(/^-+(State \d+(?: \(loop\))?)-+$/, "$1:"))
		.join("\n");
}

function selected(command: Omit<AlloyCommand, "outcome">, wanted: string[] | undefined): boolean {
	return !wanted?.length || wanted.some((item) => item === command.name || item === String(command.index));
}

async function execute(
	jar: string,
	spec: string,
	command: Omit<AlloyCommand, "outcome">,
	scratch: string,
	options: AlloyOptions,
	timeLimit: number | undefined,
): Promise<{ command: AlloyCommand; output: string; timedOut: boolean; failed: boolean }> {
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
			...(options.solver ? ["-s", options.solver] : []),
			spec,
		],
		cwd: dirname(spec),
		signal: options.signal,
		timeLimit,
		onLine: options.onLine,
	});
	const written = run.timedOut ? undefined : await readFile(join(out, "receipt.json"), "utf8").catch(() => undefined);
	if (!written)
		return { command: { ...command, outcome: "not run" }, output: run.output, timedOut: run.timedOut, failed: true };
	const receipt = JSON.parse(written) as { commands: Record<string, { expects: number; solution?: unknown[] }> };
	const entry = Object.values(receipt.commands)[0];
	const found = Boolean(entry?.solution?.length);
	const solution = (await readdir(out)).find((file) => file.endsWith(".txt"));
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
			expected: entry?.expects === 1 ? "instance" : entry?.expects === 0 ? "none" : undefined,
			instance: found && solution ? instanceText(await readFile(join(out, solution), "utf8")) : undefined,
		},
		output: run.output,
		timedOut: false,
		failed: false,
	};
}

function surprising(command: AlloyCommand): boolean {
	if (command.outcome === "not run") return false;
	const found = command.outcome === "counterexample" || command.outcome === "instance";
	if (command.expected) return found !== (command.expected === "instance");
	return command.outcome === "counterexample";
}

export async function runAlloy(options: AlloyOptions): Promise<AlloyResult> {
	const jar = await alloyJar(options.signal);
	const spec = resolve(options.spec);
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
	const chosen = listed.filter((command) => selected(command, options.commands));
	if (!chosen.length)
		return {
			...base,
			verdict: "error",
			message: `No command matches ${options.commands?.join(", ")}; the model has ${listed.map((command) => `${command.index} ${command.name}`).join(", ")}.`,
			output: listing.output,
		};
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
			commands.push(result.command);
			if (result.failed && !result.timedOut)
				return { ...base, commands, verdict: "error", message: alloyError(result.output), output };
		}
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
	const unexpected = commands.filter(surprising);
	const skipped = commands.filter((command) => command.outcome === "not run");
	const verdict: AlloyVerdict = unexpected.length ? "violation" : skipped.length ? "incomplete" : "pass";
	const message =
		verdict === "violation"
			? `${unexpected.map((command) => command.name).join(", ")} ${unexpected.length === 1 ? "has" : "have"} an unexpected result within the scope.`
			: verdict === "incomplete"
				? `The time limit stopped the check before ${skipped.map((command) => command.name).join(", ")} finished.`
				: "Every command gave its expected result within its scope; a larger scope may still hold a counterexample.";
	return { ...base, commands, verdict, message, output };
}
