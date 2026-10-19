// The inn: stopped top-level sessions as dormant characters, and waking one. Waking sends the runtime's `start`
// command for the stopped session, aimed at the pane the operator used last: the runtime opens a new tmux window right
// after that pane's window, running `pi --session-id <id>` (with the name and coordinator it had), and the session's
// next incarnation joins the world awake.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DormantAgent } from "../world.js";
import type { Sleeper } from "./projection.js";

const run = promisify(execFile);
const TMUX_TIMEOUT_MS = 2000;

/** What the inn shows of a stopped session beyond the projection: where it worked, its last task, why it stopped. */
export interface SleeperRow {
	cwd: string;
	reportsTo: string | null;
	git: string | null;
	currentTask: string | null;
	stopReason: string | null;
}

/** The inn's sleepers with their observed facts, the most recently stopped first. */
export function dormantAgents(
	sleepers: Sleeper[],
	rows: Map<string, SleeperRow>,
	readTask: (currentTask: string | null) => DormantAgent["task"],
): DormantAgent[] {
	return sleepers.map((sleeper) => {
		const row = rows.get(sleeper.id);
		let repository: string | null = null;
		try {
			const git = JSON.parse(row?.git ?? "null") as { repository?: unknown } | null;
			if (typeof git?.repository === "string") repository = git.repository;
		} catch {}
		return {
			...sleeper,
			reportsTo: row?.reportsTo ?? null,
			repository,
			cwd: row?.cwd ?? "",
			task: readTask(row?.currentTask ?? null),
			stopReason: row?.stopReason ?? null,
		};
	});
}

/** A pane to open a woken session's window after, and the tmux server it is on. */
export interface WakePane {
	socket: string;
	pane: string;
}

/**
 * The pane of the operator's most recently active tmux client, across the servers the runtime knows. Undefined when
 * no terminal is attached to any of them.
 */
export async function operatorPane(sockets: string[]): Promise<WakePane | undefined> {
	const clients = await Promise.all(
		sockets.map(async (socket) => {
			try {
				const { stdout } = await run("tmux", ["-S", socket, "list-clients", "-F", "#{client_activity}\t#{pane_id}"], {
					timeout: TMUX_TIMEOUT_MS,
					encoding: "utf8",
				});
				return stdout
					.split("\n")
					.filter(Boolean)
					.map((line) => {
						const [activity, pane] = line.split("\t");
						return { socket, pane, activity: Number(activity) || 0 };
					})
					.filter((client) => client.pane);
			} catch {
				return []; // a server that is gone or does not answer has no terminal to open beside
			}
		}),
	);
	const latest = clients.flat().sort((a, b) => b.activity - a.activity)[0];
	return latest ? { socket: latest.socket, pane: latest.pane } : undefined;
}
