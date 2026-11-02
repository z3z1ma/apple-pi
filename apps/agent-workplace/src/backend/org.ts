import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { OrgMoveRequest, OrgMoveResult, OrgStartProgress, OrgStartRequest } from "../org.js";
import type { CommandResult, WorldSnapshot } from "../world.js";
import type { Commands } from "./commands.js";
import { operatorPane } from "./inn.js";
import { loadRoleChoices } from "./roles.js";

interface Person {
	id: string;
	reports_to: string | null;
	role: string | null;
	manages: number | null;
	retired_at: number | null;
	run_state: string;
	awake: number;
	started_at: number | null;
	ended_at: number | null;
}
interface RecordedCommand {
	command_id: string;
	session_id: string;
	command: string;
	stage: string;
	reason: string | null;
	created_at: number;
}
const ready = (person: OrgStartProgress["people"][number]) => person.state === "ready" || person.state === "active";
const bridgeLost = (person: Person | undefined) =>
	person && person.started_at !== null && person.ended_at === null && !person.awake;
const key = (value: string) => encodeURIComponent(value);
const READY_ROSTER = "\n\nReady teammates (session IDs):\n";
const preparePrefix = (plan: string, position: string) => `org-prepare:${key(plan)}:${key(position)}:`;
const blockedTasks = (reason: string) => {
	const prefix = "unfinished work would leave its organization: ";
	return reason.startsWith(prefix) ? reason.slice(prefix.length).split(", ") : undefined;
};

function peopleIn(db: DatabaseSync): Map<string, Person> {
	return new Map(
		(
			db
				.prepare(`select s.id, s.reports_to, s.role, s.manages, s.retired_at, s.run_state,
		coalesce(i.ended_at is null and i.process_state = 'alive', 0) as awake, i.started_at, i.ended_at
		from sessions s left join incarnations i on i.session_id = s.id and i.generation = s.generation
		where s.kind = 'root'
		and not exists (select 1 from program_peers p where p.session_id = s.id)
		and not exists (select 1 from events e where e.session_id = s.id and e.type in ('program_peer_created', 'program_peer_observed', 'person_discarded'))`)
				.all() as unknown as Person[]
		).map((person) => [person.id, person]),
	);
}
function branchOf(people: Map<string, Person>, head: string): string[] {
	const branch = new Set([head]);
	for (let size = -1; size !== branch.size; ) {
		size = branch.size;
		for (const person of people.values()) if (person.reports_to && branch.has(person.reports_to)) branch.add(person.id);
	}
	return [...branch].sort();
}
function rootOf(id: string, parents: Map<string, string | null>): string {
	const seen = new Set<string>();
	while (!seen.has(id)) {
		seen.add(id);
		const parent = parents.get(id);
		if (!parent || !parents.has(parent)) return id;
		id = parent;
	}
	return id;
}

/** Operator planning over the runtime's existing people, command receipts and thread authority. */
export function openOrg(paths: { db: string; agentDir: string }, commands: Commands, snapshot: () => WorldSnapshot) {
	const listeners = new Set<(progress: OrgStartProgress) => void>();
	const running = new Map<string, Promise<OrgStartProgress>>();
	const read = <T>(fn: (db: DatabaseSync) => T): T => {
		if (!existsSync(paths.db)) throw new Error("The session runtime database is not available.");
		const db = new DatabaseSync(paths.db);
		try {
			db.exec("pragma query_only = 1");
			return fn(db);
		} finally {
			db.close();
		}
	};
	const recorded = (id: string) =>
		read((db) => db.prepare("select * from commands where command_id = ?").get(id) as RecordedCommand | undefined);
	const preparations = (plan: string, position: string) => {
		const prefix = preparePrefix(plan, position);
		return read(
			(db) =>
				db
					.prepare("select * from commands where kind = 'start' and substr(command_id, 1, ?) = ? order by rowid")
					.all(prefix.length, prefix) as unknown as RecordedCommand[],
		);
	};
	const move = async (request: OrgMoveRequest, commandId?: string): Promise<OrgMoveResult> => {
		const { person, manager, branch } = request;
		const result = await commands.send(
			"operator",
			{ kind: "organization_move", person, manager, branch },
			{ commandId },
		);
		return result.ok ? { ok: true, person, manager, branch } : { ...result, tasks: blockedTasks(result.reason) };
	};

	async function start(request: OrgStartRequest): Promise<OrgStartProgress> {
		const teamGoal = request.goal?.trim() ?? "";
		const goalFor = (position: OrgStartRequest["positions"][number]) => position.goal?.trim() || teamGoal;
		const progress: OrgStartProgress = {
			id: request.id,
			people: request.positions.map((position) => ({ id: position.id, person: position.person, state: "pending" })),
			complete: false,
			editable: false,
			next: "working",
		};
		const publish = () => {
			const value = structuredClone(progress);
			for (const listener of listeners) listener(value);
			return value;
		};
		let untouched = false;
		const reject = (reason: string, tasks?: string[]) => {
			progress.editable = untouched;
			for (const person of progress.people)
				Object.assign(person, { state: "blocked", reason, ...(tasks ? { tasks } : {}) });
			progress.next = "retry";
			progress.note = reason;
			return publish();
		};
		function preflight() {
			if (!snapshot().connected) return reject("The session runtime is not connected.");
			const infrastructure = read((db) =>
				db.prepare("select 1 from threads where kind = 'channel' and id like 'organization:%' limit 1").get(),
			);
			if (!infrastructure)
				return reject(
					"The running session runtime lacks whole-team channels. Restart the session runtime with current code before starting a team; restarting can stop headless people.",
				);
			const directory =
				request.cwd === "~"
					? homedir()
					: request.cwd.startsWith("~/")
						? join(homedir(), request.cwd.slice(2))
						: request.cwd;
			if (!isAbsolute(directory) || !existsSync(directory) || !statSync(directory).isDirectory())
				return reject("Choose an existing absolute working directory.");
			const cwd = realpathSync(directory);
			if (!request.id.trim() || !request.positions.length) return reject("A team needs an identity and positions.");
			const positions = new Map(request.positions.map((position) => [position.id, position]));
			if (positions.size !== request.positions.length || request.positions.some((position) => !position.id))
				return reject("Each planned position needs a unique identity.");
			const heads = request.positions.filter((position) => position.manager === null);
			if (heads.length !== 1) return reject("A team needs exactly one head.");
			const roles = new Map(loadRoleChoices(paths.agentDir).map((role) => [role.name, role]));
			const people = read(peopleIn);
			const unavailable = read(
				(db) =>
					new Set([
						...(
							db
								.prepare(
									"select session_id from events where type in ('person_departed', 'program_peer_created', 'program_peer_observed', 'person_discarded')",
								)
								.all() as { session_id: string }[]
						).map((row) => row.session_id),
						...(db.prepare("select session_id from program_peers").all() as { session_id: string }[]).map(
							(row) => row.session_id,
						),
					]),
			);
			const identify = () => {
				for (const position of request.positions) {
					const attempts = preparations(request.id, position.id);
					const previous = attempts.at(-1);
					const original = attempts[0] && JSON.parse(attempts[0].command);
					if (
						original?.role &&
						(original.cwd !== cwd ||
							original.role !== position.role ||
							(original.specialization ?? "") !== (position.specialization?.trim() ?? "") ||
							(original.goal?.text ?? "") !== goalFor(position))
					)
						return reject(
							"A prepared person's role, specialization, working directory and goal cannot change on retry.",
						);
					if (position.person && previous && position.person !== previous.session_id)
						return reject("A retry changed a prepared person's identity.");
					const id = previous?.session_id ?? position.person ?? randomUUID();
					progress.people.find((person) => person.id === position.id)!.person = id;
					const existing = people.get(id);
					if (
						!existing &&
						position.specialization?.trim() &&
						!read((db) => db.prepare("select 1 from pragma_table_info('sessions') where name = 'specialization'").get())
					)
						return reject(
							"Restart the session runtime with current code before creating a person with specialization.",
						);
					if (unavailable.has(id) || existing?.retired_at != null)
						return reject("Temporary or departed people cannot join a planned team.");
					if (!existing && (!position.role || !roles.has(position.role)))
						return reject("Each new person needs a catalog role.");
				}
			};
			const identityError = identify();
			if (identityError) return identityError;
			const identity = (id: string) => progress.people.find((person) => person.id === id)?.person ?? id;
			const head = heads[0]!;
			const headId = identity(head.id);
			const validateTree = () => {
				const canManage = (id: string) => {
					const position = positions.get(id);
					const existing = people.get(identity(id));
					if (!existing) return !!roles.get(position?.role ?? "")?.manages;
					if (existing.retired_at !== null || unavailable.has(existing.id)) return false;
					if (existing.manages === null && existing.started_at === null && preparations(request.id, id).length)
						return !!roles.get(existing.role ?? "")?.manages;
					return existing.manages === 1 || (existing.role === null && existing.reports_to === null);
				};
				if (!canManage(head.id)) return reject("The team head needs a managing role.");
				const parents = new Map([...people.values()].map((person) => [person.id, person.reports_to]));
				for (const position of request.positions) {
					if (position.manager !== null && !canManage(position.manager))
						return reject("Each manager must exist and be able to manage.");
					parents.set(identity(position.id), position.manager === null ? null : identity(position.manager));
				}
				if (new Set(progress.people.map((person) => person.person)).size !== progress.people.length)
					return reject("A person can fill only one position.");
				for (const position of request.positions) {
					const seen = new Set<string>();
					let id: string | null = identity(position.id);
					while (id !== null && parents.has(id)) {
						if (seen.has(id)) return reject("The planned reporting lines contain a cycle.");
						seen.add(id);
						id = parents.get(id) ?? null;
					}
					if (rootOf(identity(position.id), parents) !== headId)
						return reject("Every position must belong to the planned head's tree.");
				}
				const before = new Map([...people.values()].map((person) => [person.id, person.reports_to]));
				const stranded = read((db) =>
					(
						db
							.prepare(
								`select a.person, a.task_id, t.organization from assignments a join work_tasks t on t.id = a.task_id where a.ended_at is null`,
							)
							.all() as { person: string; task_id: string; organization: string }[]
					)
						.filter(
							(assignment) =>
								rootOf(assignment.person, before) === rootOf(assignment.organization, before) &&
								rootOf(assignment.person, parents) !== rootOf(assignment.organization, parents),
						)
						.map((assignment) => assignment.task_id),
				);
				if (stranded.length)
					return reject("Unfinished work needs an explicit handoff before starting this team.", [...new Set(stranded)]);
			};
			const treeError = validateTree();
			if (treeError) return treeError;
			const ordered = [...request.positions].sort((a, b) => {
				const depth = (id: string): number => {
					let count = 0;
					let parent = positions.get(id)?.manager;
					while (parent && positions.has(parent)) {
						count++;
						parent = positions.get(parent)?.manager;
					}
					return count;
				};
				return depth(a.id) - depth(b.id);
			});
			return { cwd, ordered, head, headId, positions };
		}
		try {
			untouched = read((db) => {
				const prefixes = [
					`org-prepare:${key(request.id)}:`,
					`org-move:${key(request.id)}:`,
					`org-readiness:${key(request.id)}:`,
				];
				return !db
					.prepare(`select 1 from commands where command_id in (?, ?) or exists
					(select 1 from json_each(?) p where substr(command_id, 1, length(p.value)) = p.value) limit 1`)
					.get(`org-join:${request.id}`, `org-kickoff:${request.id}`, JSON.stringify(prefixes));
			});
			const plan = preflight();
			if ("people" in plan) return plan;
			const { cwd, ordered, head, headId, positions } = plan;
			const channel = `organization:${headId}`;
			const identity = (id: string) => progress.people.find((person) => person.id === id)?.person ?? id;
			const hire = (position: OrgStartRequest["positions"][number]) => ({
				name: position.name?.trim() || undefined,
				role: position.role,
				...(position.specialization?.trim() ? { specialization: position.specialization.trim() } : {}),
				...(goalFor(position) ? { goal: { by: "operator", text: goalFor(position) } } : {}),
			});
			const startUnresolved = (
				member: OrgStartProgress["people"][number],
				commandId: string,
				result: CommandResult,
			) => {
				const record = recorded(commandId);
				Object.assign(member, {
					state: record?.stage === "failed" ? "failed" : "uncertain",
					reason: result.ok ? "The start was applied but no connected incarnation is visible." : result.reason,
					...(record?.stage === "failed" ? { atHome: true } : {}),
				});
			};
			const openingPrompt = (
				position: OrgStartRequest["positions"][number],
				existing: Person | undefined,
				attempts: RecordedCommand[],
			) => {
				const assignedGoal = existing ? attempts[0] && JSON.parse(attempts[0].command).goal?.text : goalFor(position);
				return teamGoal || !assignedGoal ? { prompt: "" } : {};
			};
			const prepare = async (position: OrgStartRequest["positions"][number]) => {
				const member = progress.people.find((person) => person.id === position.id)!;
				const manager = position.manager === null ? null : identity(position.manager);
				const parent = progress.people.find((person) => person.person === manager);
				if (parent && !ready(parent)) {
					Object.assign(member, { state: "blocked", reason: "Its planned manager is not ready." });
					publish();
					return;
				}
				member.state = "preparing";
				publish();
				const people = read(peopleIn);
				let existing = people.get(member.person!);
				if (existing && existing.reports_to !== manager) {
					const moved = await move(
						{ person: existing.id, manager, branch: branchOf(people, existing.id) },
						`org-move:${key(request.id)}:${key(position.id)}:${randomUUID()}`,
					);
					if (!moved.ok) {
						Object.assign(member, { state: "blocked", reason: moved.reason, tasks: moved.tasks });
						publish();
						return;
					}
				}
				if (bridgeLost(existing)) {
					Object.assign(member, {
						state: "uncertain",
						reason: "Its current process has lost its bridge; reconcile it before another start.",
						atHome: false,
					});
					publish();
					return;
				}
				if (!existing?.awake) {
					const attempts = preparations(request.id, position.id);
					const previous = attempts.at(-1);
					const stopped = previous?.stage === "applied" && existing && existing.ended_at !== null;
					if (previous && previous.stage !== "failed" && !stopped) {
						Object.assign(member, {
							state: "uncertain",
							reason: "A previous start has not reconciled with a connected incarnation. Inspect it before retrying.",
						});
						publish();
						return;
					}
					const pane = await operatorPane(paths.db);
					const commandId = `${preparePrefix(request.id, position.id)}${attempts.length + 1}`;
					const result = await commands.send(
						member.person!,
						{
							kind: "start",
							cwd,
							...(pane ? { tmux: pane } : {}),
							...openingPrompt(position, existing, attempts),
							...(manager ? { reportsTo: manager } : {}),
							...(!existing ? hire(position) : {}),
						},
						{ commandId },
					);
					existing = read(peopleIn).get(member.person!);
					if (!existing?.awake) {
						startUnresolved(member, commandId, result);
						publish();
						return;
					}
				}
				Object.assign(member, { state: existing.run_state === "idle" ? "ready" : "active", atHome: false });
				publish();
			};
			const notifyReady = async (kickoff: RecordedCommand) => {
				const body = JSON.parse(kickoff.command).body as string;
				const boundary = body.lastIndexOf(READY_ROSTER);
				if (boundary < 0)
					throw new Error("The recorded kickoff has no ready-teammate roster; inspect it before retrying.");
				const roster: unknown = JSON.parse(body.slice(boundary + READY_ROSTER.length));
				if (!Array.isArray(roster) || roster.some((id) => typeof id !== "string"))
					throw new Error("The recorded kickoff has an invalid ready-teammate roster.");
				const initiallyReady = new Set<string>(roster);
				const prefix = `org-readiness:${key(request.id)}:`;
				const notices = read(
					(db) =>
						db
							.prepare(
								"select * from commands where kind in ('thread_post', 'communication') and substr(command_id, 1, ?) = ? and stage != 'failed'",
							)
							.all(prefix.length, prefix) as unknown as RecordedCommand[],
				);
				const pending = notices.find((notice) => notice.stage !== "applied");
				if (pending) {
					progress.readiness = { thread: channel, commandId: pending.command_id };
					progress.note = "A readiness update is awaiting its recorded receipt; retry after it reconciles.";
				}
				const notified = new Set(
					notices.flatMap((notice) => notice.command_id.slice(prefix.length).split("|").map(decodeURIComponent)),
				);
				const current = read(peopleIn);
				const late = progress.people.filter(
					(person) => ready(person) && !notified.has(person.person!) && !initiallyReady.has(person.person!),
				);
				if (late.length) {
					const counts = new Map<string, number>();
					for (const person of late) {
						const role = positions.get(person.id)?.role ?? current.get(person.person!)?.role ?? "teammate";
						counts.set(role, (counts.get(role) ?? 0) + 1);
					}
					const commandId = `${prefix}${late
						.map((person) => key(person.person!))
						.sort()
						.join("|")}`;
					const result = await commands.send(
						"operator",
						{
							kind: "communication",
							version: 1,
							input: {
								tool: "workplace.orgReadiness",
								arguments: { plan: request.id, people: late.map((person) => person.person!).sort() },
							},
							operation: {
								action: "post",
								thread: channel,
								notify: [headId],
								body: `Team readiness update: ${late.length} additional teammates are ready (${[...counts].map(([role, count]) => `${count} ${role}`).join(", ")}).`,
							},
						},
						{ commandId },
					);
					if (result.ok) progress.readiness = { thread: channel, commandId };
					else progress.note = result.reason;
				}
			};
			const finish = async () => {
				progress.channel = channel;
				if (ready(progress.people.find((person) => person.id === head.id)!)) {
					const joined = await commands.send(
						"operator",
						{ kind: "channel_membership", thread: channel, joined: true },
						{ commandId: `org-join:${request.id}` },
					);
					if (!joined.ok) {
						progress.note = joined.reason;
						progress.next = "retry";
						return;
					}
				}
				const allReady = progress.people.every(ready);
				const headReady = ready(progress.people.find((person) => person.id === head.id)!);
				const kickoffId = `org-kickoff:${request.id}`;
				let kickoff = recorded(kickoffId);
				if (!teamGoal && !kickoff) {
					progress.complete = allReady;
					progress.next = allReady ? "done" : "retry";
					if (allReady) progress.note = "Team ready.";
					return;
				}
				if (!kickoff && headReady && (allReady || request.withReady)) {
					const result = await commands.send(
						"operator",
						{
							kind: "thread_post",
							thread: kickoffId,
							subject: "Team kickoff",
							to: [headId],
							body: `${teamGoal}${READY_ROSTER}${JSON.stringify(progress.people.filter(ready).map((person) => person.person))}`,
						},
						{ commandId: kickoffId },
					);
					kickoff = recorded(kickoffId);
					if (!result.ok) progress.note = result.reason;
				}
				if (kickoff) {
					progress.kickoff = { thread: kickoffId, commandId: kickoffId };
					if (kickoff.stage === "applied") {
						await notifyReady(kickoff);
					} else
						progress.note ??=
							kickoff.reason ?? "The kickoff has not been confirmed; inspect its recorded receipt before retrying.";
				}
				progress.complete = allReady && kickoff?.stage === "applied" && !progress.note;
				progress.next = progress.complete ? "done" : headReady && !kickoff ? "choose-ready" : "retry";
			};
			publish();
			for (const position of ordered) await prepare(position);
			await finish();
			return publish();
		} catch (error) {
			progress.note = error instanceof Error ? error.message : String(error);
			for (const person of progress.people)
				if (person.state === "preparing") Object.assign(person, { state: "uncertain", reason: progress.note });
			progress.next = "retry";
			return publish();
		}
	}
	return {
		orgMove: (request: OrgMoveRequest) => move(request),
		orgStart(request: OrgStartRequest): Promise<OrgStartProgress> {
			const active = running.get(request.id);
			if (active) return active;
			const result = start(request).finally(() => running.delete(request.id));
			running.set(request.id, result);
			return result;
		},
		onOrgStart(listener: (progress: OrgStartProgress) => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}
