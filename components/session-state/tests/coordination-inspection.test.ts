import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";
import { coordinationIn } from "../src/coordination-inspection.js";
import { recordLink } from "../src/links.js";
import { migrate } from "../src/schema.js";
import { participateIn, postToThread } from "../src/threads.js";

const databases: DatabaseSync[] = [];
afterEach(() => {
	for (const db of databases.splice(0)) db.close();
});
function fixture() {
	const db = new DatabaseSync(":memory:");
	migrate(db);
	databases.push(db);
	for (const id of ["root", "author", "reviewer", "outside"])
		db.prepare(
			"insert into sessions (id, kind, cwd, name, run_state, generation, source, updated_at, reports_to) values (?, 'root', '/', ?, 'idle', 1, 'test', 0, ?)",
		).run(id, id, id === "root" || id === "outside" ? null : "root");
	for (const id of ["a", "b"])
		db.prepare(
			"insert into work_tasks (id, bundle, project, organization, ephemeral, thread, opened_at) values (?, ?, '/', 'root', 1, ?, 0)",
		).run(id, `/missing/${id}`, `task:${id}`);
	db.prepare(
		"insert into assignments (person, task_id, assigned_by, assigned_at) values ('author', 'a', 'root', 0)",
	).run();
	db.prepare(
		"insert into threads (id, kind, subject, created_by, created_at) values ('channel', 'channel', 'private subject', 'author', 0)",
	).run();
	for (const id of ["root", "author", "reviewer"]) participateIn(db, "channel", id, 0, "pull");
	const command = (id: string, person: string, kind: string, at: number, input: unknown, result: unknown = null) =>
		db
			.prepare(
				"insert into commands (command_id, session_id, kind, command, result, stage, created_at, updated_at) values (?, ?, ?, ?, ?, 'applied', ?, ?)",
			)
			.run(id, person, kind, JSON.stringify(input), JSON.stringify(result), at, at);
	const event = (id: string, person: string, type: string, at: number) =>
		db
			.prepare("insert into events (at, source, session_id, type, data) values (?, 'runtime', ?, ?, ?)")
			.run(at, person, type, JSON.stringify({ commandId: id }));
	const post = (id: string, person: string, at: number, notify: string[] = [], modern = true) => {
		const posted = postToThread(db, person, id, { thread: "channel", body: "PRIVATE MESSAGE BODY", notify }, at);
		if (typeof posted === "string") throw new Error(posted);
		if (modern)
			command(
				id,
				person,
				"communication",
				at,
				{},
				{
					action: "post",
					thread: { id: "channel" },
					message: { id, body: "PRIVATE MESSAGE BODY" },
					audience: ["root", "author", "reviewer"],
					notify,
					queued: posted.push,
				},
			);
		for (const receiver of posted.push)
			command(`${id}:${receiver}`, receiver, "mail", at, {
				reference: { id },
				thread: "channel",
				seq: posted.seq,
				body: "PRIVATE MESSAGE BODY",
			});
		return posted;
	};
	return {
		db,
		post,
		command,
		event,
		inspect: (scope: { task?: string; thread?: string; person?: string } = {}, to = 10) =>
			coordinationIn(db, "root", { cwd: "/", from: 0, to }, scope, { limit: 50 }),
	};
}

test("quiet publication, explicit attention, actual authors, receipts and useful work remain separate", () => {
	const { db, post, command, event, inspect } = fixture();
	recordLink(
		db,
		"topic-work",
		"root",
		{ from: { kind: "task", id: "a" }, to: { kind: "thread", id: "channel" }, relation: "produced" },
		0,
	);
	recordLink(
		db,
		"decision",
		"root",
		{ from: { kind: "task", id: "a" }, to: { kind: "person", id: "reviewer" }, relation: "requires_decision" },
		2,
	);
	post("one", "author", 1);
	post("two", "reviewer", 2, ["author"]);
	const third = post("three", "author", 3);
	event("two:author", "author", "command_delivered", 3);
	event("two:author", "author", "command_applied", 12);
	command(
		"read",
		"author",
		"communication",
		4,
		{},
		{
			thread: { id: "channel" },
			page: { view: "catch_up", acknowledgment: "applied", acknowledged_through: third.seq },
		},
	);
	event("read", "author", "communication_applied", 4);
	command(
		"recent",
		"author",
		"communication",
		5,
		{},
		{ thread: { id: "channel" }, page: { view: "recent", acknowledgment: "not_requested" } },
	);
	event("recent", "author", "communication_applied", 5);
	recordLink(
		db,
		"artifact",
		"root",
		{ from: { kind: "task", id: "a" }, to: { kind: "commit", id: "result" }, relation: "produced" },
		6,
	);
	const result = inspect();
	expect(result.summary).toMatchObject({
		authoredPosts: 3,
		actualAuthors: 2,
		quietChannelPosts: 2,
		notifiedChannelPosts: 1,
		addressedDeliveries: 1,
		transcriptReceipts: 0,
		catchUpReceipts: 1,
		postsWithTaskAssociation: 3,
		associatedTasks: 1,
		pendingDecisions: 1,
	});
	expect(result.threads.rows[0]).toMatchObject({
		authorTransitions: 2,
		returningAuthors: ["person:author"],
		postsDuringRecordedWait: 2,
	});
	expect(result.pairs.rows).toEqual([
		{ author: "person:reviewer", recipient: "person:author", addressedPosts: 1, transcriptReceipts: 0 },
	]);
	expect(result.work.rows[0]).toMatchObject({ ref: "task:a", waitingMs: 8, openWaits: ["link:decision"] });
	expect(result.work.rows[0].evidence.some((row) => row.to === "commit:result")).toBe(true);
	expect(JSON.stringify(result)).not.toMatch(/PRIVATE MESSAGE BODY|private subject/);
	expect(inspect({}, 15).summary.transcriptReceipts).toBe(1);
	db.prepare("update thread_participants set read_up_to = 999").run();
	expect(inspect().summary).toEqual(result.summary);
});

test("a message-specific task link does not associate the entire conversation or all of its owner's work", () => {
	const { db, post, inspect } = fixture();
	post("one", "author", 1);
	post("two", "reviewer", 2);
	post("three", "author", 3);
	recordLink(
		db,
		"message-work",
		"root",
		{ from: { kind: "message", id: "two" }, to: { kind: "task", id: "b" }, relation: "produced" },
		2,
	);
	recordLink(
		db,
		"unrelated-decision",
		"root",
		{ from: { kind: "task", id: "a" }, to: { kind: "person", id: "reviewer" }, relation: "requires_decision" },
		2,
	);
	const task = inspect({ task: "b" });
	expect(task.posts.rows.map((row) => row.ref)).toEqual(["message:two"]);
	expect(task.work.rows.map((row) => row.ref)).toEqual(["task:b"]);
	expect(task.summary.pendingDecisions).toBe(0);
	expect(task.execution.available).toBe(false);
	const unassociated = inspect({ thread: "channel" });
	expect(unassociated.summary).toMatchObject({ authoredPosts: 3, postsWithTaskAssociation: 1 });
});

test("historical audiences and author membership survive later departure; unknown legacy attention stays unknown", () => {
	const { db, post, inspect } = fixture();
	post("legacy", "author", 1, [], false);
	const before = inspect();
	participateIn(db, "channel", "author", 15, null);
	db.prepare(
		"insert into events (at, source, session_id, type, data) values (15, 'runtime', 'author', 'transferred', ?)",
	).run(JSON.stringify({ from: "root", to: "outside" }));
	db.prepare("update sessions set reports_to = 'outside' where id = 'author'").run();
	expect(inspect().posts).toEqual(before.posts);
	expect(inspect().summary).toMatchObject({ quietChannelPosts: 0, channelPostsWithoutExplicitAttentionHistory: 1 });
	expect(coordinationIn(db, "outside", { cwd: "/", from: 0, to: 10 }, {}, { limit: 10 }).summary.authoredPosts).toBe(0);
});
