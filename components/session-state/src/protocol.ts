// The runtime's socket protocol: bridges send one JSON object per line.

export type RunState = "idle" | "thinking" | "writing_reply" | "running_tool" | "compacting";
export type ProcessState = "starting" | "alive" | "alive_bridge_lost" | "exited" | "lost";

export interface Hello {
	type: "hello";
	session: { id: string; kind: "root"; file?: string; cwd: string; name?: string };
	process: { pid: number; startedAt: number };
	/** The tmux server socket and pane this session runs in, from its `TMUX` and `TMUX_PANE`; absent outside tmux. */
	tmux?: { socket: string; pane: string };
	run: RunState;
}

export type BridgeMessage =
	| Hello
	| { type: "heartbeat" }
	| { type: "run"; run: RunState }
	| { type: "shutdown"; reason: string };

/** A bridge sends a heartbeat this often; the runtime treats a bridge silent for SILENCE_MS as lost. */
export const HEARTBEAT_MS = 1000;
export const SILENCE_MS = 5000;

/** Split a byte stream into complete lines; a partial final line waits for its newline. */
export function lineReader(onLine: (line: string) => void): (chunk: Buffer | string) => void {
	let buffer = "";
	return (chunk) => {
		buffer += chunk.toString();
		for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
			const line = buffer.slice(0, end);
			buffer = buffer.slice(end + 1);
			if (line.trim()) onLine(line);
		}
	};
}
