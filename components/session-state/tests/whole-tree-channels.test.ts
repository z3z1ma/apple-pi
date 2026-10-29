import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, test } from "vitest";
import { syncChannels } from "../src/channels.js";
import { migrate } from "../src/schema.js";
import { audienceAt, markRead, messagesOf, postToThread, threadsOf } from "../src/threads.js";

let db: DatabaseSync;
beforeEach(() => {
	db = new DatabaseSync(":memory:");
	migrate(db);
});
afterEach(() => db.close());

function person(id: string, manager: string | null = null, kind = "root") {
	db.prepare(
		"insert into sessions (id, kind, cwd, name, reports_to, run_state, generation, source, updated_at) values (?, ?, '/', ?, ?, 'idle', 1, 'bridge', 1)",
	).run(id, kind, id, manager);
}
const members = (thread: string) =>
	threadsOf(db, thread.slice(thread.indexOf(":") + 1), false)
		.find((summary) => summary.id === thread)
		?.participants.map((person) => person.id)
		.sort();
const move = (id: string, manager: string | null) =>
	db.prepare("update sessions set reports_to = ? where id = ?").run(manager, id);
const post = (thread: string, sender: string, id: string, now: number, to?: string[]) =>
	postToThread(db, sender, id, { thread, body: id, to }, now);

test("independent trees get separate full-branch channels without changing local channels", () => {
	person("head");
	person("manager", "head");
	person("at-home", "manager");
	person("other-head");
	person("child", "head", "child");
	person("temporary", "head");
	db.prepare("insert into events (at, source, session_id, type, data) values (1, 'runtime', ?, ?, ?)").run(
		"temporary",
		"program_peer_created",
		JSON.stringify({ caller: "head" }),
	);
	person("legacy-temporary", "head");
	db.prepare("insert into program_peers (session_id, program_id, created_by, task_id) values (?, ?, ?, ?)").run(
		"legacy-temporary",
		"program",
		"head",
		"task",
	);
	person("retired", "head");
	db.prepare("update sessions set retired_at = 1 where id = 'retired'").run();
	person("departed", "head");
	db.prepare("insert into events (at, source, session_id, type, data) values (1, 'runtime', ?, ?, '{}')").run(
		"departed",
		"person_departed",
	);
	syncChannels(db, 10);
	expect(members("organization:head")).toEqual(["at-home", "head", "manager"]);
	expect(members("organization:other-head")).toEqual(["other-head"]);
	expect(members("team:manager")).toEqual(["at-home", "manager"]);
	expect(members("team:head")).not.toContain("at-home");
	expect(threadsOf(db, "at-home", false).map((thread) => thread.id)).toEqual(
		expect.arrayContaining(["organization:head", "team:manager"]),
	);
});

test("merges retain the former head's branch channel, history, invitations and cursors", () => {
	person("first");
	person("manager", "first");
	person("report", "manager");
	person("second");
	person("guest");
	syncChannels(db, 10);
	expect(post("organization:first", "first", "before-merge", 11, ["guest", "operator"])).toMatchObject({
		push: [],
	});
	const seq = messagesOf(db, "organization:first")[0]!.seq;
	markRead(db, "organization:first", "report", seq);
	move("first", "second");
	syncChannels(db, 20);
	expect(members("organization:first")).toEqual(["first", "guest", "manager", "operator", "report"]);
	expect(members("organization:second")).toEqual(["first", "manager", "report", "second"]);
	expect(threadsOf(db, "report", true)).toEqual([]);
	expect(messagesOf(db, "organization:first").map((message) => message.body)).toEqual(["before-merge"]);
	expect(messagesOf(db, "organization:second")).toEqual([]);
	syncChannels(db, 21);
	expect(threadsOf(db, "report", true)).toEqual([]);
	post("organization:first", "first", "after-merge", 22);
	expect(threadsOf(db, "report", true)).toEqual([expect.objectContaining({ id: "organization:first", unread: 1 })]);
});

test("splits create or reuse the branch-head channel without copying the old organization's messages", () => {
	person("head");
	person("branch", "head");
	person("report", "branch");
	syncChannels(db, 10);
	post("team:branch", "branch", "local-history", 11);
	post("organization:head", "head", "old-team-history", 12);
	post("organization:head", "head", "explicitly-retained", 13, ["branch"]);
	move("branch", null);
	syncChannels(db, 20);
	expect(members("organization:head")).toEqual(["branch", "head"]);
	expect(members("organization:branch")).toEqual(["branch", "report"]);
	expect(messagesOf(db, "organization:branch")).toEqual([]);
	expect(messagesOf(db, "organization:head")).toHaveLength(2);
	expect(messagesOf(db, "team:branch").map((message) => message.body)).toEqual(["local-history"]);
	expect(audienceAt(db, "organization:head", 19)).toEqual(["branch", "head", "report"]);
	expect(audienceAt(db, "organization:head", 20)).toEqual(["branch", "head"]);
	expect(post("organization:head", "report", "denied", 21)).toBe("you are not in this thread");
	post("organization:branch", "branch", "branch-history", 22);
	move("branch", "head");
	syncChannels(db, 30);
	move("branch", null);
	syncChannels(db, 40);
	expect(messagesOf(db, "organization:branch").map((message) => message.body)).toEqual(["branch-history"]);
	expect(members("organization:branch")).toEqual(["branch", "report"]);
});

test("branch channels follow moves and remove departed invitees without deleting history", () => {
	person("head");
	person("report", "head");
	person("other");
	person("guest");
	syncChannels(db, 10);
	post("organization:head", "head", "invite", 11, ["guest"]);
	move("report", "other");
	syncChannels(db, 20);
	expect(members("organization:head")).toEqual(["guest", "head"]);
	expect(members("organization:other")).toEqual(["other", "report"]);
	db.prepare("insert into events (at, source, session_id, type, data) values (21, 'runtime', ?, ?, '{}')").run(
		"guest",
		"person_departed",
	);
	db.prepare("delete from sessions where id = 'guest'").run();
	syncChannels(db, 30);
	expect(members("organization:head")).toEqual(["head"]);
	expect(audienceAt(db, "organization:head", 20)).toEqual(["guest", "head"]);
	expect(audienceAt(db, "organization:head", 30)).toEqual(["head"]);
	expect(messagesOf(db, "organization:head").map((message) => message.body)).toEqual(["invite"]);
});
