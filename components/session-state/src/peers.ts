import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type Member, organizationColumns, organizationOf } from "../../organization/src/directory.js";
import { managesPeople } from "../../organization/src/install.js";
import { statePaths } from "./paths.js";
import { OPERATOR } from "./threads.js";
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

type Entry = ReturnType<typeof entry>;
type Directory = ReturnType<typeof readDirectory>;

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
			id: OPERATOR,
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
	return { members, former, ...(backlog ? { backlog } : {}) };
}

/** The members who are people in the tree; the operator heads the roster as its own line. */
const people = (members: Directory["members"]) => members.filter((member): member is Entry => member.id !== OPERATOR);

const day = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : "never");

function rosterLine(person: Entry): string {
	const who = `${person.name} (${person.id})${person.title ? `, ${person.title}` : ""}, reports to ${person.manager}`;
	if (person.left) return `- ${who}: left ${day(person.left.at)}: ${person.left.reason}`;
	const focus = person.focus ? `; focus: ${person.focus.title} [${person.focus.id}]` : "";
	return `- ${who}: ${person.status}, ${person.availability}${focus}; ${person.tasks.length} held, ${person.record.length} finished`;
}

/** The roster: one line per person, the backlog for a manager, and how to see one person in full. */
function rosterText(directory: Directory): string {
	const lines = [
		"Operator (operator): the human at the top of the organization.",
		...people(directory.members).map(rosterLine),
	];
	if (directory.former.length) lines.push("", "Former members:", ...directory.former.map(rosterLine));
	if (directory.backlog)
		lines.push(
			"",
			directory.backlog.length ? "Backlog (unassigned live ledger tasks):" : "Backlog: empty.",
			...directory.backlog.map((task) => `- ${task.title} [${task.id}]${task.status ? ` (${task.status})` : ""}`),
		);
	lines.push(
		"",
		"directory with person: <name or id> shows one person's tasks, record with outcomes, directory, and soul.",
	);
	return lines.join("\n");
}

function personText(person: Entry): string {
	const task = (held: Entry["tasks"][number]) =>
		`- ${held.title} [${held.id}]${person.focus?.id === held.id ? " (focus)" : ""}: ${held.bundle}/task.md, thread ${held.thread ?? "none"}`;
	const finished = (done: Entry["record"][number]) =>
		`- ${done.title} [${done.id}] (${day(done.endedAt)}, ${done.endReason ?? "ended"}): ${done.outcome ?? "no outcome"}`;
	return [
		`${person.name} (${person.id})${person.title ? `, ${person.title} (${person.role})` : ""}, reports to ${person.manager}; team channel ${person.team}`,
		person.left
			? `Left ${day(person.left.at)}: ${person.left.reason}`
			: `Status: ${person.status}, ${person.availability}`,
		`Directory: ${person.directory}`,
		`Soul: ${person.soul ?? "none"}`,
		`Since: ${day(person.since)}`,
		"",
		person.tasks.length ? "Held tasks:" : "Held tasks: none.",
		...person.tasks.map(task),
		"",
		person.record.length ? "Record:" : "Record: nothing finished yet.",
		...person.record.map(finished),
	].join("\n");
}

/**
 * The directory as the model reads it: a roster of one line per person, or one person in full. `details` keeps the
 * structured projection for programs and views.
 */
export function directoryView(
	self: string,
	options: { former?: boolean; person?: string; backlog?: boolean },
): { content: { type: "text"; text: string }[]; details: unknown } {
	if (options.person) {
		const wanted = options.person.trim().toLowerCase();
		const directory = readDirectory(self, true);
		const person = [...people(directory.members), ...directory.former].find(
			(member) => member.id.toLowerCase() === wanted || member.name.toLowerCase() === wanted,
		);
		if (!person) throw new Error(`Nobody in your organization is called ${options.person}.`);
		return { content: [{ type: "text", text: personText(person) }], details: person };
	}
	const directory = readDirectory(self, options.former, options.backlog);
	return { content: [{ type: "text", text: rosterText(directory) }], details: directory };
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
				"Your organization's directory: one line per person, with the operator at the top: name, id, title, manager, whether they are working, idle, asking the operator, or at home, whether they are available, their focus, and how many tasks they hold and have finished. Managers also see unassigned live ledger tasks in the backlog. Give person for one person in full: held tasks, the record of finished assignments with outcomes, working directory, and soul. Former members, who left, are listed only with former: true. Write to anyone with send_mail by name.",
			promptSnippet: "Your organization's directory: who is in it, what each does, and whom each reports to.",
			parameters: Type.Object(
				{
					former: Type.Optional(Type.Boolean({ description: "Also list the people who left, with when and why." })),
					person: Type.Optional(
						Type.String({ minLength: 1, description: "A name or session id: show that one person in full." }),
					),
				},
				{ additionalProperties: false },
			),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const self = ctx.sessionManager.getSessionId();
				return directoryView(self, { ...params, backlog: managesPeople(pi, ctx) });
			},
		}),
	);
}
