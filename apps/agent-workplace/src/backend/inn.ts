import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import type { DormantAgent } from "../world.js";
import { parseShared } from "./facts.js";
import type { Sleeper } from "./projection.js";

const run = promisify(execFile);
const TMUX_TIMEOUT_MS = 2000;

export interface SleeperRow {
	temporary?: number;
	cwd: string;
	reportsTo: string | null;
	git: string | null;
	currentTask: string | null;
	stopReason: string | null;
}

const sameAgent = (a: DormantAgent, b: DormantAgent) =>
	(Object.keys(a) as (keyof DormantAgent)[]).every((key) =>
		key === "task"
			? a.task === b.task ||
				(a.task?.title === b.task?.title && a.task?.status === b.task?.status && a.task?.bundle === b.task?.bundle)
			: a[key] === b[key],
	);

const sameSleeper = (agent: DormantAgent, sleeper: Sleeper) =>
	(Object.keys(sleeper) as (keyof Sleeper)[]).every((key) => agent[key] === sleeper[key]);

const madeFrom = new WeakMap<DormantAgent, SleeperRow | undefined>();

export function dormantAgents(
	sleepers: Sleeper[],
	rows: Map<string, SleeperRow>,
	readTask: (currentTask: string | null) => DormantAgent["task"],
	previous: DormantAgent[] = [],
	keep = false,
): DormantAgent[] {
	const before = keep ? new Map(previous.map((agent) => [agent.id, agent])) : undefined;
	const next = sleepers.map((sleeper): DormantAgent => {
		const row = rows.get(sleeper.id);
		const kept = before?.get(sleeper.id);
		if (kept && madeFrom.get(kept) === row && sameSleeper(kept, sleeper)) return kept;
		return made(sleeper, row, readTask);
	});
	if (
		next.length !== previous.length ||
		next.some((agent, i) => agent !== previous[i] && !sameAgent(agent, previous[i]))
	)
		return next;
	for (const [i, agent] of previous.entries()) madeFrom.set(agent, madeFrom.get(next[i]));
	return previous;
}

function made(
	sleeper: Sleeper,
	row: SleeperRow | undefined,
	readTask: (currentTask: string | null) => DormantAgent["task"],
): DormantAgent {
	const git = parseShared<{ repository?: unknown } | null>(row?.git);
	const agent: DormantAgent = {
		...sleeper,
		temporary: row?.temporary === 1,
		reportsTo: row?.reportsTo ?? null,
		repository: typeof git?.repository === "string" ? git.repository : null,
		cwd: row?.cwd ?? "",
		task: readTask(row?.currentTask ?? null),
		stopReason: row?.stopReason ?? null,
	};
	madeFrom.set(agent, row);
	return agent;
}

export interface WakePane {
	socket: string;
	pane: string;
}

export async function operatorPane(path: string): Promise<WakePane | undefined> {
	if (!existsSync(path)) return undefined;
	const db = new DatabaseSync(path);
	let sockets: string[];
	try {
		db.exec("pragma query_only = 1");
		sockets = (
			db.prepare("select socket from tmux_servers order by updated_at desc").all() as { socket: string }[]
		).map((row) => row.socket);
	} finally {
		db.close();
	}
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
				return [];
			}
		}),
	);
	const latest = clients.flat().sort((a, b) => b.activity - a.activity)[0];
	return latest ? { socket: latest.socket, pane: latest.pane } : undefined;
}
