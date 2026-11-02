// Go to its terminal: switch the operator's tmux client to a character's pane. The client is the one attached to the
// pane's server that the operator used last; `switch-client` to a pane id selects that pane's session, window, and
// pane at once. Leaving the world changes nothing else in tmux.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TerminalResult } from "../world.js";

const run = promisify(execFile);
const TMUX_TIMEOUT_MS = 2000;

async function tmux(socket: string, args: string[]): Promise<string> {
	const { stdout } = await run("tmux", ["-S", socket, ...args], { timeout: TMUX_TIMEOUT_MS, encoding: "utf8" });
	return stdout;
}

/** Switch the most recently active client of the server at `socket` to `pane`; `name` is the character's. */
export async function switchToPane(socket: string, pane: string, name: string): Promise<TerminalResult> {
	let clients: { tty: string; activity: number }[];
	try {
		clients = (await tmux(socket, ["list-clients", "-F", "#{client_tty}\t#{client_activity}"]))
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const [tty, activity] = line.split("\t");
				return { tty, activity: Number(activity) || 0 };
			});
	} catch {
		// tmux answers "no server running" (or cannot run at all): either way, no terminal shows the pane.
		clients = [];
	}
	const client = clients.sort((a, b) => b.activity - a.activity)[0];
	if (!client) return { ok: false, reason: `No terminal is attached to ${name}'s tmux server.` };
	try {
		await tmux(socket, ["switch-client", "-c", client.tty, "-t", pane]);
		return { ok: true };
	} catch (error) {
		const message = (error as { stderr?: string }).stderr?.trim() || (error as Error).message;
		return { ok: false, reason: `tmux could not switch to ${name}'s pane: ${message}` };
	}
}
