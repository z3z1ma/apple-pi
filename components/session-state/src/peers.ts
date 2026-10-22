import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type Member, organizationColumns, organizationOf } from "../../organization/src/directory.js";
import { managesPeople } from "../../organization/src/install.js";
import { statePaths } from "./paths.js";
import { withWork } from "./work.js";
import { backlogOf, hasWork } from "./work-read.js";

export interface Peer {
	id: string;
	name: string | null;
	cwd: string;
	status: "busy" | "idle" | "waiting";
	reportsTo: string | null;
	role: string | null;
	focus: string | null;
}

/** Live top-level sessions other than `self`, read from the state database. */
export function livePeers(self: string | null): Peer[] {
	const path = statePaths().db;
	if (!existsSync(path)) return [];
	const db = new DatabaseSync(path, { readOnly: true });
	try {
		const focused = hasWork(db) ? "(select task_id from work_focus where person = s.id)" : "null";
		const rows = db
			.prepare(
				`select s.id, s.name, s.cwd, s.run_state, s.prompt, s.reports_to, ${organizationColumns(db, ["role"])}, ${focused} as task
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
			focus: row.task,
		}));
	} finally {
		db.close();
	}
}

/** The tools every person has, restored after a resume replaces the tool loadout with the transcript's older one. */
const PERSON_TOOLS = ["directory", "send_mail", "reply", "inbox", "read_thread", "post", "escalate"];

/** A person as the directory shows it: who, what it does, and to whom it reports. */
function entry(member: Member, names: Map<string, string>) {
	return {
		name: member.name ?? member.id,
		id: member.id,
		title: member.title,
		role: member.role,
		manager: member.reportsTo ? (names.get(member.reportsTo) ?? member.reportsTo) : "Operator",
		team: `team:${member.reportsTo ?? member.id}`,
		status: member.status === "busy" ? "working" : member.status === "waiting" ? "asking the operator" : member.status,
		availability: member.tasks.length ? "assigned" : "available",
		focus: member.focus,
		tasks: member.tasks,
		directory: member.cwd,
		soul: member.soul,
		record: member.record,
		since: member.since,
		...(member.retired ? { left: member.retired } : {}),
	};
}

/** One read-only directory projection, shared by the person and its pair. */
export function readDirectory(self: string, includeFormer = false, includeBacklog = false) {
	const organization = organizationOf(self, true);
	const all = organization.members;
	const backlog = includeBacklog
		? (withWork((db) =>
				backlogOf(
					db,
					organization.root,
					all.filter((member) => !member.retired).map((member) => member.cwd),
				),
			) ?? [])
		: undefined;
	const names = new Map(all.map((member) => [member.id, member.name ?? member.id]));
	const members = [
		{
			id: "operator",
			name: "Operator",
			title: "Operator",
			role: null,
			manager: null,
			team: null,
			status: "human",
			availability: null,
			focus: null,
			tasks: [],
			directory: null,
			soul: null,
			record: [],
			since: null,
		},
		...all.filter((member) => !member.retired).map((member) => entry(member, names)),
	];
	const former = includeFormer ? all.filter((member) => member.retired).map((member) => entry(member, names)) : [];
	const details = { members, former, ...(backlog ? { backlog } : {}) };
	return details;
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
				"Your organization's directory: everyone in it including you, awake or asleep, with the operator at the top, name, id, title, manager, whether they are working, idle, asking the operator, or asleep, their explicit tasks and focused goal, whether they are available for work, their directory, one line of their soul, and the record of finished assignments and outcomes. Managers also see unassigned live ledger tasks in the backlog. Former members, who left, are listed only with former: true. Write to anyone with send_mail by name.",
			promptSnippet: "Your organization's directory: who is in it, what each does, and whom each reports to.",
			parameters: Type.Object(
				{ former: Type.Optional(Type.Boolean({ description: "Also list the people who left, with when and why." })) },
				{ additionalProperties: false },
			),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const self = ctx.sessionManager.getSessionId();
				const details = readDirectory(self, params.former, managesPeople(pi, ctx));
				return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }], details };
			},
		}),
	);
}
