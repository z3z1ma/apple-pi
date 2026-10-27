import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { migrate } from "../src/schema.js";

test("the type-read migration preserves recorded events and gives sparse chronological queries an indexed search", () => {
	const db = new DatabaseSync(":memory:");
	try {
		// Only the physical v29 event table is needed by this migration, not a full workplace fixture.
		db.exec(`create table events (
			seq integer primary key autoincrement, at integer not null, source text not null,
			session_id text, generation integer, type text not null, data text
		) strict;
		pragma user_version = 29;
		insert into events (at, source, session_id, generation, type, data) values
			(50, 'bridge', 'p', 1, 'cost_changed', '{"cost":1}'),
			(20, 'runtime', 'p', 1, 'retired', '{"reason":"example"}'),
			(30, 'bridge', 'p', 2, 'cost_changed', '{"cost":2}');
		with recursive n(x) as (values (1) union all select x + 1 from n where x < 1024)
		insert into events (at, source, type, data) select x, 'bridge', 'tool_started', '{}' from n;`);
		const before = db.prepare("select * from events order by seq").all();
		migrate(db);
		expect(db.prepare("select * from events order by seq").all()).toEqual(before);
		expect(db.prepare("select seq from events where type = 'cost_changed' order by seq").all()).toEqual([
			{ seq: 1 },
			{ seq: 3 },
		]);
		const plan = db
			.prepare("explain query plan select * from events where type = 'cost_changed' order by seq")
			.all() as { detail: string }[];
		expect(plan.some((step) => /SEARCH events.*INDEX/.test(step.detail))).toBe(true);
		migrate(db);
		expect(db.prepare("select * from events order by seq").all()).toEqual(before);
	} finally {
		db.close();
	}
});
