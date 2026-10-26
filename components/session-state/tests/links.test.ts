import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import installLedger from "../../../extensions/ledger.js";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import bridge from "../src/index.js";
import { waitsIn } from "../src/inspect.js";
import { recordLink, resolveLink } from "../src/links.js";
import { migrate } from "../src/schema.js";
import type { WorkTask } from "../src/work.js";
import { close, query, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
beforeAll(() => startRuntime(state.socketPath));
afterAll(() => stopRuntime(state));
const call = (name: string, args: Parameters<typeof fauxToolCall>[1]): Reply =>
	fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
type Link = {
	id: string;
	from_kind: string;
	from_id: string;
	to_kind: string;
	to_id: string;
	relation: string;
	reason: string | null;
	data: string | null;
	recorded_by: string;
	inferred: number;
	confidence: number | null;
	created_at: number;
	resolved_at: number | null;
	resolution: string | null;
};
const linkRow = (id: string) => query<Link>(state.dbPath, "select * from links where id = ?", id)[0];

async function person(manager?: string) {
	const script: Reply[] = [];
	const run = await fauxSession(
		[
			(pi) => {
				const getFlag = pi.getFlag.bind(pi);
				pi.getFlag = (name) => (name === "reports-to" && manager ? manager : getFlag(name));
				bridge(pi);
				installLedger(pi);
			},
		],
		(context) =>
			JSON.stringify(context.messages.at(-1)).includes("You have finished a task.")
				? fauxAssistantMessage("Nothing changed.")
				: (script.shift() ?? fauxAssistantMessage("noted")),
		["ledger_add", "ledger_status"],
	);
	const id = run.session.sessionManager.getSessionId();
	await vi.waitFor(() => expect(query(state.dbPath, "select 1 from sessions where id = ?", id)).toHaveLength(1), {
		timeout: 15000,
	});
	await run.session.prompt("ready");
	async function attempt(name: string, args: Parameters<typeof fauxToolCall>[1]) {
		await vi.waitFor(() => expect(run.session.isStreaming).toBe(false));
		script.push(call(name, args));
		await run.session.prompt(`call ${name}`);
		await vi.waitFor(() => expect(run.session.isStreaming).toBe(false));
		return run.session.messages.filter((m) => m.role === "toolResult").at(-1)!;
	}
	async function invoke<T = WorkTask>(name: string, args: Parameters<typeof fauxToolCall>[1]) {
		const result = await attempt(name, args);
		expect(result).toMatchObject({ isError: false });
		return result.details as unknown as T;
	}
	return { run, id, invoke, attempt };
}

test("anyone records a link between two things with its reason, data, and how sure they are", async () => {
	const manager = await person();
	const engineer = await person(manager.id);
	try {
		const task = await engineer.invoke("take_task", { goal: "Migrate the schema.", title: "Schema" });
		const link = await engineer.invoke<Link>("link", {
			from: `task:${task.id}`,
			to: `person:${manager.id}`,
			relation: "requires_decision",
			reason: "Which migration contract?",
			data: { options: ["expand", "contract"] },
			inferred: true,
			confidence: 0.6,
		});
		expect(linkRow(link.id)).toMatchObject({
			from_kind: "task",
			from_id: task.id,
			to_kind: "person",
			to_id: manager.id,
			relation: "requires_decision",
			reason: "Which migration contract?",
			data: JSON.stringify({ options: ["expand", "contract"] }),
			recorded_by: engineer.id,
			inferred: 1,
			confidence: 0.6,
			resolved_at: null,
		});
		expect(linkRow(link.id).created_at).toBeGreaterThan(0);
		const unsure = await engineer.attempt("link", {
			from: `task:${task.id}`,
			to: `person:${manager.id}`,
			relation: "blocks",
			inferred: true,
		});
		expect(unsure).toMatchObject({ isError: true });
		expect(JSON.stringify(unsure.content)).toContain("needs a confidence");
	} finally {
		await close(engineer.run);
		await close(manager.run);
	}
}, 30000);

test("only listed relations are accepted, and one more line in the list file accepts another", async () => {
	const who = await person();
	const list = fileURLToPath(new URL("../src/relations.json", import.meta.url));
	const original = readFileSync(list, "utf8");
	try {
		const refused = await who.attempt("link", { from: `person:${who.id}`, to: "file:README.md", relation: "mentors" });
		expect(refused).toMatchObject({ isError: true });
		expect(JSON.stringify(refused.content)).toContain("requires_decision");
		writeFileSync(list, original.replace("{\n", '{\n\t"mentors": "The first person mentors the second.",\n'));
		const link = await who.invoke<Link>("link", {
			from: `person:${who.id}`,
			to: "file:README.md",
			relation: "mentors",
			data: { since: "today" },
		});
		expect(linkRow(link.id)).toMatchObject({ relation: "mentors", data: JSON.stringify({ since: "today" }) });
	} finally {
		writeFileSync(list, original);
		await close(who.run);
	}
}, 30000);

test("a wait on a task resolves when the task closes done, never when it is cancelled or its person answers", async () => {
	const manager = await person();
	const engineer = await person(manager.id);
	try {
		const work = await engineer.invoke("take_task", { goal: "Ship the feature.", title: "Feature" });
		const fix = await engineer.invoke("take_task", { goal: "Fix the build.", title: "Build" });
		await manager.invoke("ledger_add", { title: "Pick a contract", description: "Decide", slug: "contract" });
		await manager.invoke("ledger_add", { title: "Old plan", description: "Maybe", slug: "old-plan" });
		const ledger = join(manager.run.cwd, ".ledger");
		const bundleOf = (slug: string) => join(ledger, readdirSync(ledger).find((name) => name.endsWith(`-${slug}`))!);
		const contract = bundleOf("contract");
		const oldPlan = bundleOf("old-plan");
		const wait = (to: string, relation: string) =>
			engineer.invoke<Link>("link", { from: `task:${work.id}`, to, relation });
		const onFix = [await wait(`task:${fix.id}`, "blocks"), await wait(`task:${fix.id}`, "requires_decision")];
		const onContract = [await wait(`task:${contract}`, "blocks"), await wait(`task:${contract}`, "requires_decision")];
		const onOldPlan = await wait(`task:${oldPlan}`, "blocks");
		const onManager = await wait(`person:${manager.id}`, "requires_decision");

		await engineer.invoke("focus", { task: fix.id });
		await engineer.invoke("finish_task", { outcome: "Build fixed." });
		for (const link of onFix) expect(linkRow(link.id).resolved_at).not.toBeNull();
		await manager.invoke("ledger_status", { task: basename(contract), status: "done" });
		for (const link of onContract) expect(linkRow(link.id).resolved_at).not.toBeNull();
		const late = await engineer.attempt("link", { from: `task:${work.id}`, to: `task:${fix.id}`, relation: "blocks" });
		expect(late).toMatchObject({ isError: true });
		expect(JSON.stringify(late.content)).toContain("already done");
		await manager.invoke("ledger_status", { task: basename(oldPlan), status: "cancelled" });
		expect(linkRow(onOldPlan.id).resolved_at).toBeNull();
		await manager.invoke("send_mail", { to: [engineer.id], subject: "Contract", body: "Use expand." });
		expect(linkRow(onManager.id).resolved_at).toBeNull();
	} finally {
		await close(engineer.run);
		await close(manager.run);
	}
}, 45000);

test("a link resolves by id once, with an optional word; an unknown id is refused", async () => {
	const who = await person();
	try {
		const finding = await who.invoke<Link>("link", {
			from: `person:${who.id}`,
			to: "file:src/app.ts",
			relation: "finds",
			reason: "Unchecked null on line 12",
		});
		const resolved = await who.invoke<Link>("link", { id: finding.id, resolution: "accepted" });
		expect(resolved).toMatchObject({ id: finding.id, resolution: "accepted" });
		const first = linkRow(finding.id);
		expect(first.resolved_at).not.toBeNull();
		const again = await who.attempt("link", { id: finding.id, resolution: "rejected" });
		expect(again).toMatchObject({ isError: true });
		expect(JSON.stringify(again.content)).toContain("already resolved");
		expect(linkRow(finding.id)).toMatchObject({ resolved_at: first.resolved_at, resolution: "accepted" });
		const unknown = await who.attempt("link", { id: "no-such-link" });
		expect(unknown).toMatchObject({ isError: true });
		expect(JSON.stringify(unknown.content)).toContain("No link no-such-link");
		for (const missing of ["thread:t-none", "message:m-none", "organization:o-none"]) {
			const refused = await who.attempt("link", { from: `person:${who.id}`, to: missing, relation: "finds" });
			expect(refused).toMatchObject({ isError: true });
			expect(JSON.stringify(refused.content)).toContain(`No ${missing.replace(":", " ")}`);
		}
	} finally {
		await close(who.run);
	}
}, 30000);

test("links stay inside an organization: another one's tasks and people cannot be linked, and its links cannot be resolved", async () => {
	const ours = await person();
	const theirs = await person();
	try {
		const secret = await theirs.invoke("take_task", { goal: "Plan the acquisition.", title: "Acquisition" });
		const planted = await ours.attempt("link", {
			from: `person:${ours.id}`,
			to: `task:${secret.id}`,
			relation: "blocks",
		});
		expect(planted).toMatchObject({ isError: true });
		expect(JSON.stringify(planted.content)).toContain("belongs to another organization");
		const aimed = await ours.attempt("link", {
			from: `person:${ours.id}`,
			to: `person:${theirs.id}`,
			relation: "finds",
		});
		expect(aimed).toMatchObject({ isError: true });
		const theirLink = await theirs.invoke<Link>("link", {
			from: `task:${secret.id}`,
			to: "file:plan.md",
			relation: "produced",
		});
		const resolved = await ours.attempt("link", { id: theirLink.id, resolution: "closed by a stranger" });
		expect(resolved).toMatchObject({ isError: true });
		expect(linkRow(theirLink.id).resolved_at).toBeNull();
		const scoped = await ours.attempt("org_waits", { person: theirs.id });
		expect(scoped).toMatchObject({ isError: true });
		expect(JSON.stringify(scoped.content)).toContain("is not in your organization");
	} finally {
		await close(theirs.run);
		await close(ours.run);
	}
}, 30000);

test("a legacy link with a missing recorder can be resolved through its surviving task ownership", () => {
	const db = new DatabaseSync(":memory:");
	migrate(db);
	for (const [id, manager] of [
		["root", null],
		["ada", "root"],
		["stranger", null],
	])
		db.prepare(
			"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at, reports_to) values (?, 'root', '/', 'idle', 1, 'test', 0, ?)",
		).run(id, manager);
	for (const task of ["t1", "t2"])
		db.prepare(
			"insert into work_tasks (id, bundle, project, organization, ephemeral, thread, opened_at) values (?, ?, '/', 'root', 1, ?, 0)",
		).run(task, `/${task}`, `task:${task}`);
	// Legacy links have no stored organization; only the task endpoints survive here.
	db.prepare(
		"insert into links (id, from_kind, from_id, to_kind, to_id, relation, recorded_by, inferred, created_at) values ('L', 'task', 't1', 'task', 't2', 'blocks', 'peer', 0, 1)",
	).run();
	expect(() => resolveLink(db, "stranger", "L", undefined, 2)).toThrow("belongs to another organization");
	resolveLink(db, "ada", "L", "done by hand", 2);
	expect(db.prepare("select resolved_at, resolution from links where id = 'L'").get()).toEqual({
		resolved_at: 2,
		resolution: "done by hand",
	});
	db.close();
});

test("the link-origin migration preserves legacy provenance and reports unrecoverable ownership", () => {
	const db = new DatabaseSync(":memory:");
	migrate(db);
	db.exec("alter table links drop column organization; pragma user_version = 26");
	db.prepare(
		"insert into links (id, from_kind, from_id, to_kind, to_id, relation, recorded_by, inferred, created_at) values ('legacy', 'file', 'a.ts', 'commit', 'abc', 'blocks', 'gone', 0, 1)",
	).run();
	migrate(db);
	expect(db.prepare("select organization, recorded_by from links where id = 'legacy'").get()).toEqual({
		organization: null,
		recorded_by: "gone",
	});
	expect(() => resolveLink(db, "root", "legacy", "done", 2)).toThrow("no recoverable organization");
	db.close();
});

test("artifact links retain their originating organization after recorder deletion and a merge", () => {
	const db = new DatabaseSync(":memory:");
	migrate(db);
	for (const [id, manager] of [
		["root", null],
		["peer", "root"],
		["adopter", null],
	] as const)
		db.prepare(
			"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at, reports_to) values (?, 'root', '/', 'idle', 1, 'test', 0, ?)",
		).run(id, manager);
	recordLink(
		db,
		"artifact",
		"peer",
		{ from: { kind: "file", id: "a.ts" }, to: { kind: "commit", id: "abc" }, relation: "blocks" },
		1,
	);
	db.prepare("delete from sessions where id = 'peer'").run();
	expect(() => resolveLink(db, "adopter", "artifact", "done", 2)).toThrow("another organization");
	db.prepare("update sessions set reports_to = 'adopter' where id = 'root'").run();
	resolveLink(db, "adopter", "artifact", "done", 3);
	expect(db.prepare("select organization, recorded_by, resolved_at from links where id = 'artifact'").get()).toEqual({
		organization: "root",
		recorded_by: "peer",
		resolved_at: 3,
	});
	db.close();
});

test("after a root joins another organization, its people keep linking and resolving their own work, now the merged organization's", () => {
	const db = new DatabaseSync(":memory:");
	migrate(db);
	for (const [id, manager] of [
		["aroot", null],
		["broot", null],
		["bob", "broot"],
	])
		db.prepare(
			"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at, reports_to) values (?, 'root', '/', 'idle', 1, 'test', 0, ?)",
		).run(id, manager);
	db.prepare(
		"insert into work_tasks (id, bundle, project, organization, ephemeral, thread, opened_at) values ('b-work', '/b', '/', 'broot', 1, 'task:b-work', 0)",
	).run();
	const wait = (id: string) =>
		recordLink(
			db,
			id,
			"bob",
			{
				from: { kind: "task", id: "b-work" },
				to: { kind: "person", id: "bob" },
				relation: "requires_decision",
			},
			1,
		);
	wait("before");
	recordLink(
		db,
		"org-before",
		"bob",
		{ from: { kind: "person", id: "bob" }, to: { kind: "organization", id: "broot" }, relation: "requires_decision" },
		1,
	);
	db.prepare("update sessions set reports_to = 'aroot' where id = 'broot'").run();
	resolveLink(db, "bob", "org-before", undefined, 2);
	wait("after");
	resolveLink(db, "bob", "before", "decided", 2);
	expect(db.prepare("select id, resolved_at from links order by id").all()).toEqual([
		{ id: "after", resolved_at: null },
		{ id: "before", resolved_at: 2 },
		{ id: "org-before", resolved_at: 2 },
	]);
	expect(waitsIn(db, "aroot", { cwd: "/", to: 3 }).targets.flatMap((t) => t.waits.map((w) => w.ref))).toEqual([
		"link:after",
	]);
});
