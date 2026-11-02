import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import type { Departure } from "../../../components/session-state/src/departures.js";
import { migrate } from "../../../components/session-state/src/schema.js";
import { postToThread } from "../../../components/session-state/src/threads.js";
import { readMail, readStoredThread } from "../src/backend/mail.js";

test("removed authors retain their names in shared threads and legacy traffic without changing operator/live labels", () => {
	const db = new DatabaseSync(":memory:");
	try {
		migrate(db);
		for (const [id, name] of [
			["gone", "Retained Worker"],
			["present", "Current Worker"],
		])
			db.prepare(
				"insert into sessions (id,kind,cwd,run_state,generation,source,updated_at,name) values (?,'root','/not-read','idle',1,'fixture',0,?)",
			).run(id, name);
		expect(
			typeof postToThread(
				db,
				"gone",
				"shared-message",
				{
					thread: "shared",
					threadKind: "mail",
					subject: "Shared evidence",
					to: ["present", "operator"],
					body: "Shared outcome",
				},
				10,
			),
		).not.toBe("string");
		const departure: Departure = {
			commandId: "departure",
			reason: "The work ended",
			name: "Retained Worker",
			role: "implementation-engineer",
			title: "Implementation Engineer",
			reportsTo: "present",
			handoffFile: "/not-read/handoff.md",
			sessionFile: null,
		};
		db.prepare(
			"insert into events (at,source,session_id,type,data) values (20,'fixture','gone','person_departed',?)",
		).run(JSON.stringify(departure));
		for (const [id, from, to] of [
			["old-mail", "gone", "present"],
			["operator-mail", "operator", "gone"],
			["live-mail", "present", "operator"],
		])
			db.prepare(
				"insert into commands (command_id,session_id,kind,command,stage,created_at,updated_at) values (?,?,'mail',?,'applied',11,12)",
			).run(id, to, JSON.stringify({ kind: "mail", from, body: "Shared mail", sentAt: new Date(11).toISOString() }));
		db.prepare("delete from sessions where id='gone'").run();
		const shared = readStoredThread(db, "shared")!;
		expect(shared.messages[0]).toMatchObject({ from: "gone", name: "Retained Worker", body: "Shared outcome" });
		expect(shared.participants.find((person) => person.id === "gone")?.name).toBe("Retained Worker");
		expect(shared.participants.find((person) => person.id === "operator")?.name).toBe("operator");
		const traffic = readMail(db);
		expect(traffic.find((mail) => mail.id === "old-mail")).toMatchObject({
			fromName: "Retained Worker",
			toName: "Current Worker",
		});
		expect(traffic.find((mail) => mail.id === "operator-mail")).toMatchObject({
			fromName: "You",
			toName: "Retained Worker",
		});
		expect(traffic.find((mail) => mail.id === "live-mail")).toMatchObject({
			fromName: "Current Worker",
			toName: "operator",
		});
	} finally {
		db.close();
	}
});
