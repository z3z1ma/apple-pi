import { statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [path] = process.argv.slice(2);
if (!path) throw new Error("Pass the existing runtime database path.");
const db = new DatabaseSync(path, { readOnly: true });
try {
	db.exec("pragma query_only=on");
	const counts = {};
	for (const table of ["sessions", "messages", "events", "thread_messages", "commands"])
		counts[table] = db.prepare(`select count(*) as n from ${table}`).get().n;
	const payloadBytes = {};
	for (const [table, column] of [
		["messages", "preview"],
		["thread_messages", "body"],
		["commands", "command"],
	])
		payloadBytes[`${table}.${column}`] = db
			.prepare(`select sum(length(cast(${column} as blob))) as n from ${table}`)
			.get().n;
	console.log(
		JSON.stringify(
			{
				measuredAt: new Date().toISOString(),
				databaseBytes: statSync(path).size,
				walBytes: statSync(path + "-wal").size,
				counts,
				payloadBytes,
			},
			null,
			2,
		),
	);
} finally {
	db.close();
}
