import { randomUUID } from "node:crypto";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { organizationOf } from "../../organization/src/directory.js";
import { managesPeople } from "../../organization/src/install.js";
import { resolvePerson } from "./addresses.js";
import { sendCommand } from "./client.js";
import { coordinationIn } from "./coordination-inspection.js";
import { membership, realizedFitness, taskOwnership } from "./fitness.js";
import { areasOf, communicationIn, expertsOn, type Scope, type Window, waitsIn, workIn } from "./inspect.js";
import { ENTITY_KINDS, type Entity, type Link, relations } from "./links.js";
import type { Command } from "./protocol.js";
import { compareScenarios, predictions, type Scenario, scenarioSchema } from "./scenarios.js";
import { goalText, rootOf, taskIdOf, type WorkAction, type WorkTask, withWork } from "./work.js";
import { bottlenecksIn, progressIn } from "./work-inspection.js";

const PERSON_TASK_TOOLS = ["take_task", "focus", "finish_task", "promote_task", "link"];
const INSIGHT_TOOLS = ["economics", "predictions", "experience", "bottlenecks", "progress", "coordination"];
const UNITS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };

/** A time as a span back from now (`30m`, `8h`, `7d`) or a date. */
function pointInTime(text: string, now: number): number {
	const span = text.trim().match(/^(\d+(?:\.\d+)?)\s*([mhd])$/);
	if (span) return now - Number(span[1]) * UNITS[span[2]];
	const date = Date.parse(text);
	if (Number.isNaN(date)) throw new Error(`Give a time as 30m, 8h, 7d, or a date (got "${text}")`);
	return date;
}
export const TASK_GOAL_CUSTOM_TYPE = "apple-pi.task-goal";
const taskParameter = Type.String({ minLength: 1, description: "Task id or path to its bundle or task.md." });
export const goalTitle = Type.String({
	minLength: 1,
	description: "A short title for the goal, a few words, as it shows in lists. Required with goal.",
});
/** What a new goal is worth, written into its task.md as the writer's estimate. */
export const goalWorth = {
	value: Type.Optional(
		Type.Number({
			minimum: 0,
			description:
				"With a goal: what the finished work is worth, in dollars, as your estimate. Splitting work never adds value; give each part its share.",
		}),
	),
	cost_of_delay: Type.Optional(
		Type.Number({
			minimum: 0,
			description: "With a goal: dollars the work loses for each hour it stays unfinished.",
		}),
	),
};
const goalOrTask = {
	goal: Type.Optional(
		Type.String({ minLength: 1, description: "A written goal for a new ephemeral task. Give goal or task, not both." }),
	),
	title: Type.Optional(goalTitle),
	task: Type.Optional(taskParameter),
	...goalWorth,
};

/** A goal needs its own short title: the goal's text is too long to name the task wherever it is listed. */
export function requireTitle(goal: string | undefined, title: string | undefined): void {
	if (goal && !title?.trim()) throw new Error("Give a short title with the goal.");
}

async function change(ctx: ExtensionContext, command: WorkAction, signal: AbortSignal | undefined) {
	if (!ctx.isProjectTrusted()) throw new Error("Task changes require a trusted project");
	if (command.action === "take" || command.action === "assign") requireTitle(command.goal, command.title);
	if (withWork(() => true) === undefined)
		throw new Error("The runtime predates assignments; restart it before using task tools.");
	const commandId = randomUUID();
	const receipt = await sendCommand(
		ctx.sessionManager.getSessionId(),
		{ ...command, kind: "work", cwd: ctx.cwd },
		{ commandId, signal },
	);
	if (receipt.stage === "failed") throw new Error(receipt.reason);
	const task = withWork(
		(db) =>
			db
				.prepare("select t.* from work_tasks t join work_changes c on c.task_id = t.id where c.command_id = ?")
				.get(commandId) as unknown as WorkTask,
	);
	if (!task) throw new Error("The runtime returned no task for this change");
	const person = "person" in command && command.person ? command.person : ctx.sessionManager.getSessionId();
	const goal = person === ctx.sessionManager.getSessionId() ? goalText(person) : undefined;
	return {
		content: [
			{
				type: "text" as const,
				text: `${command.action}: ${task.id}\nGoal: ${task.bundle}/task.md\nThread: ${task.thread}${goal ? `\n\n${goal}` : ""}`,
			},
		],
		details: task,
	};
}

function entity(ctx: ExtensionContext, ref: string): Entity {
	const split = ref.indexOf(":");
	const kind = ref.slice(0, split);
	const id = ref.slice(split + 1).trim();
	if (split < 1 || !id) throw new Error(`Name a thing as kind:id, such as task:work-1 or person:Ada (got "${ref}")`);
	if (kind === "person") return { kind, id: resolvePerson(ctx.sessionManager.getSessionId(), id) };
	if (kind === "task") {
		const task = withWork((db) => taskIdOf(db, ctx.cwd, id));
		if (!task) throw new Error("The runtime has no tasks yet");
		return { kind, id: task };
	}
	return { kind, id };
}

async function changeLink(
	ctx: ExtensionContext,
	args: {
		id?: string;
		resolution?: string;
		from?: string;
		to?: string;
		relation?: string;
		reason?: string;
		data?: unknown;
		inferred?: boolean;
		confidence?: number;
	},
	signal: AbortSignal | undefined,
) {
	const hasLinks = () =>
		withWork((db) => Boolean(db.prepare("select 1 from sqlite_master where name = 'links' and type = 'table'").get()));
	if (!hasLinks()) throw new Error("The runtime predates links; restart it before recording one.");
	const commandId = randomUUID();
	const command: Command = args.id
		? { kind: "link_resolve", id: args.id, ...(args.resolution ? { resolution: args.resolution } : {}) }
		: {
				kind: "link_record",
				from: entity(ctx, args.from ?? ""),
				to: entity(ctx, args.to ?? ""),
				relation: args.relation ?? "",
				reason: args.reason,
				data: args.data,
				inferred: args.inferred,
				confidence: args.confidence,
			};
	const receipt = await sendCommand(ctx.sessionManager.getSessionId(), command, { commandId, signal });
	if (receipt.stage === "failed") throw new Error(receipt.reason);
	const link = withWork((db) => db.prepare("select * from links where id = ?").get(args.id ?? commandId)) as
		| Link
		| undefined;
	if (!link) throw new Error("The runtime returned no link");
	const verb = link.resolved_at === null ? "Recorded" : "Resolved";
	return {
		content: [
			{
				type: "text" as const,
				text: `${verb} link ${link.id}: ${link.from_kind}:${link.from_id} ${link.relation} ${link.to_kind}:${link.to_id}`,
			},
		],
		details: link,
	};
}

function readExpertise(
	ctx: ExtensionContext,
	args: { area?: string; person?: string; since?: string; until?: string; subtree?: string },
) {
	if (Boolean(args.area) === Boolean(args.person)) throw new Error("Give exactly one of area or person");
	const now = Date.now();
	const self = ctx.sessionManager.getSessionId();
	const window = inspectionWindow(ctx, args);
	const subtree = args.subtree ? scopeOf(ctx, { subtree: args.subtree }, window).subtree : undefined;
	const observed = { ...window, subtree };
	const when = (at: number) => new Date(at).toISOString();
	const found = withWork((db) => {
		const organization = rootOf(db, self);
		if (args.person) {
			const person = scopeOf(ctx, { person: args.person }, window).person!;
			const areas = areasOf(db, organization, person, observed);
			return {
				details: { person: `person:${person}`, areas },
				lines: [
					`Areas where person:${person} made read or edit calls, most touched first:`,
					...areas.map((a) => `- ${a.ref}: ${a.reads} reads, ${a.edits} edits, last ${when(a.lastTouch)}`),
				],
			};
		}
		const people = expertsOn(db, organization, args.area!, observed);
		return {
			details: { area: args.area, people },
			lines: [
				`People who made read or edit calls in ${args.area}, most touched first:`,
				...people.map(
					(p) =>
						`- ${p.ref} (${p.status}${p.compactionSince ? ", a compaction started since" : ""}): ${p.reads} reads, ${p.edits} edits, last ${when(p.lastTouch)}${p.tasks.length ? `; tasks ${p.tasks.map((t) => `${t.ref}${t.title ? ` "${t.title}"` : ""}${t.finished ? ` (finished: ${t.outcome?.split("\n")[0] ?? ""})` : ""}`).join(", ")}` : ""}`,
				),
			],
		};
	});
	if (!found) throw new Error("The runtime has no records yet");
	const coverage = [
		"Read/edit calls show exposure, including failed calls, rather than demonstrated skill or useful output.",
		"Touch membership and assignment outcomes use the selected cutoff. Availability is current, not historical capacity.",
		"Paths use retained session directories and 120-character previews; changed historical directories and erased private indexes are unavailable.",
	];
	return {
		content: [{ type: "text" as const, text: [...found.lines, ...coverage].join("\n") }],
		details: { ...found.details, window: observed, currentAvailabilityAt: now, coverage },
	};
}

/** One optional scope for an inspection: a person's subtree, a person, or a task. */
function scopeOf(
	ctx: ExtensionContext,
	args: { subtree?: string; person?: string; task?: string },
	window: Window,
): Scope {
	if ([args.subtree, args.person, args.task].filter(Boolean).length > 1)
		throw new Error("Give at most one of subtree, person, or task");
	if (!args.subtree && !args.person && !args.task) return {};
	const self = ctx.sessionManager.getSessionId();
	const found = withWork((db) => {
		const organization = rootOf(db, self);
		const to = window.to ?? Date.now();
		const from = window.from ?? to;
		const times = [
			from,
			to,
			...(
				db
					.prepare(
						"select distinct at from events where type in ('reports_to_changed', 'transferred', 'retired', 'rehired', 'person_departed') and at >= ? and at <= ?",
					)
					.all(from, to) as { at: number }[]
			).map((row) => row.at),
		];
		if (args.task) {
			const task = taskIdOf(db, ctx.cwd, args.task.replace(/^task:/, ""));
			const ownership = taskOwnership(db, organization);
			if (!times.some((at) => ownership.owns(task, at)))
				throw new Error(`${args.task} is not a task of your organization in this window`);
			return { task };
		}
		const raw = (args.person ?? args.subtree)!.replace(/^person:/, "");
		const known = db
			.prepare("select 1 from sessions where id = ? union all select 1 from events where session_id = ? limit 1")
			.get(raw, raw);
		const person = known ? raw : resolvePerson(self, raw);
		const history = membership(db, organization);
		if (!times.some((at) => history.memberAt(person, at)))
			throw new Error(`${raw} is not in your organization in this window`);
		return args.person ? { person } : { subtree: person };
	});
	if (!found) throw new Error("The runtime has no records yet");
	return found;
}

interface InspectionArguments {
	since?: string;
	until?: string;
	subtree?: string;
	person?: string;
	task?: string;
	thread?: string;
	limit?: number;
	offset?: number;
}

const inspectionParameters = {
	since: Type.Optional(
		Type.String({ minLength: 1, description: "Period start: 30m, 8h, 7d, or a date. Omit for a cutoff snapshot." }),
	),
	until: Type.Optional(
		Type.String({ minLength: 1, description: "Cutoff time, now by default. Every table uses this same cutoff." }),
	),
	subtree: Type.Optional(
		Type.String({
			minLength: 1,
			description: "One person's historical reporting subtree; alternative to person or task.",
		}),
	),
	person: Type.Optional(
		Type.String({
			minLength: 1,
			description: "One person, by name or known ID. Historical former-member IDs retain their recorded scope.",
		}),
	),
	task: Type.Optional(taskParameter),
	limit: Type.Optional(
		Type.Integer({
			minimum: 1,
			description: "Rows per named detail table. Omit for the aggregate overview and coverage.",
		}),
	),
	offset: Type.Optional(
		Type.Integer({
			minimum: 0,
			description:
				"Row offset in each detail table; requires limit. Paging observes current retained history, not an immutable replay.",
		}),
	),
};

function inspectionWindow(ctx: ExtensionContext, args: { since?: string; until?: string }) {
	const now = Date.now();
	const from = args.since ? pointInTime(args.since, now) : undefined;
	const to = args.until ? pointInTime(args.until, now) : now;
	if (!Number.isFinite(to) || to > now || (from !== undefined && (!Number.isFinite(from) || from >= to)))
		throw new Error("Choose a past window whose start precedes its end");
	return { cwd: ctx.cwd, from, to };
}

function inspectionResult<T extends object>(result: T) {
	return {
		content: [
			{
				type: "text" as const,
				text: Object.entries(result)
					.map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
					.join("\n"),
			},
		],
		details: result,
	};
}

function readInspection(
	ctx: ExtensionContext,
	args: InspectionArguments,
	reader: typeof progressIn | typeof bottlenecksIn | typeof coordinationIn,
) {
	const window = inspectionWindow(ctx, args);
	if (args.thread && (args.person || args.subtree || args.task))
		throw new Error("Choose thread or one of person, subtree and task");
	const scope = {
		...scopeOf(ctx, args, window),
		...(args.thread ? { thread: args.thread.replace(/^thread:/, "") } : {}),
	};
	const result = withWork((db) => reader(db, rootOf(db, ctx.sessionManager.getSessionId()), window, scope, args));
	if (!result) throw new Error("The runtime has no records yet");
	return inspectionResult(result);
}

function readFitness(
	ctx: ExtensionContext,
	args: { since?: string; until?: string; subtree?: string; scenarios?: Scenario[] },
) {
	const now = Date.now();
	if (args.scenarios !== undefined) {
		if (args.since !== undefined || args.until !== undefined || args.subtree !== undefined)
			throw new Error("Choose exactly one mode: scenarios or a realized window");
		const comparison = compareScenarios(args.scenarios, now);
		return {
			content: [
				{
					type: "text" as const,
					text: [
						comparison.premise,
						...comparison.scenarios.flatMap((scenario) => [
							`${scenario.name}: expected $${scenario.expected.toFixed(2)}; decision ${scenario.decisionAt}, horizon ${scenario.horizonMs}ms; assumes ${scenario.organization}`,
							...scenario.outcomes.map(
								(outcome) => `- probability ${outcome.probability}: U $${outcome.total.toFixed(2)}`,
							),
						]),
					].join("\n"),
				},
			],
			details: comparison,
		};
	}
	if (args.since === undefined)
		throw new Error("Choose exactly one mode: give since for a realized window, or scenarios");
	const from = pointInTime(args.since, now);
	const to = args.until ? pointInTime(args.until, now) : now;
	if (!(from < to)) throw new Error("The window must start before it ends");
	if (to > now) throw new Error("Realized fitness covers the past; end the window now or earlier");
	const self = ctx.sessionManager.getSessionId();
	const subtree = args.subtree ? resolvePerson(self, args.subtree) : undefined;
	const fitness = withWork((db) => realizedFitness(db, rootOf(db, self), from, to, { subtree }));
	if (!fitness) throw new Error("The runtime has no tasks yet");
	const dollars = (n: number) => `$${n.toFixed(2)}`;
	const lines = [
		`Realized fitness ${dollars(fitness.total)} (${dollars(fitness.perHour)} per hour) from ${new Date(from).toISOString()} to ${new Date(to).toISOString()}${fitness.incomplete ? "; incomplete: some work has no value" : ""}.`,
		`Value earned ${dollars(fitness.value)}, delay ${dollars(fitness.delay)}, compute ${dollars(fitness.compute)}, impacts ${dollars(fitness.impact)}.`,
		`Tasks in the window: ${fitness.coverage.tasks}, unvalued ${fitness.coverage.unvalued}; ${Math.round(fitness.coverage.estimatedValueShare * 100)}% of value is agents' estimates.`,
		`Delay by state: queued ${dollars(fitness.delayByState.queued)} (needs people), waiting ${dollars(fitness.delayByState.waiting)} (needs a decision or another task), in progress ${dollars(fitness.delayByState.inProgress)}.`,
		`Not counted yet: ${fitness.excludes}.`,
		`Interruptions of the operator: ${fitness.interruptions}; the operator's time is priced at $${fitness.attention.pricePerMinute}/minute but not measured, so it is not in the total.`,
		...fitness.openWaits.map(
			(w) =>
				`- open wait ${w.id}: ${w.from_kind}:${w.from_id} ${w.relation} ${w.to_kind}:${w.to_id}, ${w.ageHours.toFixed(1)}h${w.reason ? ` (${w.reason})` : ""}`,
		),
		`Spend on dropped work: ${fitness.droppedWork.classification}. Compute attribution is an ${fitness.droppedWork.computeAttribution}. Temporary-peer spend uses the accounting caller's focus, not a separate task the emitter focused on.`,
		...fitness.droppedWork.tasks.map(
			(task) =>
				`- ${task.task}: compute ${dollars(task.compute)}, delay ${dollars(task.delay)}${task.cancelled ? "; cancelled" : ""}${task.supersededBy.length ? `; replaced via ${task.supersededBy.join(", ")}` : ""}`,
		),
		`Unattributed compute (unknown, absent or ineligible focus): ${dollars(fitness.droppedWork.unattributedCompute)}.`,
		"Recorded impacts (assertions, not verified; estimates are not charged):",
		...fitness.impacts.map(
			(impact) =>
				`- ${impact.link}: ${impact.kind} ${dollars(impact.dollars)} at ${new Date(impact.at).toISOString()}, recorded by ${impact.recordedBy}; ${impact.from} -> ${impact.to}`,
		),
		"Findings created in this window, with resolution at cutoff (evidence, not value):",
		"Findings by task:",
		...fitness.findings.byTask.flatMap((group) => [
			`- ${group.task}:`,
			...group.findings.map(
				(finding) => `  - ${finding.link}: ${finding.resolution ?? "unresolved"}, recorded by ${finding.person}`,
			),
		]),
		"Findings by person (recorder):",
		...fitness.findings.byPerson.flatMap((group) => [
			`- ${group.person}:`,
			...group.findings.map(
				(finding) => `  - ${finding.link}: ${finding.resolution ?? "unresolved"}, on ${finding.task}`,
			),
		]),
		...fitness.contributions.map(
			(c) =>
				`- ${c.source}: value ${dollars(c.value)}, delay ${dollars(c.delay)}, compute ${dollars(c.compute)}, impact ${dollars(c.impact)}`,
		),
	];
	return { content: [{ type: "text" as const, text: lines.join("\n") }], details: fitness };
}

const ORG_HELP = `/org — open waits, ready unowned work, multiple-task holders and pending requests
/org economics <since> — recorded dollar breakdown (for example 8h or a date)
/org experience <area or person> — read/edit experience; exact organization names/IDs take precedence
Use person:<name-or-id> to name a person explicitly; use ./<path> or an absolute path for a colliding area.`;

function organizationOverview(ctx: ExtensionContext): string {
	const at = Date.now();
	const self = ctx.sessionManager.getSessionId();
	const snapshot = withWork((db) => {
		const root = rootOf(db, self);
		const window = { cwd: ctx.cwd, to: at };
		return {
			root,
			waits: waitsIn(db, root, window),
			work: workIn(db, root, window),
			requests: communicationIn(db, root, { ...window, from: at }).requests,
		};
	});
	if (!snapshot) throw new Error("The runtime has no records yet");
	const { root, waits, work, requests } = snapshot;
	return [
		`Organization ${root} at ${new Date(at).toISOString()}`,
		`Open waits: ${waits.open}, on ${waits.targets.length} targets.`,
		...waits.targets.map(
			(target) => `- ${target.ref}: ${target.waits.length} waits; ${target.waits.map((wait) => wait.ref).join(", ")}`,
		),
		`Ready unowned work: ${work.ready.length}`,
		...work.ready.map((task) => `- ${task.ref}`),
		`Multiple-task holders: ${work.multiple.length}`,
		...work.multiple.map((holder) => `- ${holder.person}: ${holder.tasks.join(", ")}`),
		`Pending decisions: ${requests.reduce((n, request) => n + request.decisions.length, 0)}; escalations: ${requests.reduce((n, request) => n + request.escalations.length, 0)}`,
		...requests.map((request) => `- ${request.person}: ${[...request.decisions, ...request.escalations].join(", ")}`),
	].join("\n");
}

export function installWork(pi: ExtensionAPI): void {
	pi.registerCommand("org", {
		description: "Inspect organization waits, work and requests; economics or experience for detail",
		handler: async (args, ctx) => {
			const input = args.trim();
			if (!input) {
				ctx.ui.notify(organizationOverview(ctx), "info");
				return;
			}
			const mode = input.split(/\s+/, 1)[0];
			const query = input.slice(mode.length).trim();
			if (mode === "economics" && query) {
				ctx.ui.notify(
					readFitness(ctx, { since: query })
						.content.map((part) => part.text)
						.join("\n"),
					"info",
				);
			} else if (mode === "experience" && query) {
				const self = ctx.sessionManager.getSessionId();
				const address = query.replace(/^person:/, "").trim();
				const members = organizationOf(self, true).members;
				const byId = members.find((member) => member.id === address);
				const byName = byId ? [] : members.filter((member) => member.name?.toLowerCase() === address.toLowerCase());
				if (byName.length > 1) throw new Error(`More than one person is named ${address}; use the session id.`);
				const person = byId?.id ?? byName[0]?.id;
				const result = readExpertise(
					ctx,
					person || query.startsWith("person:") ? { person: person ?? address } : { area: query },
				);
				ctx.ui.notify(result.content.map((part) => part.text).join("\n"), "info");
			} else {
				ctx.ui.notify(ORG_HELP, "info");
			}
		},
	});
	pi.registerTool(
		defineTool({
			name: "progress",
			label: "progress",
			description:
				"See what the organization delivered and what remains: arrivals, completions, cancellations, ready/held/waiting work, age, unioned waiting intervals, assignment/focus changes and attributed outcome/result/check links. Start with the aggregate overview; give limit and offset for each named detail table, or select a person, subtree or task. Current owner availability and errors have their own timestamps. Assignment is responsibility, not active execution; task counts and recorded outcomes are not a productivity score or verified value. Give since for a period; compare explicit windows rather than assuming a baseline. Execution evidence distinguishes incoming-mail-associated time, pre-mail prefixes, unknowns and gaps. Follow bottlenecks for dependency paths and coordination for related discussion.",
			promptSnippet:
				"Start an organizational investigation with delivery, aging work, waits, outcomes and evidence coverage.",
			parameters: Type.Object(inspectionParameters, { additionalProperties: false }),
			execute: async (_id, args, _signal, _update, ctx) => readInspection(ctx, args, progressIn),
		}),
	);
	pi.registerTool(
		defineTool({
			name: "bottlenecks",
			label: "bottlenecks",
			description:
				"Find candidate constraints, not diagnoses: explicit wait targets, distinct directly/transitively affected tasks, witness links, cycle groups, age and resolved waits. Beside dependency evidence, inspect responsible people's commitments, pending decisions/escalations, focus changes and fresh availability observations. Counts overlap across targets; resolving one need may leave others. Reporting and assignment supply context, never invented wait edges. A large team or busy person alone is not a bottleneck. Omit limit for the overview; request detail pages and follow task/thread/link references before choosing an ordinary authorized management action. Give since for interval and resolved-wait evidence.",
			promptSnippet: "Investigate recorded dependency paths and decision queues, with owner context and uncertainty.",
			parameters: Type.Object(inspectionParameters, { additionalProperties: false }),
			execute: async (_id, args, _signal, _update, ctx) => readInspection(ctx, args, bottlenecksIn),
		}),
	);
	pi.registerTool(
		defineTool({
			name: "coordination",
			label: "coordination",
			description:
				"Inspect coordination beside associated work over a stated window. Count authored posts once and distinguish actual authors, potential audiences, quiet channel publication, explicit notification, addressed delivery, transcript receipts and catch-up watermarks. Follow task-thread or explicit-link associations to outcomes, waits and results; select a thread to investigate otherwise unassociated discussion. High discussion may be useful work, while silence may hide an unresolved dependency. Incoming-mail-associated run time is mixed provider/tool/work time, not exclusive communication effort or wasted chatting; pre-mail, unknown and unobserved time remain separate. Metadata grants no message-body access: use read_thread/search_messages under their normal authority. Overview by default; limit/offset page each named detail table.",
			promptSnippet:
				"Relate communication and qualified execution evidence to work without treating activity as waste or value.",
			parameters: Type.Object(
				{
					...inspectionParameters,
					since: Type.String({ minLength: 1, description: "Window start: 30m, 8h, 7d, or a date." }),
					thread: Type.Optional(
						Type.String({ minLength: 1, description: "One thread ID, instead of person, subtree or task." }),
					),
				},
				{ additionalProperties: false },
			),
			execute: async (_id, args, _signal, _update, ctx) => readInspection(ctx, args, coordinationIn),
		}),
	);
	pi.registerTool(
		defineTool({
			name: "experience",
			label: "experience",
			description:
				"Find relevant recorded experience, not a skill ranking. Give an area (path, directory, or word in paths) for people with read/edit exposure, associated assignments and reported outcomes, recency and current availability; or give a person for directories they touched. Calls count even when they failed. Historical membership applies at each touch; current availability is labeled current, and recorded outcomes are not independently verified quality. A compaction means one started, not that it succeeded or erased understanding. Combine this evidence with the person's context and capacity before assigning work.",
			promptSnippet: "Find who has context on an area, or what a person knows.",
			parameters: Type.Object(
				{
					area: Type.Optional(Type.String({ minLength: 1, description: "A path, directory, or word in paths." })),
					person: Type.Optional(Type.String({ minLength: 1, description: "A person, by name or id." })),
					since: Type.Optional(
						Type.String({ minLength: 1, description: "Only touches after: 30m, 8h, 7d, or a date." }),
					),
					until: Type.Optional(Type.String({ minLength: 1, description: "Only touches before, in the same form." })),
					subtree: Type.Optional(Type.String({ minLength: 1, description: "Only people in this person's subtree." })),
				},
				{ additionalProperties: false },
			),
			execute: async (_id, args, _signal, _update, ctx) => readExpertise(ctx, args),
		}),
	);
	pi.registerTool(
		defineTool({
			name: "economics",
			label: "economics",
			description:
				"Compare recorded value, delay and compute in dollars over a past window. This is optional economic comparison beside progress, bottlenecks, coordination and experience, not a compulsory objective. Shows totals/rates, task/person/link contributions, incurred impacts, finding records and unvalued coverage. Estimates and findings are evidence, not charges. Dropped-work spend explains costs already counted on currently cancelled/replaced tasks, possibly classified after the window; it is not extra cost or a waste verdict. Temporary-peer spend follows immutable ancestry to a lasting caller under event-time membership; missing legacy callers and spans stay unknown. New peers have recorded zero baselines; legacy first-sight spend remains a baseline. Task compute uses accounting-person focus as an estimate, including caller focus for peers; absent/ineligible focus stays unattributed. Subtree filtering narrows contributions, not organization totals. Alternatively give scenarios alone for probability-weighted comparison through the same evaluator. Scenarios require identical decision point, horizon, opportunity/task identities, valuations and starting histories; their premises are supplied assumptions, not measured benefits or certified live snapshots. Times are millisecond offsets. decisionAt:'recording' binds preview now and a separately recorded prediction at link creation. Use predictions for qualified calibration, not causal proof.",
			promptSnippet:
				"Use optional economic comparison with economics alongside direct organizational signals and judgment.",
			parameters: Type.Object(
				{
					since: Type.Optional(
						Type.String({
							minLength: 1,
							description: "Realized mode start: 30m, 8h, 7d or a date; alternative to scenarios.",
						}),
					),
					scenarios: Type.Optional(
						Type.Array(scenarioSchema, {
							minItems: 1,
							description:
								"Expected mode only: compare forecasts on equal premises, instead of since/until/subtree. All history times are offsets from decisionAt.",
						}),
					),
					until: Type.Optional(Type.String({ minLength: 1, description: "End, in the same form; now by default." })),
					subtree: Type.Optional(
						Type.String({ minLength: 1, description: "Show only contributions of this person's subtree." }),
					),
				},
				{ additionalProperties: false },
			),
			execute: async (_id, args, _signal, _update, ctx) => readFitness(ctx, args),
		}),
	);
	pi.registerTool(
		defineTool({
			name: "predictions",
			label: "predictions",
			description:
				"Read recorded predicts links targeting your current root organization exactly. Record a forecast with link from the message stating the change to organization:<root>, carrying unchanged data.scenario in the economics scenario shape. Relative decisionAt:'recording' binds to immutable link creation time; an absolute origin differing from recording stays a clock mismatch, never shifted. Pending until creation+horizon, then expected and observed dollars with forecast error (observed minus expected), calibration not causal effect. Numeric valuation changes or unmapped/missing/unvalued/not-yet-opened-at-recording opportunities suppress error. Observed coverage, incompleteness, exclusions and unmeasured attention remain visible; incomplete observed valuation suppresses error, while static exclusions alone do not. Nonfinite observed totals or calibration errors are explicitly unavailable/unscored, and bound horizons must advance representably. Expected and available observed totals remain visible. Unreadable scenarios retain raw data and reason. No aggregation of former-root forecasts after a merge.",
			promptSnippet: "Read recorded forecasts beside observed fitness for calibration, not causal attribution.",
			parameters: Type.Object({}, { additionalProperties: false }),
			execute: async (_id, _args, _signal, _update, ctx) => {
				const now = Date.now();
				const rows = withWork((db) => predictions(db, rootOf(db, ctx.sessionManager.getSessionId()), now));
				if (!rows) throw new Error("The runtime has no recorded predictions yet");
				return {
					content: [
						{
							type: "text" as const,
							text: [
								"Forecast error is calibration, not the causal effect of a change.",
								...rows.map(
									(row) =>
										`${row.link} -> ${row.target}, recorded by ${row.recordedBy}: ${row.status}; expected ${row.expected ?? "unavailable"}, observed ${row.observed ?? "unavailable"}, error ${row.forecastError ?? "unscored"}${row.reason ? `; ${row.reason}` : ""}${row.observation ? `; observed coverage ${row.observation.coverage.tasks} tasks, ${row.observation.coverage.unvalued} unvalued (${row.observation.incomplete ? "incomplete" : "valued subset"}); known exclusions: ${row.observation.excludes}; attention measured: ${row.observation.attention.measured}${row.observation.coverageReason ? `; ${row.observation.coverageReason}` : ""}` : ""}${row.status === "unreadable" ? `; raw ${row.raw}` : ""}`,
								),
							].join("\n"),
						},
					],
					details: { predictions: rows },
				};
			},
		}),
	);
	const vocabulary = Object.entries(relations())
		.map(([word, meaning]) => `${word}: ${meaning}`)
		.join(" ");
	pi.registerTool(
		defineTool({
			name: "link",
			executionMode: "sequential",
			label: "link",
			description: `Record a relationship between two things, or resolve one by id. Name each thing as kind:id with kind one of ${ENTITY_KINDS.join(", ")} (a task by id or ledger path, a person by name or id, a commit by SHA, a PR by URL, a file by path, a check run by its command and time or CI URL, the organization by its root's id). Relations: ${vocabulary} A wait (blocks, requires_decision) on a task ends on its own when that task closes done; resolve any other link yourself. A finds link targets a task; its owner resolves it accepted or rejected as evidence, never value. Any link can carry data.impact: {dollars: number, kind: 'incurred' | 'estimated', at?: epoch milliseconds}. Only incurred impacts enter economic accounting, at that time or link creation. Record actual losses or gains, never avoided losses or value/cost already counted; impacts are assertions the substrate does not verify. A predicts link from the message stating a change to organization:<root> stores unchanged forecast premises in data.scenario. Record before acting; keep hypothetical impacts nested inside data.scenario, not top-level data.impact.`,
			promptSnippet: "Record or resolve a link between tasks, people, threads, and results.",
			parameters: Type.Object(
				{
					id: Type.Optional(Type.String({ minLength: 1, description: "Resolve this link instead of recording one." })),
					resolution: Type.Optional(
						Type.String({
							minLength: 1,
							description: "With id: a word for how it ended, such as accepted or rejected.",
						}),
					),
					from: Type.Optional(Type.String({ minLength: 3, description: "The first thing, as kind:id." })),
					to: Type.Optional(Type.String({ minLength: 3, description: "The second thing, as kind:id." })),
					relation: Type.Optional(Type.String({ minLength: 1, description: "A relation from the list." })),
					reason: Type.Optional(Type.String({ description: "A short reason or evidence reference." })),
					data: Type.Optional(
						Type.Unknown({
							description:
								"Structured data; scenario: forecast premises for a predicts link. impact: {dollars: number, kind: 'incurred' | 'estimated', at?: epoch milliseconds}. Estimates are listed, not charged.",
						}),
					),
					inferred: Type.Optional(
						Type.Boolean({ description: "True when you infer the relationship rather than know it." }),
					),
					confidence: Type.Optional(
						Type.Number({ minimum: 0, maximum: 1, description: "With inferred: how sure you are, 0 to 1." }),
					),
				},
				{ additionalProperties: false },
			),
			execute: (_id, args, signal, _update, ctx) => changeLink(ctx, args, signal),
		}),
	);
	pi.registerTool(
		defineTool({
			name: "take_task",
			executionMode: "sequential",
			label: "take_task",
			description:
				"Take responsibility for work: give a goal to create an ephemeral task, or take an existing unassigned task by id or ledger path. It becomes your focused task; your manager hears through its task thread. Every task has a task.md goal and a retrospective, even informal work. You can hold several tasks, with one in focus.",
			promptSnippet: "Take a goal or existing task; it becomes your focused work.",
			promptGuidelines: [
				"Take new work from the operator as a task before working, unless it is already assigned to you. Edit task.md to change the goal, then focus it again to reread it. Finish the retrospective before finish_task.",
			],
			parameters: Type.Object(goalOrTask, { additionalProperties: false }),
			execute: (_id, args, signal, _update, ctx) => change(ctx, { action: "take", ...args }, signal),
		}),
	);
	pi.registerTool(
		defineTool({
			name: "focus",
			executionMode: "sequential",
			label: "focus",
			description:
				"Focus one of your assigned tasks. Rereads its task.md and appends the goal to your context, including edits made since you last focused it.",
			parameters: Type.Object({ task: taskParameter }, { additionalProperties: false }),
			execute: (_id, args, signal, _update, ctx) => change(ctx, { action: "focus", ...args }, signal),
		}),
	);
	pi.registerTool(
		defineTool({
			name: "finish_task",
			executionMode: "sequential",
			label: "finish_task",
			description:
				"Finish your focused assignment: write the outcome into task.md, end your assignment, clear focus, and report the outcome to everyone in its task thread. Say what you verified and what you believe. Once all assignees finish, an ephemeral task is marked done and its directory, retrospective and artifacts stay at their original paths; finishing never moves or deletes the bundle. A ledger bundle stays under its ledger status workflow.",
			parameters: Type.Object(
				{ outcome: Type.String({ minLength: 1, description: "The outcome and verification, in your own words." }) },
				{ additionalProperties: false },
			),
			execute: (_id, args, signal, _update, ctx) => change(ctx, { action: "finish", ...args }, signal),
		}),
	);
	pi.registerTool(
		defineTool({
			name: "promote_task",
			executionMode: "sequential",
			label: "promote_task",
			description:
				"Move a live ephemeral task into its project's .ledger with an index row. Its files, assignments, focus, and thread follow it. Optional title and description give the ledger's one-line title and search summary; otherwise its heading supplies both.",
			parameters: Type.Object(
				{ task: taskParameter, title: Type.Optional(Type.String()), description: Type.Optional(Type.String()) },
				{ additionalProperties: false },
			),
			execute: (_id, args, signal, _update, ctx) => change(ctx, { action: "promote", ...args }, signal),
		}),
	);
	const activate = (_event: unknown, ctx: ExtensionContext) => {
		const active = pi.getActiveTools();
		const allowed = managesPeople(ctx);
		const next = [
			...new Set([
				...active.filter((name) => allowed || !INSIGHT_TOOLS.includes(name)),
				...PERSON_TASK_TOOLS,
				...(allowed ? INSIGHT_TOOLS : []),
			]),
		];
		if (next.length !== active.length || next.some((name, index) => name !== active[index])) pi.setActiveTools(next);
	};
	pi.on("session_start", activate);
	pi.on("before_agent_start", activate);
	pi.on("session_compact", (_event, ctx) => {
		const text = goalText(ctx.sessionManager.getSessionId());
		if (text)
			pi.sendMessage(
				{ customType: TASK_GOAL_CUSTOM_TYPE, content: text, display: false },
				{ deliverAs: "steer", triggerTurn: false },
			);
	});
}

export function installAssignments(pi: ExtensionAPI): void {
	pi.registerTool(
		defineTool({
			name: "assign",
			executionMode: "sequential",
			label: "assign",
			description:
				"Assign a person in your organization a task or a plain goal. It becomes their focused work, with a goal file and a shared task thread. A person at home is called in and begins; an awake person receives it at the next safe boundary. It keeps its other assignments.",
			parameters: Type.Object(
				{
					person: Type.String({ minLength: 1, description: "A name in your organization or session id." }),
					...goalOrTask,
				},
				{ additionalProperties: false },
			),
			execute: (_id, args, signal, _update, ctx) =>
				change(
					ctx,
					{ ...args, action: "assign", person: resolvePerson(ctx.sessionManager.getSessionId(), args.person) },
					signal,
				),
		}),
	);
	pi.registerTool(
		defineTool({
			name: "unassign",
			executionMode: "sequential",
			label: "unassign",
			description:
				"Take an assignment back from a person. The assignment ends without being marked finished; the task stays available. The person and task participants hear the change, and its focus clears if it was on that task.",
			parameters: Type.Object(
				{ person: Type.String({ minLength: 1 }), task: taskParameter },
				{ additionalProperties: false },
			),
			execute: (_id, args, signal, _update, ctx) =>
				change(
					ctx,
					{ ...args, action: "unassign", person: resolvePerson(ctx.sessionManager.getSessionId(), args.person) },
					signal,
				),
		}),
	);
}
