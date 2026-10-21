import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { organizationOf, roleColumn } from "../../organization/src/directory.js";
import { statePaths } from "./paths.js";

export interface Peer {
	id: string;
	name: string | null;
	cwd: string;
	status: "busy" | "idle" | "waiting";
	reportsTo: string | null;
	role: string | null;
	currentTask: string | null;
}

/** Live top-level sessions other than `self`, read from the state database. */
export function livePeers(self: string | null): Peer[] {
	const path = statePaths().db;
	if (!existsSync(path)) return [];
	const db = new DatabaseSync(path, { readOnly: true });
	try {
		const rows = db
			.prepare(
				`select s.id, s.name, s.cwd, s.run_state, s.prompt, s.reports_to, ${roleColumn(db)}, json_extract(s.current_task, '$.taskId') as task
				from sessions s join incarnations i on i.session_id = s.id and i.generation = s.generation
				where s.kind = 'root' and s.id is not ? and i.ended_at is null and i.process_state in ('alive', 'alive_bridge_lost')
				order by s.updated_at desc`,
			)
			.all(self) as {
			id: string;
			name: string | null;
			cwd: string;
			run_state: string;
			prompt: string | null;
			reports_to: string | null;
			role: string | null;
			task: string | null;
		}[];
		return rows.map((row) => ({
			id: row.id,
			name: row.name,
			cwd: row.cwd,
			status: row.prompt ? "waiting" : row.run_state === "idle" ? "idle" : "busy",
			reportsTo: row.reports_to,
			role: row.role,
			currentTask: row.task,
		}));
	} finally {
		db.close();
	}
}

/** `list_peer_sessions` (the directory of the session's organization) for the model and `/pi-sessions` (every live session on the machine) for the operator, in root sessions. */
export function installPeers(pi: ExtensionAPI): void {
	const activate = () => {
		const active = pi.getActiveTools();
		if (!active.includes("list_peer_sessions")) pi.setActiveTools([...active, "list_peer_sessions"]);
	};
	pi.on("session_start", activate);
	pi.on("before_agent_start", activate);
	pi.registerCommand("pi-sessions", {
		description: "List the live top-level Pi sessions on this machine",
		handler: async (_args, ctx) => {
			const sessions = livePeers(null);
			const lines = sessions.map(
				(session) => `${session.status.padEnd(7)} ${session.id}  ${session.name ?? session.cwd}`,
			);
			ctx.ui.notify(`Live Pi sessions (${sessions.length}):\n${lines.join("\n") || "(none)"}`, "info");
		},
	});
	pi.registerTool(
		defineTool({
			name: "list_peer_sessions",
			label: "list_peer_sessions",
			description:
				"The directory of your organization: every other person in it, awake or asleep. A person is a lasting top-level Pi session, often in its own tmux window, which you reach with mailbox_send by id. Each has an id, name, role, manager (reportsTo), status (busy, idle, waiting for the user, or asleep), directory, current ledger task, the ledger tasks it has worked on (newest first), and when it was hired. Your subagents are not people: they are children you start with agent and reach with steer_subagent and get_subagent_result.",
			promptSnippet: "The directory of your organization: the people (not your subagents) you can mail.",
			parameters: Type.Object({}, { additionalProperties: false }),
			async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
				const { members } = organizationOf(ctx.sessionManager.getSessionId());
				return {
					content: [
						{
							type: "text",
							text: members.length > 0 ? JSON.stringify(members, null, 2) : "Nobody else is in your organization.",
						},
					],
					details: { members },
				};
			},
		}),
	);
}
