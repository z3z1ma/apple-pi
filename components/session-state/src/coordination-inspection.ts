import type { DatabaseSync } from "node:sqlite";
import { executionIn } from "./execution-inspection.js";
import { linkOwnership } from "./fitness.js";
import { communicationIn, type Scope, type Window } from "./inspect.js";
import { type DetailPage, type InspectionContext, inspectionContext, pageRows } from "./inspection-context.js";
import { type Link, WAITS } from "./links.js";
import { audienceAt, nameOf } from "./threads.js";
import { taskEvidence } from "./work-inspection.js";

interface Message {
	id: string;
	seq: number;
	thread: string;
	sender: string;
	at: number;
	kind: string;
}
interface Publication {
	message: string;
	audience: string | null;
	notify: string | null;
	attempt: string;
}
interface Delivery {
	id: string;
	person: string;
	message: string | null;
	thread: string;
	seq: number;
	at: number;
}

function taskAssociations(db: DatabaseSync, organization: string, context: InspectionContext) {
	const belongs = linkOwnership(db, organization);
	const rows = db
		.prepare(`select * from links where created_at < ? and
		((from_kind = 'task' and to_kind in ('thread', 'message')) or (to_kind = 'task' and from_kind in ('thread', 'message')))
		order by created_at, id`)
		.all(context.to) as unknown as Link[];
	return (thread: string, message: string, at: number) => {
		const direct = context.tasks
			.filter((task) => task.thread === thread && task.opened_at! <= at && context.ownership.owns(task.id, at))
			.map((task) => ({
				task: `task:${task.id}`,
				via: `thread:${thread}`,
				relation: "task_thread",
				inferred: false,
				recordedBy: null as string | null,
			}));
		for (const link of rows) {
			if (link.created_at > at || !belongs(link, at)) continue;
			const task = link.from_kind === "task" ? link.from_id : link.to_id;
			const kind = link.from_kind === "task" ? link.to_kind : link.from_kind;
			const id = link.from_kind === "task" ? link.to_id : link.from_id;
			if ((kind === "thread" ? id === thread : id === message) && context.ownership.owns(task, at))
				direct.push({
					task: `task:${task}`,
					via: `link:${link.id}`,
					relation: link.relation,
					inferred: Boolean(link.inferred),
					recordedBy: `person:${link.recorded_by}`,
				});
		}
		return direct;
	};
}

/** Metadata-only projections: durable effects/outbox identities are read, never message bodies or present cursors. */
function communicationRecords(db: DatabaseSync, from: number, to: number) {
	const messages = db
		.prepare(`select m.id, m.seq, m.thread_id as thread, m.sender, m.at, t.kind from thread_messages m
		join threads t on t.id = m.thread_id where m.at >= ? and m.at < ? order by m.seq`)
		.all(from, to) as unknown as Message[];
	const publications = new Map(
		(
			db
				.prepare(`select command_id as attempt, json_extract(result, '$.message.id') as message,
		json_extract(result, '$.audience') as audience, json_extract(result, '$.notify') as notify from commands
		where kind = 'communication' and json_extract(result, '$.message.id') is not null`)
				.all() as unknown as Publication[]
		).map((row) => [row.message, row]),
	);
	const deliveries = db
		.prepare(`select command_id as id, session_id as person, created_at as at,
		json_extract(command, '$.reference.id') as message, json_extract(command, '$.thread') as thread,
		json_extract(command, '$.seq') as seq from commands where kind = 'mail' and created_at < ?`)
		.all(to) as unknown as Delivery[];
	const stages = new Map(
		(
			db
				.prepare(`select json_extract(data, '$.commandId') as id, type, at, seq from events
		where type in ('command_delivered', 'command_applied', 'command_failed') and at < ? order by seq`)
				.all(to) as { id: string; type: string; at: number; seq: number }[]
		).map((row) => [row.id, row]),
	);
	const acknowledgments = db
		.prepare(`select c.command_id as attempt, c.session_id as person, e.at,
		json_extract(c.result, '$.thread.id') as thread, json_extract(c.result, '$.page.acknowledged_through') as through,
		e.seq as event from events e join commands c on c.command_id = json_extract(e.data, '$.commandId')
		where e.type = 'communication_applied' and e.at >= ? and e.at < ?
		and json_extract(c.result, '$.page.view') = 'catch_up' and json_extract(c.result, '$.page.acknowledgment') = 'applied'
		order by e.seq`)
		.all(from, to) as { attempt: string; person: string; at: number; thread: string; through: number; event: number }[];
	const byMessage = new Map<string, Delivery[]>();
	const ids = new Map(messages.map((message) => [`${message.thread}:${message.seq}`, message.id]));
	for (const delivery of deliveries) {
		const id = delivery.message ?? ids.get(`${delivery.thread}:${delivery.seq}`);
		if (!id) continue;
		const rows = byMessage.get(id) ?? [];
		rows.push(delivery);
		byMessage.set(id, rows);
	}
	return { messages, publications, byMessage, stages, acknowledgments };
}

export function coordinationIn(
	db: DatabaseSync,
	organization: string,
	window: Window,
	scope: Scope & { thread?: string } = {},
	page: DetailPage = {},
) {
	const context = inspectionContext(db, organization, window, scope);
	if (context.from === undefined) throw new Error("Give since to inspect coordination over a stated window");
	const records = communicationRecords(db, context.from, context.to);
	const associations = taskAssociations(db, organization, context);
	const waits = db
		.prepare(`select * from links where relation in (${WAITS.map(() => "?").join(",")}) and created_at < ?`)
		.all(...WAITS, context.to) as unknown as Link[];
	const belongs = (id: string, at: number) => {
		const caller = context.history.accountingPerson(id);
		return caller !== undefined && context.people(caller, at);
	};
	const messages = records.messages.flatMap((message) => {
		if (scope.thread && message.thread !== scope.thread) return [];
		const publication = records.publications.get(message.id);
		const audience: string[] = publication?.audience
			? JSON.parse(publication.audience)
			: audienceAt(db, message.thread, message.at);
		const delivery = records.byMessage.get(message.id) ?? [];
		if (
			!belongs(message.sender, message.at) &&
			![...audience, ...delivery.map((row) => row.person)].some((person) => belongs(person, message.at))
		)
			return [];
		const tasks = associations(message.thread, message.id, message.at);
		if (scope.task && !tasks.some((task) => task.task === `task:${scope.task}`)) return [];
		return [
			{
				ref: `message:${message.id}`,
				seq: message.seq,
				thread: `thread:${message.thread}`,
				kind: message.kind,
				author: `person:${message.sender}`,
				authorName: nameOf(db, message.sender),
				at: message.at,
				potentialAudience: audience.map((person) => `person:${person}`),
				audienceSource: publication?.audience ? "frozen_publication" : "participation_history",
				notified: publication?.notify
					? (JSON.parse(publication.notify) as string[]).map((person) => `person:${person}`)
					: null,
				deliveries: delivery.map((row) => ({
					person: `person:${row.person}`,
					command: row.id,
					stage: records.stages.get(row.id)?.type.slice(8) ?? "queued",
					event: records.stages.has(row.id) ? `event:${records.stages.get(row.id)!.seq}` : null,
				})),
				tasks,
				openWaitsAtPost: waits
					.filter(
						(wait) =>
							wait.from_kind === "task" &&
							tasks.some((task) => task.task === `task:${wait.from_id}`) &&
							wait.created_at <= message.at &&
							(wait.resolved_at === null || wait.resolved_at > message.at),
					)
					.map((wait) => `link:${wait.id}`),
			},
		];
	});
	const threads = new Map<
		string,
		{
			ref: string;
			kind: string;
			posts: number;
			authors: string[];
			authorTransitions: number;
			returningAuthors: string[];
			postsDuringRecordedWait: number;
			tasks: string[];
			lastAuthor: string | null;
		}
	>();
	const pairs = new Map<
		string,
		{ author: string; recipient: string; addressedPosts: number; transcriptReceipts: number }
	>();
	const teams = new Map<string, { authorTeam: string | null; recipientTeam: string | null; addressedPosts: number }>();
	const team = (person: string, at: number) => {
		const id = context.history.accountingPerson(person.slice(7));
		return id && context.history.memberAt(id, at) ? `person:${context.history.managerAt(id, at) ?? id}` : null;
	};
	for (const message of messages) {
		const thread = threads.get(message.thread) ?? {
			ref: message.thread,
			kind: message.kind,
			posts: 0,
			authors: [],
			authorTransitions: 0,
			returningAuthors: [],
			postsDuringRecordedWait: 0,
			tasks: [],
			lastAuthor: null,
		};
		if (thread.lastAuthor && thread.lastAuthor !== message.author) {
			thread.authorTransitions++;
			if (thread.authors.includes(message.author) && !thread.returningAuthors.includes(message.author))
				thread.returningAuthors.push(message.author);
		}
		if (!thread.authors.includes(message.author)) thread.authors.push(message.author);
		thread.lastAuthor = message.author;
		thread.posts++;
		if (message.openWaitsAtPost.length) thread.postsDuringRecordedWait++;
		thread.tasks = [...new Set([...thread.tasks, ...message.tasks.map((task) => task.task)])];
		threads.set(message.thread, thread);
		for (const delivery of message.deliveries) {
			const key = JSON.stringify([message.author, delivery.person]);
			const pair = pairs.get(key) ?? {
				author: message.author,
				recipient: delivery.person,
				addressedPosts: 0,
				transcriptReceipts: 0,
			};
			pair.addressedPosts++;
			if (delivery.stage === "applied") pair.transcriptReceipts++;
			pairs.set(key, pair);
			const authorTeam = team(message.author, message.at),
				recipientTeam = team(delivery.person, message.at);
			const teamKey = JSON.stringify([authorTeam, recipientTeam]);
			const row = teams.get(teamKey) ?? { authorTeam, recipientTeam, addressedPosts: 0 };
			row.addressedPosts++;
			teams.set(teamKey, row);
		}
	}
	const acknowledgments = records.acknowledgments
		.filter(
			(ack) =>
				belongs(ack.person, ack.at) &&
				(!scope.thread || ack.thread === scope.thread) &&
				(!scope.task ||
					threads.has(`thread:${ack.thread}`) ||
					associations(ack.thread, "", ack.at).some((task) => task.task === `task:${scope.task}`)),
		)
		.map((ack) => ({
			...ack,
			person: `person:${ack.person}`,
			thread: `thread:${ack.thread}`,
			event: `event:${ack.event}`,
		}));
	const associated = new Set(
		messages
			.flatMap((message) => message.tasks.map((task) => task.task))
			.filter((task) => !scope.task || task === `task:${scope.task}`),
	);
	if (scope.task && context.visible(scope.task, context.to)) associated.add(`task:${scope.task}`);
	const describe = taskEvidence(db, organization, context);
	const work = context.tasks
		.filter((task) => associated.has(`task:${task.id}`))
		.map((task) => {
			const closed = task.archived_at !== null && task.archived_at < context.to ? task.archived_at : null;
			return {
				...describe(`task:${task.id}`, closed ?? context.to),
				closedAt: closed,
				status: closed === null ? "open" : task.close_status,
				openWaits: waits
					.filter(
						(wait) =>
							wait.from_kind === "task" &&
							wait.from_id === task.id &&
							(wait.resolved_at === null || wait.resolved_at > context.to),
					)
					.map((wait) => `link:${wait.id}`),
			};
		});
	const legacy = communicationIn(db, organization, { ...window, from: context.to, to: context.to }, scope);
	const relevantWaits = new Set(
		waits
			.filter(
				(wait) =>
					(wait.from_kind === "task" && associated.has(`task:${wait.from_id}`)) ||
					(wait.from_kind === "thread" && wait.from_id === scope.thread),
			)
			.map((wait) => `link:${wait.id}`),
	);
	const pending =
		!scope.task && !scope.thread
			? legacy.requests
			: legacy.requests
					.map((row) => ({
						...row,
						decisions: row.decisions.filter((ref) => relevantWaits.has(ref)),
						escalations: row.escalations.filter(
							(ref) =>
								ref === `thread:${scope.thread}` ||
								associations(ref.slice(7), "", context.to).some((task) => associated.has(task.task)),
						),
					}))
					.filter((row) => row.decisions.length || row.escalations.length);
	return {
		organization: `organization:${organization}`,
		scope,
		window: { from: context.from, to: context.to },
		summary: {
			authoredPosts: messages.length,
			actualAuthors: new Set(messages.map((message) => message.author)).size,
			quietChannelPosts: messages.filter((message) => message.kind === "channel" && message.notified?.length === 0)
				.length,
			notifiedChannelPosts: messages.filter(
				(message) => message.kind === "channel" && (message.notified?.length ?? 0) > 0,
			).length,
			channelPostsWithoutExplicitAttentionHistory: messages.filter(
				(message) => message.kind === "channel" && message.notified === null,
			).length,
			addressedDeliveries: messages.reduce((total, message) => total + message.deliveries.length, 0),
			transcriptReceipts: messages.reduce(
				(total, message) => total + message.deliveries.filter((delivery) => delivery.stage === "applied").length,
				0,
			),
			catchUpReceipts: acknowledgments.length,
			postsWithTaskAssociation: messages.filter((message) => message.tasks.length).length,
			associatedTasks: work.length,
			associatedTasksWithoutLifecycle: associated.size - work.length,
			pendingDecisions: pending.reduce((total, row) => total + row.decisions.length, 0),
			pendingEscalations: pending.reduce((total, row) => total + row.escalations.length, 0),
			associatedCompletions: work.filter(
				(task) => task.closedAt !== null && task.closedAt >= context.from! && task.status === "done",
			).length,
		},
		threads: pageRows(
			[...threads.values()].sort((a, b) => b.posts - a.posts || a.ref.localeCompare(b.ref)),
			page,
		),
		pairs: pageRows(
			[...pairs.values()].sort(
				(a, b) => b.addressedPosts - a.addressedPosts || JSON.stringify(a).localeCompare(JSON.stringify(b)),
			),
			page,
		),
		teams: pageRows(
			[...teams.values()].sort(
				(a, b) => b.addressedPosts - a.addressedPosts || JSON.stringify(a).localeCompare(JSON.stringify(b)),
			),
			page,
		),
		posts: pageRows(messages, page),
		acknowledgments: pageRows(acknowledgments, page),
		work: pageRows(work, page),
		pending: pageRows(pending, page),
		execution: scope.thread
			? { available: false, reason: "Thread activity does not establish exclusive run-time ownership." }
			: executionIn(db, context, page),
		coverage: [
			"Posts are counted once; audience, explicit notifications, queued deliveries and transcript receipts are different facts. Bodies remain behind the conversation reader's access checks.",
			"Frozen publication effects preserve audience. Older participation history is partial before its tracking boundary; absent explicit-notify records stay unknown.",
			"Author transitions are observed order, not inferred reply causality. Repeated discussion during a wait is not evidence of waste.",
			"Catch-up receipts confirm the recorded watermark, not necessarily a new advancement or understanding. Historical delivery stages come from journal events, not today's cursor.",
			"Tasks are associated through their own thread or explicit links at message time. Unassociated discussion is not waste; task outcomes and result links remain attributed claims.",
		],
		audienceHistory: legacy.audienceHistory,
	};
}
