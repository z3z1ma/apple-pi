import type { DatabaseSync } from "node:sqlite";
import { executionIn } from "./execution-inspection.js";
import { linkOwnership } from "./fitness.js";
import { waitComponents } from "./friction.js";
import { communicationIn, type Scope, taskTitleOf, type Window, waitsIn, workIn } from "./inspect.js";
import {
	type DetailPage,
	focusChanges,
	type InspectionContext,
	inspectionContext,
	intervalUnion,
	pageRows,
} from "./inspection-context.js";
import { type Link, WAITS } from "./links.js";
import { nameOf } from "./threads.js";
import type { WorkTask } from "./work.js";

const EVIDENCE_RELATIONS = ["produced", "verifies", "fixes", "finds", "supersedes"];

export function personContext(db: DatabaseSync, context: InspectionContext, id: string) {
	const current = context.history.memberAt(id, Date.now())
		? (db
				.prepare(`select s.run_state, s.updated_at, s.prompt, i.process_state from sessions s
			left join incarnations i on i.session_id = s.id and i.generation = s.generation where s.id = ?`)
				.get(id) as
				| { run_state: string; updated_at: number; prompt: string | null; process_state: string | null }
				| undefined)
		: undefined;
	const error = db
		.prepare(
			"select seq, at from events where session_id = ? and type = 'last_error_changed' and json_extract(data, '$.to') is not null order by seq desc limit 1",
		)
		.get(id) as { seq: number; at: number } | undefined;
	return {
		ref: `person:${id}`,
		name: nameOf(db, id),
		current: current
			? {
					runState: current.run_state,
					processState: current.process_state,
					promptOpen: current.prompt !== null,
					observedAt: current.updated_at,
					lastError: error ? { at: error.at, ref: `event:${error.seq}` } : null,
				}
			: null,
		currentCoverage: current
			? "Current observation, not historical execution or proof of available capacity."
			: "No current in-organization observation.",
	};
}

function evidenceByTask(db: DatabaseSync, organization: string, at: number) {
	const belongs = linkOwnership(db, organization);
	const links = db
		.prepare(
			`select * from links where created_at < ? and relation in (${EVIDENCE_RELATIONS.map(() => "?").join(",")}) order by created_at, id`,
		)
		.all(at, ...EVIDENCE_RELATIONS) as unknown as Link[];
	const result = new Map<string, ReturnType<typeof evidence>[]>();
	for (const link of links) {
		if (!belongs(link, at)) continue;
		for (const id of new Set([
			...(link.from_kind === "task" ? [link.from_id] : []),
			...(link.to_kind === "task" ? [link.to_id] : []),
		])) {
			const rows = result.get(id) ?? [];
			rows.push(evidence(link, at));
			result.set(id, rows);
		}
	}
	return result;
}

function evidence(link: Link, at: number) {
	return {
		ref: `link:${link.id}`,
		from: `${link.from_kind}:${link.from_id}`,
		to: `${link.to_kind}:${link.to_id}`,
		relation: link.relation,
		recordedBy: `person:${link.recorded_by}`,
		at: link.created_at,
		inferred: Boolean(link.inferred),
		confidence: link.confidence,
		resolution: link.resolved_at !== null && link.resolved_at <= at ? link.resolution : null,
	};
}

function taskWaits(db: DatabaseSync, context: InspectionContext) {
	const waits = db
		.prepare(
			`select * from links where from_kind = 'task' and relation in (${WAITS.map(() => "?").join(",")}) and created_at < ?`,
		)
		.all(...WAITS, context.to) as unknown as Link[];
	const result = new Map<string, Link[]>();
	for (const wait of waits) {
		const rows = result.get(wait.from_id) ?? [];
		rows.push(wait);
		result.set(wait.from_id, rows);
	}
	return result;
}

function waitDuration(task: WorkTask, context: InspectionContext, waits: Link[]) {
	if (context.from === undefined) return null;
	const spans = context.taskIntervals(task);
	return intervalUnion(
		spans.flatMap((span) =>
			waits.map((wait) => ({
				from: Math.max(span.from, wait.created_at),
				to: Math.min(span.to, wait.resolved_at ?? context.to),
			})),
		),
	);
}

/** Shared task evidence for delivery reports and explicitly associated conversations. */
export function taskEvidence(db: DatabaseSync, organization: string, context: InspectionContext) {
	const tasks = new Map(context.tasks.map((task) => [task.id, task]));
	const evidence = evidenceByTask(db, organization, context.to);
	const waits = taskWaits(db, context);
	return (ref: string, at = context.to) => {
		const task = tasks.get(ref.slice(5))!;
		return {
			ref,
			openedAt: task.opened_at!,
			elapsedMs: at - task.opened_at!,
			waitingMs: waitDuration(task, context, waits.get(task.id) ?? []),
			evidence: evidence.get(task.id) ?? [],
			outcomes: (context.byTask.get(task.id) ?? [])
				.filter(
					(assignment) =>
						assignment.end_reason === "finished" && assignment.ended_at !== null && assignment.ended_at <= context.to,
				)
				.map((assignment) => ({
					person: `person:${assignment.person}`,
					assignment: assignment.id,
					at: assignment.ended_at,
					outcome: assignment.outcome,
				})),
		};
	};
}

/** Delivery records and waiting exposure share the existing work classification and historical ownership. */
export function progressIn(
	db: DatabaseSync,
	organization: string,
	window: Window,
	scope: Scope = {},
	page: DetailPage = {},
) {
	const context = inspectionContext(db, organization, window, scope);
	const base = workIn(db, organization, { ...window, to: context.to }, scope);
	const tasks = new Map(context.tasks.map((task) => [task.id, task]));
	const changes = focusChanges(db, context);
	const describe = taskEvidence(db, organization, context);
	const open = (
		[
			["ready", base.ready],
			["waiting", base.waiting],
			["held", base.inProgress],
		] as const
	)
		.flatMap(([state, rows]) =>
			rows.map((row) => ({ ...describe(row.ref), state, holders: row.holders, waits: row.waits })),
		)
		.sort((a, b) => a.openedAt - b.openedAt || a.ref.localeCompare(b.ref));
	const closures = base.closed
		.map((row) => ({ ...describe(row.ref, row.at), closedAt: row.at, status: row.status }))
		.sort((a, b) => b.closedAt - a.closedAt || a.ref.localeCompare(b.ref));
	const completed = closures.filter((row) => row.status === "done");
	const elapsed = completed.map((row) => row.elapsedMs).sort((a, b) => a - b);
	const holders = new Map<string, string[]>();
	for (const row of open)
		for (const person of row.holders) {
			if (!context.people(person.slice(7), context.to)) continue;
			const held = holders.get(person) ?? [];
			held.push(row.ref);
			holders.set(person, held);
		}
	const people = [...holders]
		.map(([person, tasks]) => ({
			...personContext(db, context, person.slice(7)),
			tasks,
			focusChanges: changes.filter((change) => change.person === person),
		}))
		.sort((a, b) => b.tasks.length - a.tasks.length || a.ref.localeCompare(b.ref));
	const label = <T extends { ref: string }>(rows: T[]) => {
		const selected = pageRows(rows, page);
		return {
			...selected,
			rows: selected.rows.map((row) => ({ ...row, name: taskTitleOf(tasks.get(row.ref.slice(5))!.bundle) ?? row.ref })),
		};
	};
	const assignmentChanges = context.assignments
		.filter(
			(assignment) =>
				context.from !== undefined &&
				[assignment.assigned_at, assignment.ended_at].some(
					(at) =>
						at !== null && at >= context.from! && at < context.to && context.visible(assignment.task_id, at, true),
				),
		)
		.map((assignment) => ({
			assignment: assignment.id,
			person: `person:${assignment.person}`,
			task: `task:${assignment.task_id}`,
			assignedAt: assignment.assigned_at,
			endedAt: assignment.ended_at !== null && assignment.ended_at <= context.to ? assignment.ended_at : null,
			endReason: assignment.ended_at !== null && assignment.ended_at <= context.to ? assignment.end_reason : null,
		}));
	return {
		organization: `organization:${organization}`,
		scope,
		window: { from: context.from ?? null, to: context.to },
		execution: executionIn(db, context, page),
		summary: {
			opened: context.from === undefined ? null : base.opened.length,
			completed: context.from === undefined ? null : completed.length,
			cancelled: context.from === undefined ? null : closures.filter((row) => row.status === "cancelled").length,
			open: open.length,
			ready: base.ready.length,
			waiting: base.waiting.length,
			held: base.inProgress.length,
			completedWithResultRecords: completed.filter((row) =>
				row.evidence.some((link) => ["produced", "verifies"].includes(link.relation)),
			).length,
			completedElapsedMs: {
				count: elapsed.length,
				min: elapsed[0] ?? null,
				median: elapsed.length
					? (elapsed[Math.floor((elapsed.length - 1) / 2)] + elapsed[Math.floor(elapsed.length / 2)]) / 2
					: null,
				max: elapsed.at(-1) ?? null,
			},
			waitingTaskMs:
				context.from === undefined
					? null
					: context.tasks.reduce((total, task) => total + (describe(`task:${task.id}`).waitingMs ?? 0), 0),
			focusChanges: changes.length,
			multipleTaskHolders: people.filter((row) => row.tasks.length > 1).length,
		},
		open: label(open),
		closures: label(closures),
		arrivals: label(base.opened),
		assignmentChanges: pageRows(assignmentChanges, page),
		focusChanges: pageRows(changes, page),
		holders: pageRows(people, page),
		coverage: [
			"Registered tasks and explicit waits only; task elapsed time is not execution time.",
			"Waiting intervals are unioned per task and clipped to historical ownership/scope; task waiting totals are not wall-clock time.",
			"Outcomes and result/check links are attributed statements, not independently verified usefulness.",
			"Focus changes require retained atomic work-change/task-post pairs; erased internal work is unavailable.",
			"Current owner observations are labeled separately from the historical work snapshot.",
		],
	};
}

/** Traverse only declared wait edges, returning one witness path per distinct upstream reference. */
export function dependencyPaths(waits: { from: string; to: string; ref: string }[], target: string) {
	const incoming = new Map<string, typeof waits>();
	for (const wait of waits) {
		const rows = incoming.get(wait.to) ?? [];
		rows.push(wait);
		incoming.set(wait.to, rows);
	}
	const paths = new Map<string, string[]>([[target, []]]);
	const queue = [target];
	for (let next = 0; next < queue.length; next++) {
		const node = queue[next];
		for (const edge of incoming.get(node) ?? []) {
			if (paths.has(edge.from)) continue;
			paths.set(edge.from, [edge.ref, ...paths.get(node)!]);
			queue.push(edge.from);
		}
	}
	paths.delete(target);
	return [...paths].map(([ref, links]) => ({ ref, links }));
}

export function bottlenecksIn(
	db: DatabaseSync,
	organization: string,
	window: Window,
	scope: Scope = {},
	page: DetailPage = {},
) {
	const context = inspectionContext(db, organization, window, scope);
	const all = waitsIn(db, organization, { ...window, to: context.to });
	const selected = waitsIn(db, organization, { ...window, to: context.to }, scope);
	const edges = all.targets.flatMap((target) => target.waits);
	const raw = db.prepare("select * from links where created_at < ?").all(context.to) as unknown as Link[];
	const byId = new Map(raw.map((link) => [`link:${link.id}`, link]));
	const targets = selected.targets
		.map((target) => {
			const paths = dependencyPaths(edges, target.ref);
			const tasks = paths.filter(
				(path) => path.ref.startsWith("task:") && context.ownership.owns(path.ref.slice(5), context.to),
			);
			const directTasks = new Set(
				target.waits.filter((wait) => wait.from.startsWith("task:")).map((wait) => wait.from),
			);
			const waits = target.waits.map((wait) => {
				const source = byId.get(wait.ref)!;
				return {
					...wait,
					createdAt: source.created_at,
					inferred: Boolean(source.inferred),
					confidence: source.confidence,
					windowWaitMs:
						context.from === undefined ? null : Math.max(0, context.to - Math.max(context.from, source.created_at)),
				};
			});
			return {
				ref: target.ref,
				directTasks: directTasks.size,
				affectedTasks: tasks.length,
				paths: tasks,
				waits,
				oldestWaitAt: Math.min(...waits.map((wait) => wait.createdAt)),
				name: target.ref.startsWith("person:") ? nameOf(db, target.ref.slice(7)) : target.ref,
			};
		})
		.sort((a, b) => b.affectedTasks - a.affectedTasks || a.oldestWaitAt - b.oldestWaitAt || a.ref.localeCompare(b.ref));
	const relevant = new Set(targets.flatMap((target) => [target.ref, ...target.paths.map((path) => path.ref)]));
	const cycles = waitComponents(edges)
		.filter(
			(group) =>
				group.some((ref) => relevant.has(ref)) &&
				(group.length > 1 || edges.some((edge) => edge.from === group[0] && edge.to === group[0])),
		)
		.map((group) => ({
			references: group.sort(),
			links: edges
				.filter((edge) => group.includes(edge.from) && group.includes(edge.to))
				.map((edge) => edge.ref)
				.sort(),
		}));
	const work = workIn(db, organization, { ...window, to: context.to });
	const requests = communicationIn(
		db,
		organization,
		{ cwd: window.cwd, from: context.to, to: context.to },
		scope,
	).requests;
	const changes = focusChanges(db, context);
	const people = new Set(scope.task ? [] : requests.map((request) => request.person));
	for (const row of [...work.ready, ...work.waiting, ...work.inProgress])
		if (!scope.task || row.ref === `task:${scope.task}` || relevant.has(row.ref))
			for (const person of row.holders) people.add(person);
	for (const ref of relevant) if (ref.startsWith("person:")) people.add(ref);
	const demands = [...people]
		.filter((person) => context.people(person.slice(7), context.to))
		.map((person) => {
			const request = requests.find((request) => request.person === person);
			return {
				...personContext(db, context, person.slice(7)),
				tasks: [...work.waiting, ...work.inProgress]
					.filter((row) => row.holders.includes(person))
					.map((row) => row.ref),
				decisions: request?.decisions ?? [],
				escalations: request?.escalations ?? [],
				focusChanges: changes.filter((change) => change.person === person),
			};
		})
		.sort(
			(a, b) =>
				b.decisions.length - a.decisions.length || b.tasks.length - a.tasks.length || a.ref.localeCompare(b.ref),
		);
	return {
		organization: `organization:${organization}`,
		scope,
		window: { from: context.from ?? null, to: context.to },
		execution: executionIn(db, context, page),
		summary: {
			openWaits: selected.open,
			targets: targets.length,
			affectedTasks: new Set(targets.flatMap((row) => row.paths.map((path) => path.ref))).size,
			resolved: context.from === undefined ? null : selected.unblocked.length,
			peopleWithDemands: demands.length,
			cycles: cycles.length,
		},
		targets: pageRows(targets, page),
		cycles: pageRows(cycles, page),
		people: pageRows(demands, page),
		resolved: pageRows(selected.unblocked, page),
		coverage: [
			"Candidate constraints, not diagnoses. Paths contain declared wait links only; assignments/reporting are not dependency edges.",
			"Affected tasks overlap between targets; resolving one target may leave other waits open.",
			"Demand counts and focus changes do not establish overload, interruption cost or available capacity.",
		],
	};
}
