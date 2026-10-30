import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, test } from "vitest";
import { syncChannels } from "../src/channels.js";
import {
	communicationAvailable,
	conversationInfo,
	findChannels,
	readConversation,
	searchMessages,
} from "../src/communication.js";
import { applyCommunication, type PublishCommunication } from "../src/communication-actions.js";
import type { CommunicationOperation } from "../src/communication-types.js";
import { discardProgramPeople } from "../src/program-peers.js";
import { migrate, SCHEMA_VERSION } from "../src/schema.js";
import { nameOf, postToThread } from "../src/threads.js";

let db: DatabaseSync;
let sequence = 0;
beforeEach(() => {
	db = new DatabaseSync(":memory:");
	migrate(db);
	for (const [id, manager] of [
		["a", null],
		["b", "a"],
		["outside", null],
	])
		db.prepare(
			"insert into sessions (id,kind,cwd,name,run_state,generation,source,updated_at,reports_to) values (?,'root','/',?,'idle',1,'test',1,?)",
		).run(id, id, manager);
	syncChannels(db, 1);
});
afterEach(() => db.close());

function perform(actor: string, operation: CommunicationOperation) {
	const id = `core-${++sequence}`;
	const publish: PublishCommunication = (post, suffix, sender = actor) => {
		const messageId = suffix ? `${id}:${suffix}` : id;
		const result = postToThread(db, sender, messageId, post, sequence);
		if (typeof result === "string") throw new Error(result);
		return {
			message: {
				thread: post.thread,
				seq: result.seq,
				id: messageId,
				from: sender,
				fromName: nameOf(db, sender),
				body: post.body,
				at: sequence,
				reference: { thread: post.thread, seq: result.seq, id: messageId },
			},
			audience: [],
			queued: result.push,
		};
	};
	db.exec("begin");
	try {
		const effect = applyCommunication(db, actor, operation, sequence, id, publish);
		db.exec("commit");
		return effect;
	} catch (error) {
		db.exec("rollback");
		throw error;
	}
}
const topic = (invite: string[] = []) =>
	perform("a", { action: "create_channel", name: "Reliability", purpose: "Find the shared cause", invite }).thread.id;

test("recorded branch access stays separate from explicit grants and following through merge and split", () => {
	const id = topic(["b"]);
	expect(conversationInfo(db, "b", id)).toMatchObject({
		following: true,
		access_sources: ["explicit_invitation", "organization"],
	});
	perform("b", { action: "leave", thread: id });
	expect(conversationInfo(db, "a", id).participants.map((person) => person.id)).toEqual(["a"]);
	expect(conversationInfo(db, "a", id).invitations?.map((person) => person.id)).toEqual(["b"]);
	db.prepare("update sessions set reports_to = 'outside' where id = 'a'").run();
	syncChannels(db, 10);
	expect(conversationInfo(db, "outside", id).access).toBe(false);
	db.prepare("update sessions set reports_to = 'outside' where id = 'b'").run();
	syncChannels(db, 11);
	expect(conversationInfo(db, "b", id)).toMatchObject({
		access: true,
		following: false,
		access_sources: ["explicit_invitation"],
	});
	perform("a", { action: "remove", thread: id, people: ["b"] });
	expect(conversationInfo(db, "b", id).access).toBe(false);
	expect(() => readConversation(db, "b", { thread: id, view: "recent", limit: 2 })).toThrow(/access/);
});

test("self-joining creates no grant; discovery, inspection and prose do not follow or notify", () => {
	const id = topic();
	expect(findChannels(db, "b", { limit: 10 }).threads.find((item) => item.id === id)).toMatchObject({
		following: false,
	});
	expect(readConversation(db, "b", { thread: id, view: "recent", limit: 10 }).acknowledgment).toBe("not_requested");
	expect(perform("a", { action: "post", thread: id, body: "@b is quoted context" }).queued).toEqual([]);
	expect(conversationInfo(db, "b", id).following).toBe(false);
	expect(perform("a", { action: "post", thread: id, body: "Please check", notify: ["b"] }).queued).toEqual(["b"]);
	expect(() => perform("a", { action: "post", thread: id, body: "Refused", notify: ["outside"] })).toThrow(/access/);
	perform("b", { action: "join", thread: id });
	expect(conversationInfo(db, "b", id).access_sources).toEqual(["organization"]);
	db.prepare("update sessions set reports_to = 'outside' where id = 'b'").run();
	syncChannels(db, 20);
	expect(conversationInfo(db, "b", id).access).toBe(false);
});

test("paged catch-up acknowledges only returned ascending history and freezes its window", () => {
	const id = topic(["b"]);
	for (const body of ["one", "two", "three", "four"]) perform("a", { action: "post", thread: id, body });
	const first = perform("b", { action: "read", thread: id, limit: 2 }).page!;
	const forged = JSON.parse(Buffer.from(first.next_cursor!, "base64url").toString("utf8"));
	forged.position = first.window_through;
	expect(() =>
		perform("b", {
			action: "read",
			thread: id,
			limit: 2,
			cursor: Buffer.from(JSON.stringify(forged)).toString("base64url"),
		}),
	).toThrow(/gap beyond/);
	expect(first.messages.map((item) => item.body)).toEqual(["one", "two"]);
	expect(first.acknowledged_through).toBe(first.messages.at(-1)!.seq);
	perform("a", { action: "post", thread: id, body: "five" });
	const next = perform("b", { action: "read", thread: id, limit: 2, cursor: first.next_cursor }).page!;
	expect(next.messages.map((item) => item.body)).toEqual(["three", "four"]);
	expect(next.window_through).toBe(first.window_through);
	expect(readConversation(db, "b", { thread: id, limit: 2 }).messages.map((item) => item.body)).toEqual(["five"]);
	const recent = readConversation(db, "b", { thread: id, view: "recent", limit: 2 });
	expect(recent.messages.map((item) => item.body)).toEqual(["four", "five"]);
	expect(
		readConversation(db, "b", { thread: id, view: "recent", limit: 2, cursor: recent.next_cursor }).messages.map(
			(item) => item.body,
		),
	).toEqual(["two", "three"]);
	expect(() => readConversation(db, "a", { thread: id, view: "recent", limit: 2, cursor: recent.next_cursor })).toThrow(
		/another caller/,
	);
	const before = conversationInfo(db, "b", id).read_up_to;
	expect(searchMessages(db, "b", { query: "five", limit: 1 }).messages[0].reference.thread).toBe(id);
	expect(conversationInfo(db, "b", id).read_up_to).toBe(before);
});

test.each(["recent", "range"] as const)(
	"a resumed %s inspection with omitted view never acknowledges unseen history",
	(view) => {
		const id = topic(["b"]);
		for (const body of ["unseen one", "unseen two", "selected three"])
			perform("a", { action: "post", thread: id, body });
		const first = perform("b", { action: "read", thread: id, view, limit: 1 }).page!;
		expect(first.next_cursor).toBeDefined();
		const next = perform("b", { action: "read", thread: id, limit: 1, cursor: first.next_cursor }).page!;
		expect(next).toMatchObject({
			view,
			acknowledgment: "not_requested",
			acknowledged_through: null,
			last_confirmed_cursor: 0,
		});
		expect(conversationInfo(db, "b", id).read_up_to).toBe(0);
	},
);

test("temporary explicit access survives reconciliation while derived scope never grants it", () => {
	db.prepare(
		"insert into sessions (id,kind,cwd,name,run_state,generation,source,updated_at,reports_to) values ('temporary','root','/','Temporary author','idle',1,'test',1,'a')",
	).run();
	db.prepare(
		"insert into events(at,source,session_id,type,data) values (1,'test','temporary','program_peer_created',?)",
	).run(JSON.stringify({ caller: "a" }));
	const id = topic();
	expect(conversationInfo(db, "temporary", id).access).toBe(false);
	perform("a", { action: "invite", thread: id, people: ["temporary"] });
	syncChannels(db, 20);
	expect(conversationInfo(db, "temporary", id)).toMatchObject({
		access: true,
		following: true,
		access_sources: ["explicit_invitation"],
	});
	const created = perform("temporary", {
		action: "create_channel",
		name: "Temporary investigation",
		purpose: "Retained shared findings",
		invite: [],
	}).thread.id;
	syncChannels(db, 21);
	expect(conversationInfo(db, "temporary", created)).toMatchObject({
		access: true,
		following: true,
		access_sources: ["explicit_invitation"],
	});
	expect(conversationInfo(db, "a", created).access).toBe(true);
	db.prepare("update sessions set retired_at = 22 where id = 'temporary'").run();
	syncChannels(db, 22);
	expect(conversationInfo(db, "temporary", id).access).toBe(false);
});

test("actual temporary disposal retains its shared topic and attributed message", () => {
	const directory = mkdtempSync(join(tmpdir(), "communication-disposal-"));
	try {
		db.prepare(
			"insert into sessions (id,kind,cwd,name,run_state,generation,source,updated_at,reports_to) values ('temporary','root','/','Temporary author','idle',1,'test',1,'a')",
		).run();
		db.prepare(
			"insert into events(at,source,session_id,type,data) values (1,'test','temporary','program_peer_created',?)",
		).run(JSON.stringify({ caller: "a" }));
		db.prepare(
			"insert into program_peers(session_id,program_id,created_by,task_id) values ('temporary','fixture','a','no-task-files')",
		).run();
		const id = perform("temporary", {
			action: "create_channel",
			name: "Shared evidence",
			purpose: "Keep the recorded finding",
			invite: [],
		}).thread.id;
		perform("temporary", { action: "post", thread: id, body: "Retained finding" });
		discardProgramPeople(db, directory, new Set(["temporary"]), 50);
		expect(db.prepare("select id from sessions where id = 'temporary'").get()).toBeUndefined();
		const page = readConversation(db, "a", { thread: id, view: "recent", limit: 1 });
		expect(page.thread).toMatchObject({ archived: false, scope_head: "a" });
		expect(page.messages[0]).toMatchObject({
			from: "temporary",
			fromName: "Temporary author",
			body: "Retained finding",
		});
		expect(db.prepare("select 1 from thread_participants where participant = 'temporary'").all()).toEqual([]);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("missing reply targets refuse before creating a sender-only conversation", () => {
	expect(() => perform("a", { action: "post", thread: "missing", body: "Not a new conversation" })).toThrow(
		/needs a subject/,
	);
	expect(() =>
		perform("a", { action: "post", thread: "missing", subject: "Still no addressee", body: "Not a new conversation" }),
	).toThrow(/needs someone/);
	expect(db.prepare("select id from threads where id = 'missing'").get()).toBeUndefined();
});

test("failed read acknowledgment returns the fetched bodies and last confirmed cursor", () => {
	const id = topic(["b"]);
	perform("a", { action: "post", thread: id, body: "Evidence" });
	db.exec(
		"create trigger refuse_ack before update of read_up_to on thread_participants when new.participant = 'b' begin select raise(FAIL, 'ack storage unavailable'); end",
	);
	const page = perform("b", { action: "read", thread: id, limit: 1 }).page!;
	expect(page.messages.map((item) => item.body)).toEqual(["Evidence"]);
	expect(page).toMatchObject({ acknowledgment: "failed", last_confirmed_cursor: 0, acknowledged_through: null });
	expect(page.acknowledgment_reason).toContain("ack storage unavailable");
});

test("archive preserves kind and permits pin changes, while task and structural lifecycle remain owned", () => {
	const id = topic(["b"]);
	const message = perform("a", { action: "post", thread: id, body: "Current brief" }).message!;
	perform("b", { action: "archive", thread: id, body: "Concluded, not consensus" });
	expect(perform("a", { action: "pin", thread: id, seq: message.seq }).thread.pinned?.id).toBe(message.id);
	expect(() => perform("a", { action: "post", thread: id, body: "No" })).toThrow(/reopen/);
	perform("a", { action: "reopen", thread: id, body: "New evidence" });
	expect(conversationInfo(db, "a", id)).toMatchObject({ kind: "channel", archived: false });
	for (const action of ["archive", "reopen"] as const)
		expect(() => perform("a", { action, thread: "team:a", body: "Not generic" })).toThrow(/owned elsewhere/);
	db.prepare(
		"insert into threads(id,kind,subject,created_by,created_at) values ('task-owned','task','Work','a',1)",
	).run();
	db.prepare(
		"insert into thread_participants(thread_id,participant,delivery,read_up_to,joined_at) values ('task-owned','a','push',0,1)",
	).run();
	expect(() => perform("a", { action: "leave", thread: "task-owned" })).toThrow(/work assignment/);
	expect(() => perform("a", { action: "invite", thread: "task-owned", people: ["b"] })).toThrow(/work-owned/);
});

test("operator structural preview joins survive reconciliation without a guest grant", () => {
	expect(conversationInfo(db, "operator", "team:a")).toMatchObject({ access: true, following: false });
	perform("operator", { action: "join", thread: "team:a" });
	syncChannels(db, 30);
	expect(conversationInfo(db, "operator", "team:a")).toMatchObject({ access: true, following: true });
	expect(
		db.prepare("select invited from thread_participants where thread_id = 'team:a' and participant = 'operator'").get(),
	).toMatchObject({ invited: 0 });
	perform("operator", { action: "leave", thread: "team:a" });
	syncChannels(db, 31);
	expect(conversationInfo(db, "operator", "team:a")).toMatchObject({ access: true, following: false });
});

test("upgrade preserves legacy kinds and cursors while adding query and attempt capability", () => {
	db.prepare(
		"insert into threads(id,kind,subject,created_by,created_at,closed_at) values ('old-meeting','meeting','Review','a',1,2)",
	).run();
	for (const column of ["channel_type", "purpose", "scope_head", "pinned_seq"])
		db.exec(`alter table threads drop column ${column}`);
	db.exec("alter table thread_participants drop column following; alter table commands drop column result");
	db.exec(`pragma user_version = ${SCHEMA_VERSION - 1}`);
	expect(communicationAvailable(db)).toBe(false);
	expect(() => findChannels(db, "a", { limit: 1 })).toThrow(/Restart the session runtime/);
	migrate(db);
	expect(communicationAvailable(db)).toBe(true);
	expect(db.prepare("select kind,closed_at from threads where id = 'old-meeting'").get()).toMatchObject({
		kind: "meeting",
		closed_at: 2,
	});
	expect(db.prepare("select channel_type from threads where id = 'team:a'").get()).toMatchObject({
		channel_type: "team",
	});
	expect(
		db
			.prepare("select following,read_up_to from thread_participants where thread_id = 'team:a' and participant = 'a'")
			.get(),
	).toMatchObject({ following: 1, read_up_to: 0 });
});
