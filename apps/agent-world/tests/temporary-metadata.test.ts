import { DatabaseSync } from "node:sqlite";
import { expect, test, vi } from "vitest";
import {
	fakeBridge,
	standInProcess,
	startRuntime,
	stopRuntime,
	tempStateDir,
} from "../../../components/session-state/tests/helpers.js";
import { openWorldBackend } from "../src/backend/world-backend.js";

test("World retains temporary people and exposes their durable identity while awake and at home", async () => {
	const state = tempStateDir();
	const process = standInProcess();
	await startRuntime(state.socketPath);
	const links = [];
	for (const id of ["lasting", "created", "observed", "discarded", "launch", "lasting-report"])
		links.push(
			await fakeBridge(state.socketPath, id, process.pid, process.startedAt, {
				facts: id === "lasting" ? { manages: true } : { reportsTo: id === "lasting-report" ? "created" : "lasting" },
			}),
		);
	let world = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
	const metadata = () =>
		Object.fromEntries(world.snapshot().characters.map((person) => [person.id, person.facts?.temporary]));
	const expected = {
		lasting: false,
		created: true,
		observed: true,
		discarded: false,
		launch: true,
		"lasting-report": false,
	};
	try {
		await vi.waitFor(() => expect(world.snapshot().characters).toHaveLength(6), { timeout: 10000 });
		expect(Object.values(metadata())).toEqual([false, false, false, false, false, false]);
		const db = new DatabaseSync(state.dbPath);
		try {
			db.exec("begin");
			for (const [person, type] of [
				["created", "program_peer_created"],
				["observed", "program_peer_observed"],
				["launch", "facts"],
			])
				db.prepare("insert into events (at, source, session_id, type, data) values (?, 'runtime', ?, ?, '{}')").run(
					Date.now(),
					person,
					type,
				);
			db.prepare(
				"insert into program_peers (session_id, program_id, created_by, task_id) values ('launch', 'scope', 'lasting', 'goal')",
			).run();
			db.exec("commit");
		} finally {
			db.close();
		}
		await vi.waitFor(() => expect(metadata()).toEqual(expected), { timeout: 10000 });
		// A lasting person reporting to a temporary manager keeps its own identity.
		expect(world.snapshot().characters.find((person) => person.id === "lasting-report")?.facts?.reportsTo).toBe(
			"created",
		);
		for (const link of links.slice(1)) link.send({ type: "shutdown", reason: "quit" });
		await vi.waitFor(() => expect(world.snapshot().dormant).toHaveLength(5), { timeout: 10000 });
		const sleeping = () => Object.fromEntries(world.snapshot().dormant!.map((person) => [person.id, person.temporary]));
		expect(sleeping()).toEqual({
			created: true,
			observed: true,
			discarded: false,
			launch: true,
			"lasting-report": false,
		});
		const cleanup = new DatabaseSync(state.dbPath);
		try {
			cleanup.exec("begin");
			cleanup.prepare("delete from program_peers where session_id = 'launch'").run();
			for (const id of ["launch", "discarded"])
				cleanup
					.prepare(
						"insert into events (at, source, session_id, type, data) values (?, 'runtime', ?, 'person_discarded', '{}')",
					)
					.run(Date.now(), id);
			cleanup.exec("commit");
		} finally {
			cleanup.close();
		}
		await vi.waitFor(() => expect(sleeping().discarded).toBe(true), { timeout: 10000 });
		world.close();
		world = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
		await vi.waitFor(
			() => {
				expect(world.snapshot().connected).toBe(true);
				expect(sleeping()).toEqual({
					created: true,
					observed: true,
					discarded: true,
					launch: true,
					"lasting-report": false,
				});
			},
			{ timeout: 10000 },
		);
	} finally {
		world.close();
		for (const link of links) link.socket.destroy();
		process.child.kill();
		await stopRuntime(state);
	}
}, 25000);
