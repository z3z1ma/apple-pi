import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	type Member,
	type Organization,
	organizationColumns,
	organizationOf,
} from "../../organization/src/directory.js";
import { COMMUNICATION_TOOLS } from "./communication-tools.js";
import { statePaths } from "./paths.js";
import { hasWork } from "./work-read.js";

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

/** Restore newly registered person tools when resume loads an older transcript's tool set. */
const PERSON_TOOLS = ["directory", ...COMMUNICATION_TOOLS];
const statuses = ["working", "idle", "asking the operator", "at home"] as const;
export interface DirectoryOptions {
	person?: string;
	team?: string;
	subtree?: string;
	role?: string | null;
	status?: (typeof statuses)[number];
	name?: string;
	limit?: number;
	offset?: number;
	history?: { limit: number; offset?: number };
}
const pageFields = {
	limit: Type.Integer({
		minimum: 1,
		maximum: Number.MAX_SAFE_INTEGER,
		description: "Number of rows requested; no implicit page size.",
	}),
	offset: Type.Optional(
		Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: "Row offset; defaults to zero." }),
	),
};
export const directoryParameters = Type.Object(
	{
		person: Type.Optional(
			Type.String({ minLength: 1, description: "Exact name or ID for a concise current profile." }),
		),
		team: Type.Optional(Type.String({ minLength: 1, description: "Direct reports of this manager (name or ID)." })),
		subtree: Type.Optional(
			Type.String({ minLength: 1, description: "This person and their descendants (name or ID)." }),
		),
		role: Type.Optional(
			Type.Union([Type.String({ minLength: 1 }), Type.Null()], {
				description: "Exact role catalog name, or null for unroled people.",
			}),
		),
		status: Type.Optional(Type.Union(statuses.map((status) => Type.Literal(status)))),
		name: Type.Optional(
			Type.String({ minLength: 1, description: "Case-insensitive name substring for people discovery." }),
		),
		limit: Type.Optional(pageFields.limit),
		offset: pageFields.offset,
		history: Type.Optional(
			Type.Object(pageFields, {
				additionalProperties: false,
				description:
					"With person only: explicit page of finished assignments and outcomes, not participation or unassignments.",
			}),
		),
	},
	{ additionalProperties: false },
);
export const directoryDescription =
	"Discover your organization's people through compact responses. With no arguments, shows counts by direct manager, role and status. Filter compact people by team (direct manager), subtree, role, status or name substring; IDs remain usable for mail and assignment. Give limit and optional offset to page people, with totals and nextOffset; a filter without limit returns its matching compact rows. Give person for a concise current profile and held task references. Add history:{limit,offset?} with person for an explicit page of finished assignments/outcomes. Names selecting one person must be unique; use IDs for duplicates. Souls and full histories are absent from default responses. This is responsibility from assignments, not broad participation. Write to people with send_mail.";

function entry(member: Member, names: Map<string, string>) {
	return {
		id: member.id,
		name: member.name ?? member.id,
		title: member.title,
		role: member.role,
		manager: member.reportsTo,
		managerName: member.reportsTo ? (names.get(member.reportsTo) ?? member.reportsTo) : "Operator",
		team: `team:${member.reportsTo ?? member.id}`,
		status: member.status === "busy" ? "working" : member.status === "waiting" ? "asking the operator" : member.status,
		availability: member.tasks.length ? "assigned" : "available",
		focus: member.focus ? { id: member.focus.id, title: member.focus.title } : null,
		held: member.tasks.length,
		finished: member.record.length,
	};
}

function compactDirectory(organization: Organization) {
	const names = new Map(organization.members.map((member) => [member.id, member.name ?? member.id]));
	const members = organization.members
		.filter((member) => !member.retired)
		.map((member) => entry(member, names))
		.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	return { root: organization.root, members };
}

/** Compact shared projection; the pair uses the main person's identity. */
export function readDirectory(self: string) {
	return compactDirectory(organizationOf(self, true));
}

function selectPerson<T extends { id: string; name: string }>(members: T[], address: string): T {
	const text = address.trim();
	const byId = members.find((member) => member.id === text);
	if (byId) return byId;
	const matches = members.filter((member) => member.name.toLowerCase() === text.toLowerCase());
	if (matches.length > 1) throw new Error(`More than one person is named ${text}; use the session id.`);
	if (!matches.length) throw new Error(`Nobody in your organization is called ${text}.`);
	return matches[0];
}
function page<T>(rows: T[], limit: number, offset = 0) {
	if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(offset) || offset < 0)
		throw new Error("Pages require a positive safe-integer limit and a nonnegative safe-integer offset.");
	const items = rows.slice(offset, offset + limit);
	return {
		total: rows.length,
		offset,
		nextOffset: offset + items.length < rows.length ? offset + items.length : null,
		items,
	};
}
function tally(keys: (string | null)[]) {
	const counts = new Map<string | null, number>();
	for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
	return [...counts].map(([key, count]) => ({ key, count }));
}
function rosterLine(person: ReturnType<typeof entry>) {
	return `- ${person.name} (${person.id})${person.title ? `, ${person.title}` : ""}: ${person.status}, ${person.availability}; manager ${person.manager ?? "operator"} (${person.managerName}); ${person.held} held, ${person.finished} finished${person.focus ? `; focus ${person.focus.title} [${person.focus.id}]` : ""}`;
}
const response = <T>(lines: string[], details: T) => ({
	content: [{ type: "text" as const, text: lines.join("\n") }],
	details,
});

/** Native and pair tools share schema, selection, paging and compact result payloads. */
export function directoryView(
	self: string,
	options: DirectoryOptions = {},
): { content: { type: "text"; text: string }[]; details: unknown } {
	for (const value of [options.person, options.team, options.subtree, options.role, options.name]) {
		if (typeof value === "string" && !value.trim()) throw new Error("Directory selectors must contain text.");
	}
	const organization = organizationOf(self, true);
	const { root, members } = compactDirectory(organization);
	const filters = [options.team, options.subtree, options.role, options.status, options.name];
	if (options.history && !options.person) throw new Error("Request history with one person.");
	if (options.offset !== undefined && options.limit === undefined) throw new Error("Give limit with offset.");
	if (options.person) {
		if (filters.some((filter) => filter !== undefined) || options.limit !== undefined || options.offset !== undefined)
			throw new Error("Use person alone, optionally with a history page; people filters/pages are separate.");
		const person = selectPerson(members, options.person);
		const member = organization.members.find((candidate) => candidate.id === person.id)!;
		if (options.history) {
			const { items: record, ...paging } = page(member.record, options.history.limit, options.history.offset);
			return response(
				[
					`Finished assignments for ${person.name} (${person.id}): ${record.length} of ${paging.total}, offset ${paging.offset}; nextOffset ${paging.nextOffset ?? "none"}.`,
					...record.map(
						(task) =>
							`- ${task.title} [${task.id}], assignment ${task.assignment}, finished ${task.endedAt}: ${task.outcome ?? "no outcome"}`,
					),
				],
				{ kind: "history" as const, person: { id: person.id, name: person.name }, ...paging, record },
			);
		}
		const tasks = member.tasks.map(({ id, title, bundle, thread, assignedBy, assignedAt }) => ({
			id,
			title,
			bundle,
			thread,
			assignedBy,
			assignedAt,
		}));
		return response(
			[
				rosterLine(person),
				`Directory: ${member.cwd}`,
				...tasks.map((task) => `- ${task.title} [${task.id}]: ${task.bundle}/task.md, thread ${task.thread ?? "none"}`),
				"Request history:{limit,offset?} with this person for finished assignment outcomes.",
			],
			{ kind: "person" as const, ...person, directory: member.cwd, since: member.since, tasks },
		);
	}
	const filtered = filters.some((filter) => filter !== undefined) || options.limit !== undefined;
	if (!filtered) {
		const names = new Map(members.map((member) => [member.id, member.name]));
		const teams = tally(members.map((member) => member.manager)).map(({ key: manager, count }) => ({
			manager,
			managerName: manager ? (names.get(manager) ?? manager) : "Operator",
			count,
		}));
		const roles = tally(members.map((member) => member.role)).map(({ key: role, count }) => ({ role, count }));
		const status = tally(members.map((member) => member.status)).map(({ key: status, count }) => ({ status, count }));
		return response(
			[
				`Organization ${root}: ${members.length} people. Operator (operator) is the human.`,
				...teams.map(
					(team) => `- Manager ${team.managerName} (${team.manager ?? "operator"}): ${team.count} direct reports`,
				),
				`Roles: ${roles.map((row) => `${row.role ?? "unroled"} ${row.count}`).join(", ")}`,
				`Status: ${status.map((row) => `${row.status} ${row.count}`).join(", ")}`,
				"Filter by team/subtree (name or ID), role, status or name substring; or request limit/offset. Use person for a current profile and history:{limit,offset?} for finished assignments.",
			],
			{ kind: "overview" as const, root, total: members.length, teams, roles, status },
		);
	}
	const team = options.team ? selectPerson(members, options.team).id : undefined;
	const subtree = options.subtree ? selectPerson(members, options.subtree).id : undefined;
	const parents = new Map(organization.members.map((member) => [member.id, member.reportsTo]));
	const inside = (id: string) => {
		const seen = new Set<string>();
		for (let at: string | null = id; at && !seen.has(at); at = parents.get(at) ?? null) {
			if (at === subtree) return true;
			seen.add(at);
		}
		return false;
	};
	const matches = members.filter(
		(member) =>
			(!team || member.manager === team) &&
			(!subtree || inside(member.id)) &&
			(options.role === undefined || member.role === options.role) &&
			(options.status === undefined || member.status === options.status) &&
			(options.name === undefined || member.name.toLowerCase().includes(options.name.trim().toLowerCase())),
	);
	const { items, ...paging } =
		options.limit === undefined
			? { items: matches, total: matches.length, offset: 0, nextOffset: null }
			: page(matches, options.limit, options.offset);
	return response(
		[
			`People: ${items.length} of ${paging.total}, offset ${paging.offset}; nextOffset ${paging.nextOffset ?? "none"}.`,
			...items.map(rosterLine),
		],
		{ kind: "people" as const, root, ...paging, members: items },
	);
}

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
			description: directoryDescription,
			promptSnippet:
				"Discover your organization through compact counts, filtered people, current profiles and explicit history pages.",
			parameters: directoryParameters,
			async execute(_id, params, _signal, _update, ctx) {
				return directoryView(ctx.sessionManager.getSessionId(), params);
			},
		}),
	);
}
