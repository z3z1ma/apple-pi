import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import installLedger from "../../../extensions/ledger.js";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import bridge from "../src/index.js";
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
