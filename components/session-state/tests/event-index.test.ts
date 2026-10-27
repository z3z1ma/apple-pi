import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { migrate } from "../src/schema.js";

test("the journal migration preserves recorded payloads, sequence and repeated-upgrade safety", () => {
	const db = new DatabaseSync(":memory:");
	try {
		// Only the physical v29 event table is needed by this migration, not a full workplace fixture.
		db.exec(`create table events (
			seq integer primary key autoincrement, at integer not null, source text not null,
			session_id text, generation integer, type text not null, data text
		) strict;
		pragma user_version = 29;
		insert into events (at, source, session_id, generation, type, data) values
			(50, 'bridge', 'p', 1, 'cost_changed', '{"from":0,"to":1}'),
			(20, 'runtime', 'p', 1, 'retired', '{"reason":"example"}'),
			(30, 'bridge', 'p', 2, 'cost_changed', '{"from":1,"to":2}'),
			(40, 'bridge', 'p', 2, 'tool_started', '{"arg":"synthetic tool detail"}');`);
		const before = db.prepare("select * from events order by seq").all();
		migrate(db);
		expect(db.prepare("select * from events order by seq").all()).toEqual(before);
		expect(db.prepare("select seq from events where type = 'cost_changed' order by seq").all()).toEqual([
			{ seq: 1 },
			{ seq: 3 },
		]);
		migrate(db);
		expect(db.prepare("select * from events order by seq").all()).toEqual(before);
	} finally {
		db.close();
	}
});
