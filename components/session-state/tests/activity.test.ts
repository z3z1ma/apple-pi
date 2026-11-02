import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { type ActivityItem, activityCursor, activityHealth, activityPage, triageActivity } from "../src/activity.js";
import { ActivityPoller } from "../src/activity-poller.js";
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
