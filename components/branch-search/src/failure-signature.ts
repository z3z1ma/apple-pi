import { createHash } from "node:crypto";

/** A finished shell command: its command text, exit code, and output (spec 5.3). */
export interface ShellOutcome {
	command: string;
	exitCode: number;
	output: string;
}

/** Tools whose results are shell runs; any other tool counts only when it reports an exit code. */
const SHELL_TOOLS = new Set(["bash", "powershell"]);
/**
 * The status line Pi's and apple-pi's shell tools end a failed run's error result with; apple-pi's
 * bash may follow it with its surprise note.
 */
const EXIT_LINE = /(?:^|\n)Command exited with code (-?\d+)(?:\n\nSurprise: [^\n]*)?$/;
const FAILURE_WORD = /error|fail|exception|panic|assert/i;
/** An absolute path, not a later segment of a relative path or a URL; it stops at shell and location punctuation. */
const ABSOLUTE_PATH = /(?<![\w.~/-])(?:\/[^\s/:'"`()[\]{}<>,;|]+)+\/?/g;
/**
 * Every run of six or more hex characters, inside identifiers too (spec 5.3). Hex goes before
 * digits, so a hash whose digits and letters interleave still becomes one `#`.
 */
const HEX_RUN = /(?:0x)?[0-9a-fA-F]{6,}/g;
const DIGIT_RUN = /\d+/g;

export function normalizeCommand(command: string): string {
	return command.replace(/\s+/g, " ").trim();
}

/** The first output line that names a failure, else the last non-empty line. */
export function failureLine(output: string): string {
	const lines = output.split("\n");
	return lines.find((line) => FAILURE_WORD.test(line)) ?? lines.findLast((line) => line.trim() !== "") ?? "";
}

export function normalizeLine(line: string): string {
	return line
		.replace(ABSOLUTE_PATH, (path) => path.replace(/\/$/, "").split("/").at(-1) as string)
		.replace(HEX_RUN, "#")
		.replace(DIGIT_RUN, "#")
		.trim();
}

/** sha256 of the normalized command, the exit code, and the normalized failure line (spec 5.3 steps 1-4). */
export function failureSignature({ command, exitCode, output }: ShellOutcome): string {
	const line = normalizeLine(failureLine(output));
	return createHash("sha256")
		.update(`${normalizeCommand(command)}\n${exitCode}\n${line}`)
		.digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The shell run a tool result reports, or undefined when it reports no exit code (a timeout, an abort,
 * a blocked call, a command still running in the background, or a tool that does not run commands).
 * Pi's shell tools report `exit_code` in structured content; apple-pi's bash fails with an error
 * result that ends in the status line and reports nothing on success (V5). The command is the one
 * the model wrote, before RTK rewrote it.
 */
export function shellOutcome(
	toolName: string,
	args: unknown,
	result: { content: readonly { type: string; text?: string }[]; details?: unknown; structuredContent?: unknown },
	isError: boolean,
): ShellOutcome | undefined {
	if (!isRecord(args)) return undefined;
	const command = typeof args._rawCommand === "string" ? args._rawCommand : args.command;
	if (typeof command !== "string") return undefined;
	const text = result.content.flatMap((block) => (block.type === "text" && block.text ? [block.text] : [])).join("\n");
	const structured = isRecord(result.structuredContent) ? result.structuredContent : {};
	const details = isRecord(result.details) ? result.details : {};
	// Started in the background or detached with Ctrl+B: the command has not exited yet.
	if (details.backgrounded === true || details.status === "running") return undefined;
	const output = typeof structured.output === "string" ? structured.output : undefined;
	if (typeof structured.exit_code === "number")
		return { command, exitCode: structured.exit_code, output: output ?? text };
	if (typeof details.exitCode === "number") return { command, exitCode: details.exitCode, output: output ?? text };
	if (!SHELL_TOOLS.has(toolName)) return undefined;
	if (!isError) return { command, exitCode: 0, output: text.trimEnd() };
	const status = EXIT_LINE.exec(text.trimEnd());
	return status ? { command, exitCode: Number(status[1]), output: text.slice(0, status.index).trimEnd() } : undefined;
}

export interface CountedSignature {
	signature: string;
	/** The normalized command; a passive search uses it as its seed gate. */
	command: string;
	count: number;
}

/**
 * Repeat counts per failure signature (spec 5.3). A run that exits 0 deletes every signature of
 * its normalized command. The root session and each branch keep their own counter.
 */
export class FailureCounter {
	private readonly counts = new Map<string, CountedSignature>();

	/** Count a failed run and return its signature's count; a successful run clears its command. */
	record(outcome: ShellOutcome): CountedSignature | undefined {
		const command = normalizeCommand(outcome.command);
		if (outcome.exitCode === 0) {
			for (const [signature, entry] of this.counts) if (entry.command === command) this.counts.delete(signature);
			return undefined;
		}
		const signature = failureSignature(outcome);
		const entry = this.counts.get(signature) ?? { signature, command, count: 0 };
		entry.count++;
		this.counts.set(signature, entry);
		return { ...entry };
	}

	/** Signatures counted at least `threshold` times, in the order they were first seen. */
	reached(threshold: number): CountedSignature[] {
		return [...this.counts.values()].filter((entry) => entry.count >= threshold).map((entry) => ({ ...entry }));
	}
}
