import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { migrate } from "../../../components/session-state/src/schema.js";
import type { Commands, SendOptions } from "../src/backend/commands.js";
import { openDepartures } from "../src/backend/departures.js";
import { isRetirePeopleRequest, type RetirePeopleProgress, type RetirePeopleRequest } from "../src/departures.js";
import type { CommandResult } from "../src/world.js";

let dir: string;
let db: DatabaseSync;
let commands: Commands;
let departures: ReturnType<typeof openDepartures>;
const request = (): RetirePeopleRequest => ({
	id: "cleanup",
	reason: "Finished project",
	people: [
		{ person: "manager", handoff: true },
		{ person: "leaf", handoff: false },
		{ person: "other", handoff: false },
	],
});
function add(id: string, parent: string | null) {
	db.prepare(
		"insert into sessions (id, kind, cwd, reports_to, run_state, generation, source, updated_at) values (?, 'root', ?, ?, 'idle', 0, 'runtime', 0)",
	).run(id, dir, parent);
}
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "aw-departures-"));
	db = new DatabaseSync(join(dir, "state.db"));
	migrate(db);
	add("manager", null);
	add("leaf", "manager");
	add("other", null);
	commands = { send: vi.fn(async () => ({ ok: true as const })), close() {} };
	departures = openDepartures(join(dir, "state.db"), commands);
});
afterEach(() => {
	departures?.close();
	db?.close();
	rmSync(dir, { recursive: true, force: true });
});

test("sends only selected people, reports first, with each explicit handoff choice and operator authority", async () => {
	add("unselected", "other");
	const result = await departures.retirePeople({
		...request(),
		by: "someone-else",
		kind: "close",
	} as RetirePeopleRequest);
	expect(vi.mocked(commands.send).mock.calls.map(([id, command]) => ({ id, command }))).toEqual([
		{ id: "leaf", command: { kind: "retire", reason: "Finished project", by: "operator", handoff: false } },
		{ id: "manager", command: { kind: "retire", reason: "Finished project", by: "operator", handoff: true } },
		{ id: "other", command: { kind: "retire", reason: "Finished project", by: "operator", handoff: false } },
	]);
	expect(result.finished).toBe(true);
	expect(result.people.every((person) => person.state === "applied")).toBe(true);
});

test.each(["accepted", "delivered"] as const)(
	"waits beyond %s until report cleanup is applied and publishes truthful progress",
	async (stage) => {
		let finish!: (result: CommandResult) => void;
		vi.mocked(commands.send).mockImplementationOnce(async (_id, _command, options) => {
			options?.onReceipt?.(stage);
			return new Promise((resolve) => {
				finish = resolve;
			});
		});
		const updates: RetirePeopleProgress[] = [];
		departures.onRetirePeople((progress) => updates.push(progress));
		const pending = departures.retirePeople(request());
		expect(commands.send).toHaveBeenCalledTimes(1);
		expect(updates.at(-1)?.people.find((person) => person.person === "leaf")?.state).toBe(stage);
		expect(updates.at(-1)?.people.find((person) => person.person === "manager")?.state).toBe("pending");
		finish({ ok: true });
		await pending;
		expect(commands.send).toHaveBeenCalledTimes(3);
		// Earlier publications remain snapshots, not references mutated into success.
		expect(updates.find((update) => update.people.some((person) => person.state === stage))).toBeDefined();
	},
);

test.each(["failed", "uncertain"])(
	"a %s report blocks its selected ancestors but permits independent departures",
	async (state) => {
		add("head", null);
		db.prepare("update sessions set reports_to = 'head' where id = 'manager'").run();
		vi.mocked(commands.send).mockImplementationOnce(async (_id, _command, options) => {
			options?.onReceipt?.(state === "failed" ? "failed" : "accepted", "Unfinished assignment");
			return { ok: false, reason: "Unfinished assignment" };
		});
		const result = await departures.retirePeople({
			...request(),
			people: [...request().people, { person: "head", handoff: true }],
		});
		expect(vi.mocked(commands.send).mock.calls.map(([id]) => id)).toEqual(["leaf", "other"]);
		expect(result.people.find((person) => person.person === "leaf")).toMatchObject({
			state,
			reason: "Unfinished assignment",
		});
		for (const id of ["manager", "head"])
			expect(result.people.find((person) => person.person === id)?.state).toBe("blocked");
	},
);

test("same-operation checks retain command identities after controller recreation and coalesce while pending", async () => {
	let finish!: (result: CommandResult) => void;
	vi.mocked(commands.send).mockImplementationOnce(
		async () =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const first = departures.retirePeople(request());
	const duplicate = departures.retirePeople(request());
	await expect(departures.retirePeople({ ...request(), reason: "Different approval" })).rejects.toThrow(
		"different choices",
	);
	expect(commands.send).toHaveBeenCalledTimes(1);
	finish({ ok: true });
	expect(await first).toEqual(await duplicate);
	const original = vi
		.mocked(commands.send)
		.mock.calls.map(([id, command, options]) => [id, command, options?.commandId]);
	departures.close();
	departures = openDepartures(join(dir, "state.db"), commands);
	await departures.retirePeople(request());
	expect(
		vi
			.mocked(commands.send)
			.mock.calls.slice(3)
			.map(([id, command, options]) => [id, command, options?.commandId]),
	).toEqual(original);
});

test("quitting stops unsent requests, without cancelling the accepted departure", async () => {
	let finish!: (result: CommandResult) => void;
	vi.mocked(commands.send).mockImplementationOnce(async (_id, _command, options) => {
		options?.onReceipt?.("accepted");
		return new Promise((resolve) => {
			finish = resolve;
		});
	});
	const pending = departures.retirePeople(request());
	departures.close();
	finish({ ok: true });
	const result = await pending;
	expect(commands.send).toHaveBeenCalledTimes(1);
	expect(result.people.find((person) => person.person === "leaf")?.state).toBe("applied");
	expect(result.people.filter((person) => person.state === "blocked")).toHaveLength(2);
});

test("uses the runtime refusal for unselected reports instead of adding them or changing responsibilities", async () => {
	add("unselected", "manager");
	vi.mocked(commands.send).mockImplementation(async (id, _command, options?: SendOptions) => {
		if (id === "manager") {
			options?.onReceipt?.("failed", "Move reports first");
			return { ok: false, reason: "Move reports first" };
		}
		return { ok: true };
	});
	const result = await departures.retirePeople(request());
	expect(result.people.find((person) => person.person === "manager")).toMatchObject({
		state: "failed",
		reason: "Move reports first",
	});
	expect(vi.mocked(commands.send).mock.calls.some(([id]) => id === "unselected")).toBe(false);
	expect(db.prepare("select reports_to from sessions where id = 'unselected'").get()).toMatchObject({
		reports_to: "manager",
	});
});

test("refuses cycles before any departure and rejects invalid selection shapes", async () => {
	db.prepare("update sessions set reports_to = 'leaf' where id = 'manager'").run();
	const result = await departures.retirePeople(request());
	expect(result.people.every((person) => person.state === "blocked")).toBe(true);
	expect(commands.send).not.toHaveBeenCalled();
	for (const input of [
		null,
		{},
		{ ...request(), id: "" },
		{ ...request(), reason: " " },
		{ ...request(), people: [] },
		{ ...request(), people: [{ person: "leaf" }] },
		{ ...request(), people: [{ person: "leaf", handoff: "none" }] },
		{ ...request(), people: [request().people[0], request().people[0]] },
	])
		expect(isRetirePeopleRequest(input)).toBe(false);
	expect(isRetirePeopleRequest(request())).toBe(true);
});
