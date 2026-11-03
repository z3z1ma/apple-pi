import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { migrate } from "../../../components/session-state/src/schema.js";
import type { Commands, SendOptions } from "../src/backend/commands.js";
import { openDepartures } from "../src/backend/departures.js";
import type { RetirePeopleProgress, RetirePeopleRequest } from "../src/departures.js";
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
	const sent = vi.mocked(commands.send).mock.calls.map(([id, command]) => ({ id, command }));
	expect([...sent].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
		{ id: "leaf", command: { kind: "retire", reason: "Finished project", by: "operator", handoff: false } },
		{ id: "manager", command: { kind: "retire", reason: "Finished project", by: "operator", handoff: true } },
		{ id: "other", command: { kind: "retire", reason: "Finished project", by: "operator", handoff: false } },
	]);
	expect(sent.findIndex(({ id }) => id === "leaf")).toBeLessThan(sent.findIndex(({ id }) => id === "manager"));
	expect(result.finished).toBe(true);
	expect(result.people.every((person) => person.state === "applied")).toBe(true);
});

test.each(["accepted", "delivered"] as const)(
	"waits beyond %s until report cleanup is applied and publishes truthful progress",
	async (stage) => {
		let finish!: (result: CommandResult) => void;
		vi.mocked(commands.send).mockImplementation(async (id, _command, options) => {
			if (id !== "leaf") return { ok: true };
			options?.onReceipt?.(stage);
			return new Promise((resolve) => {
				finish = resolve;
			});
		});
		const updates: RetirePeopleProgress[] = [];
		departures.onRetirePeople((progress) => updates.push(progress));
		const pending = departures.retirePeople(request());
		expect(vi.mocked(commands.send).mock.calls.some(([id]) => id === "manager")).toBe(false);
		expect(updates.at(-1)?.finished).toBe(false);
		expect(updates.at(-1)?.people.find((person) => person.person === "leaf")?.state).toBe(stage);
		expect(updates.at(-1)?.people.find((person) => person.person === "manager")?.state).toBe("pending");
		finish({ ok: true });
		const result = await pending;
		expect(
			vi
				.mocked(commands.send)
				.mock.calls.map(([id]) => id)
				.sort(),
		).toEqual(["leaf", "manager", "other"]);
		expect(result.finished).toBe(true);
		expect(result.people.every((person) => person.state === "applied")).toBe(true);
		expect(updates.find((update) => update.people.some((person) => person.state === stage))).toBeDefined();
	},
);

test.each(["failed", "uncertain"])(
	"a %s report blocks its selected ancestors but permits independent departures",
	async (state) => {
		add("head", null);
		db.prepare("update sessions set reports_to = 'head' where id = 'manager'").run();
		vi.mocked(commands.send).mockImplementation(async (id, _command, options) => {
			if (id !== "leaf") return { ok: true };
			options?.onReceipt?.(state === "failed" ? "failed" : "accepted", "Unfinished assignment");
			return { ok: false, reason: "Unfinished assignment" };
		});
		const result = await departures.retirePeople({
			...request(),
			people: [...request().people, { person: "head", handoff: true }],
		});
		expect(
			vi
				.mocked(commands.send)
				.mock.calls.map(([id]) => id)
				.sort(),
		).toEqual(["leaf", "other"]);
		expect(result.people.find((person) => person.person === "leaf")).toMatchObject({
			state,
			reason: "Unfinished assignment",
		});
		for (const id of ["manager", "head"])
			expect(result.people.find((person) => person.person === id)?.state).toBe("blocked");
	},
);

test("rechecking the same approved batch retains command identities and shares pending departures", async () => {
	let finish!: (result: CommandResult) => void;
	vi.mocked(commands.send).mockImplementation(async (id) => {
		if (id !== "leaf") return { ok: true };
		return new Promise((resolve) => {
			finish = resolve;
		});
	});
	const first = departures.retirePeople(request());
	const duplicate = departures.retirePeople(request());
	await expect(departures.retirePeople({ ...request(), reason: "Different approval" })).rejects.toThrow();
	expect(vi.mocked(commands.send).mock.calls.filter(([id]) => id === "leaf")).toHaveLength(1);
	finish({ ok: true });
	expect(await first).toEqual(await duplicate);
	vi.mocked(commands.send).mockResolvedValue({ ok: true });
	const original = vi
		.mocked(commands.send)
		.mock.calls.map(([id, command, options]) => ({ id, command, commandId: options?.commandId }))
		.sort((a, b) => a.id.localeCompare(b.id));
	for (const { commandId } of original) expect(commandId).toMatch(/\S/);
	expect(new Set(original.map(({ commandId }) => commandId)).size).toBe(original.length);
	departures.close();
	departures = openDepartures(join(dir, "state.db"), commands);
	await departures.retirePeople(request());
	expect(
		vi
			.mocked(commands.send)
			.mock.calls.slice(3)
			.map(([id, command, options]) => ({ id, command, commandId: options?.commandId }))
			.sort((a, b) => a.id.localeCompare(b.id)),
	).toEqual(original);
});

test("quitting stops unsent requests, without cancelling the accepted departure", async () => {
	let finish!: (result: CommandResult) => void;
	vi.mocked(commands.send).mockImplementation(async (id, _command, options) => {
		if (id !== "leaf") return { ok: true };
		options?.onReceipt?.("accepted");
		return new Promise((resolve) => {
			finish = resolve;
		});
	});
	const pending = departures.retirePeople({ ...request(), people: request().people.slice(0, 2) });
	departures.close();
	finish({ ok: true });
	const result = await pending;
	expect(commands.send).toHaveBeenCalledTimes(1);
	expect(result.people.find((person) => person.person === "leaf")?.state).toBe("applied");
	expect(result.people.find((person) => person.person === "manager")?.state).toBe("blocked");
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
	expect(vi.mocked(commands.send).mock.calls.every(([, command]) => command.kind === "retire")).toBe(true);
});

test("refuses cyclic reporting before sending any departure", async () => {
	db.prepare("update sessions set reports_to = 'leaf' where id = 'manager'").run();
	const result = await departures.retirePeople(request());
	expect(result.people.every((person) => person.state === "blocked")).toBe(true);
	expect(commands.send).not.toHaveBeenCalled();
});

test("invalid selections are refused at the batch API without issuing departures", async () => {
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
		await expect(departures.retirePeople(input as RetirePeopleRequest)).rejects.toThrow();
	expect(commands.send).not.toHaveBeenCalled();
});
