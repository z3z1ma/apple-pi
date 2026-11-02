import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import {
	type ActivityItem,
	activityCursor,
	activityHealth,
	activityPage,
	activityRules,
	addActivityRule,
	removeActivityRule,
	triageActivity,
} from "../src/activity.js";
import { ActivityPoller } from "../src/activity-poller.js";
import { readNotes, removeNote, writeNote } from "../src/notes.js";
import { migrate } from "../src/schema.js";
import type { ThreadPost } from "../src/threads.js";

const item = (id: string, at: number, direct: boolean, source: ActivityItem["source"] = "github"): ActivityItem => ({
	id: `${source}:${id}`,
	source,
	kind: direct ? "review_requested" : "comment",
	conversation: `${source}:repo#1`,
	title: `repo#1 ${id}`,
	actor: "ana",
	url: null,
	excerpt: null,
	at,
	direct,
});

function setup() {
	const db = new DatabaseSync(":memory:");
	migrate(db);
	const posts: { id: string; post: ThreadPost }[] = [];
	const prefer = (key: string, value: unknown) =>
		db
			.prepare("insert or replace into preferences (key, value, updated_at) values (?, ?, 0)")
			.run(key, JSON.stringify(value));
	const reads: string[] = [];
	const next: Record<string, ActivityItem[] | Error> = {};
	const poller = new ActivityPoller(
		db,
		(write) => {
			db.exec("begin");
			write((id, post) => posts.push({ id, post }));
			db.exec("commit");
		},
		async (source, cursor) => {
			reads.push(`${source}:${cursor ?? "-"}`);
			const value = next[source] ?? [];
			if (value instanceof Error) throw value;
			return { items: value, cursor: `after-${reads.length}` };
		},
	);
	return { db, posts, prefer, reads, next, poller };
}

test("a source is read only once the operator turns it on, and each new item is kept once", async () => {
	const { db, posts, prefer, reads, next, poller } = setup();
	next.github = [item("a", 1, true)];
	await poller.poll();
	expect(reads).toEqual([]);

	prefer("activity-triage", { github: "list" });
	await poller.poll();
	await poller.poll();
	expect(reads).toEqual(["github:-", "github:after-1"]);
	expect(activityPage(db, { limit: 10 }).map((stored) => stored.id)).toEqual(["github:a"]);
	expect(activityCursor(db, "github")).toBe("after-2");
	expect(posts).toEqual([]);
});

test("new items reach the desk's coordinator under each source's mode, and its decision is kept", async () => {
	const { db, posts, prefer, next, poller } = setup();
	prefer("desk", { thread: "topic:desk", person: "cora" });
	prefer("activity-triage", { github: "direct", jira: "all" });
	next.github = [item("review", 2, true), item("chatter", 3, false)];
	next.jira = [item("comment", 4, false, "jira")];
	await poller.poll();
	expect(posts.map((posted) => posted.post.thread)).toEqual(["activity:cora", "activity:cora"]);
	expect(posts[0]!.post).toMatchObject({ to: ["cora"], notify: ["cora"] });
	expect(posts[0]!.post.body).toContain("github:review");
	expect(posts[0]!.post.body).not.toContain("github:chatter");
	expect(posts[1]!.post.body).toContain("jira:comment");
	const delivered = activityPage(db, { limit: 10 }).filter((stored) => stored.deliveredAt !== null);
	expect(delivered.map((stored) => stored.id).sort()).toEqual(["github:review", "jira:comment"]);

	triageActivity(db, "cora", ["github:review"], { action: "task", note: "Assigned to Iris", ref: "work-1" }, 9);
	expect(activityPage(db, { limit: 10, untriaged: true }).map((stored) => stored.id)).toEqual([
		"jira:comment",
		"github:chatter",
	]);
	expect(activityPage(db, { limit: 1, source: "github" })[0]).toMatchObject({ id: "github:chatter", triage: null });
	expect(activityPage(db, { limit: 10 }).find((stored) => stored.id === "github:review")?.triage).toEqual({
		by: "cora",
		action: "task",
		note: "Assigned to Iris",
		ref: "work-1",
		at: 9,
	});
	expect(() => triageActivity(db, "cora", ["github:nope"], { action: "pass", note: "x" }, 9)).toThrow(
		"No activity item",
	);
	expect(() => triageActivity(db, "cora", ["github:review"], { action: "pass", note: " " }, 9)).toThrow("one line");
});

test("the newest matching rule hides, quiets, always triages or routes a new item, and is shown beside it", async () => {
	const { db, posts, prefer, next, poller } = setup();
	prefer("desk", { thread: "topic:desk", person: "cora" });
	prefer("activity-triage", { github: "direct" });
	addActivityRule(db, "r1", "cora", { match: { actor: "Ana" }, effect: "hide", note: "Bot" }, 1);
	addActivityRule(
		db,
		"r2",
		"cora",
		{ match: { words: "deploy" }, effect: "route", person: "iris", note: "Iris runs deploys" },
		2,
	);
	addActivityRule(db, "r3", "cora", { match: { place: "github:acme/api" }, effect: "triage", note: "Release repo" }, 3);
	expect(() => addActivityRule(db, "r4", "cora", { match: {}, effect: "hide", note: "x" }, 4)).toThrow(
		"something to match",
	);
	const at = (id: string, title: string, conversation: string, actor = "bo"): ActivityItem => ({
		...item(id, 5, false),
		title,
		conversation,
		actor,
	});
	next.github = [
		at("noise", "repo#1 chatter", "github:other/x#1", "ana"),
		at("deploy", "repo#2 deploy failed", "github:other/x#2"),
		at("release", "api#3 comment", "github:acme/api#3"),
		at("plain", "x#4 comment", "github:other/x#4"),
	];
	await poller.poll();
	expect(
		posts.map((posted) => [
			posted.post.thread,
			posted.post.body.includes("github:deploy"),
			posted.post.body.includes("github:release"),
		]),
	).toEqual([
		["activity:iris", true, false],
		["activity:cora", false, true],
	]);
	const listed = activityPage(db, { limit: 10 });
	expect(listed.map((stored) => stored.id).sort()).toEqual(["github:deploy", "github:plain", "github:release"]);
	expect(listed.find((stored) => stored.id === "github:deploy")?.rule).toEqual({
		id: "r2",
		effect: "route",
		note: "Iris runs deploys",
	});
	expect(activityPage(db, { limit: 10, hidden: true })).toHaveLength(4);
	removeActivityRule(db, "r1");
	expect(activityPage(db, { limit: 10 })).toHaveLength(4);
	expect(activityRules(db).map((rule) => rule.id)).toEqual(["r3", "r2"]);
});

test("notes keep what the organization learned and what they connect, found by words or by a ref", () => {
	const { db } = setup();
	const id = writeNote(
		db,
		"note-1",
		"scout",
		{
			title: "Webhook retries",
			body: "The Slack thread and PR #12 are the same bug.",
			topics: ["webhooks", " webhooks "],
			refs: ["github:1:2", "slack:dm:D1:1"],
		},
		1,
	);
	expect(readNotes(db, { words: "WEBHOOK bug", limit: 5 }).map((found) => found.id)).toEqual([id]);
	expect(readNotes(db, { ref: "slack:dm:D1:1", limit: 5 })[0]).toMatchObject({ topics: ["webhooks"], by: "scout" });
	expect(readNotes(db, { words: "deploy", limit: 5 })).toEqual([]);
	writeNote(db, "ignored", "cora", { update: id, body: "Same bug; Iris owns the fix." }, 2);
	expect(readNotes(db, { limit: 5 })[0]).toMatchObject({
		title: "Webhook retries",
		body: "Same bug; Iris owns the fix.",
		updatedAt: 2,
	});
	expect(() => writeNote(db, "note-2", "cora", { title: "Only a title" }, 3)).toThrow("title and a body");
	removeNote(db, id);
	expect(readNotes(db, { limit: 5 })).toEqual([]);
});

test("a failed read is reported on its source and keeps the cursor for the next read", async () => {
	const { db, prefer, reads, next, poller } = setup();
	prefer("activity-triage", { slack: "all" });
	next.slack = [item("dm", 1, true, "slack")];
	await poller.poll();
	next.slack = new Error("Slack signed you out: sign in again in Workplace Settings.");
	await poller.poll();
	expect(activityCursor(db, "slack")).toBe("after-1");
	expect(activityHealth(db)).toEqual([
		expect.objectContaining({ source: "slack", error: "Slack signed you out: sign in again in Workplace Settings." }),
	]);
	next.slack = [];
	await poller.poll();
	expect(reads.at(-1)).toBe("slack:after-1");
	expect(activityHealth(db)[0]!.error).toBeNull();
});
