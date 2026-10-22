import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type Member, organizationColumns, organizationOf } from "../../organization/src/directory.js";
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
				`select s.id, s.name, s.cwd, s.run_state, s.prompt, s.reports_to, ${organizationColumns(db, ["role"])}, json_extract(s.current_task, '$.taskId') as task
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

/** The tools every person has, restored after a resume replaces the tool loadout with the transcript's older one. */
const PERSON_TOOLS = ["directory", "send_mail", "reply", "inbox", "read_thread", "post"];

/** A person as the directory shows it: who, what it does, and to whom it reports. */
function entry(member: Member, names: Map<string, string>) {
	return {
		name: member.name ?? member.id,
		id: member.id,
		title: member.title,
		role: member.role,
		manager: member.reportsTo ? (names.get(member.reportsTo) ?? member.reportsTo) : null,
		team: `team:${member.reportsTo ?? member.id}`,
		status: member.status === "busy" ? "working" : member.status === "waiting" ? "asking the operator" : member.status,
		workingOn: member.currentTask,
		directory: member.cwd,
		soul: member.soul,
		record: member.tasks,
		since: member.since,
		...(member.retired ? { left: member.retired } : {}),
	};
}

/** `directory` (your organization) for the model and `/pi-sessions` (every live session on the machine) for the operator, in root sessions. */
export function installPeers(pi: ExtensionAPI): void {
	const activate = () => {
		const active = pi.getActiveTools();
		const missing = PERSON_TOOLS.filter((name) => !active.includes(name));
		if (missing.length) pi.setActiveTools([...active, ...missing]);
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
			name: "directory",
			label: "directory",
			description:
				"Your organization's directory: everyone in it including you, awake or asleep, with name, id, title, manager, whether they are working, idle, asking the operator, or asleep, what they work on, their directory, one line of their soul, and their record (the ledger tasks they have worked on, newest first). Former members, who left, are listed only with former: true. Write to anyone with send_mail by name.",
			promptSnippet: "Your organization's directory: who is in it, what each does, and whom each reports to.",
			parameters: Type.Object(
				{ former: Type.Optional(Type.Boolean({ description: "Also list the people who left, with when and why." })) },
				{ additionalProperties: false },
			),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const self = ctx.sessionManager.getSessionId();
				const all = organizationOf(self, true).members;
				const names = new Map(all.map((member) => [member.id, member.name ?? member.id]));
				const members = all.filter((member) => !member.retired).map((member) => entry(member, names));
				const former = params.former
					? all.filter((member) => member.retired).map((member) => entry(member, names))
					: [];
				const text =
					members.length || former.length
						? JSON.stringify(params.former ? { members, former } : members, null, 2)
						: "Nobody else is in your organization.";
				return { content: [{ type: "text", text }], details: { members, former } };
			},
		}),
	);
}
