import { constants } from "node:os";
import type { BashOperations, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { prepareShellCommand } from "./bash-tool.js";
import { killProcessTree } from "./process-killer.js";
import { TerminalTranscript } from "./terminal-transcript.js";
import { withUserBashStyle } from "./ui/user-bash.js";

/**
 * Runs the operator's `!` commands on the same pseudo-terminal as the Bash tool, without RTK, and
 * passes Pi each line's final plain text as soon as the line ends.
 */
export function terminalShellOperations(ctx: ExtensionContext): BashOperations {
	return {
		async exec(command, cwd, { onData, signal, timeout }) {
			const prepared = await prepareShellCommand(cwd, { command }, signal, ctx, false, true);
			const child = prepared.start();
			const emit = (plain: string, styled: string) => {
				const send = () => onData(Buffer.from(plain));
				if (ctx.mode === "tui") withUserBashStyle(styled, send);
				else send();
			};
			const transcript = new TerminalTranscript(1, (line) => emit(`${line.plain}\n`, `${line.styled}\n`));
			const decoder = new TextDecoder();
			const write = (chunk: Buffer) => transcript.write(decoder.decode(chunk, { stream: true }));
			child.stdout?.on("data", write);
			child.stderr?.on("data", write);
			let timedOut = false;
			const kill = () => {
				if (child.pid) killProcessTree(child.pid);
			};
			const timer =
				timeout === undefined
					? undefined
					: setTimeout(() => {
							timedOut = true;
							kill();
						}, timeout * 1000);
			signal?.addEventListener("abort", kill, { once: true });
			try {
				const exitCode = await new Promise<number>((resolve, reject) => {
					child.once("error", reject);
					child.once("close", (code, signalName) =>
						resolve(code ?? (signalName ? 128 + (constants.signals[signalName] ?? 0) : 1)),
					);
				});
				transcript.write(decoder.decode());
				transcript.finish();
				const last = transcript.screenLines()[0];
				if (last?.plain) emit(last.plain, last.styled);
				if (signal?.aborted) throw new Error("aborted");
				if (timedOut) throw new Error(`timeout:${timeout}`);
				return { exitCode };
			} finally {
				clearTimeout(timer);
				signal?.removeEventListener("abort", kill);
			}
		},
	};
}
