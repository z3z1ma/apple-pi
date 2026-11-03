import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { readCalendar, readGmail } from "../src/activity-sources.js";

const answers: Record<string, unknown> = {};
let dir = "";
let path = "";
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "gws-"));
	const fake = join(dir, "gws");
	writeFileSync(
		fake,
		`#!${process.execPath}\nconst args = process.argv.slice(2);\nconst params = JSON.parse(args[args.indexOf("--params") + 1]);\nconst key = args.filter((arg) => !arg.startsWith("--") && !/^\\d+$/.test(arg) && arg !== args[args.indexOf("--params") + 1]).join(" ") + (params.timeMin ? " window" : "") + (params.id ? " " + params.id : "");\nconst answers = JSON.parse(require("node:fs").readFileSync(${JSON.stringify(join(dir, "answers.json"))}, "utf8"));\nprocess.stderr.write("Using keyring backend: keyring\\n");\nprocess.stdout.write(JSON.stringify(answers[key] ?? {}) + "\\n");\n`,
	);
	chmodSync(fake, 0o755);
	path = process.env.PATH ?? "";
	process.env.PATH = `${dir}:${path}`;
});
afterEach(() => {
	process.env.PATH = path;
	for (const key of Object.keys(answers)) delete answers[key];
});
const answer = () => writeFileSync(join(dir, "answers.json"), JSON.stringify(answers));

const NOW = Date.parse("2026-11-02T15:00:00Z");
const me = { self: true, responseStatus: "needsAction" };
const event = (id: string, fields: Record<string, unknown>) => ({
	id,
	status: "confirmed",
	updated: "2026-11-02T14:00:00Z",
	created: "2026-11-02T13:00:00Z",
	start: { dateTime: "2026-11-05T19:00:00Z" },
	organizer: { email: "mark@acme.com" },
	attendees: [me, { email: "ana@acme.com" }],
	...fields,
});

test("calendar keeps what he would notice: one item per real change, never per attendee reply or occurrence", async () => {
	const weekly = event("series", { summary: "AI SDLC weekly", recurrence: ["RRULE:FREQ=WEEKLY"] });
	answers["calendar events list"] = {
		items: [
			weekly,
			event("series_20261112", { summary: "AI SDLC weekly", recurringEventId: "series" }),
			event("deleted", { status: "cancelled" }),
			event("past", { summary: "Old review", start: { dateTime: "2026-10-01T19:00:00Z" } }),
			event("declined", { summary: "Declined", attendees: [{ self: true, responseStatus: "declined" }] }),
			event("moved", {
				summary: "Design sync",
				created: "2026-09-01T00:00:00Z",
				attendees: [{ self: true, responseStatus: "accepted" }],
			}),
		],
	};
	answers["calendar events list window"] = {
		items: [
			event("soon", {
				summary: "Brainstorm",
				start: { dateTime: "2026-11-02T15:30:00Z" },
				attendees: [{ self: true, responseStatus: "accepted" }],
			}),
		],
	};
	answer();
	const signal = new AbortController().signal;
	const cursor = JSON.stringify({ updated: "2026-11-02T12:00:00Z", agenda: new Date(NOW).toLocaleDateString("sv") });
	const first = await readCalendar(cursor, NOW, signal);
	expect(first.items.map((item) => [item.kind, item.title, item.direct])).toEqual([
		["invited", "AI SDLC weekly", true],
		["changed", "Design sync", false],
		["starting_soon", "Brainstorm", true],
	]);
	expect(JSON.parse(first.cursor).updated).toBe("2026-11-02T14:00:00Z");

	answers["calendar events list"] = {
		items: [
			{
				...weekly,
				updated: "2026-11-02T14:30:00Z",
				attendees: [me, { email: "ana@acme.com", responseStatus: "accepted" }],
			},
		],
	};
	answer();
	const again = await readCalendar(first.cursor, NOW, signal);
	expect(again.items.find((item) => item.title === "AI SDLC weekly")?.id).toBe(first.items[0]!.id);
});

test("email sends mail a person wrote to him to the desk, and only lists automated mail and copies", async () => {
	answers["gmail users getProfile"] = { emailAddress: "alex@acme.com" };
	answers["gmail users messages list"] = { messages: [{ id: "m1" }, { id: "m2" }, { id: "m3" }] };
	const message = (id: string, headers: Record<string, string>, labels: string[] = ["INBOX"]) => ({
		id,
		threadId: `t-${id}`,
		internalDate: String(NOW - 1000),
		labelIds: labels,
		snippet: `snippet ${id}`,
		payload: { headers: Object.entries(headers).map(([name, value]) => ({ name, value })) },
	});
	answers["gmail users messages get m1"] = message("m1", {
		From: '"Ian P" <ian@acme.com>',
		To: "alex@acme.com",
		Subject: "Access",
	});
	answers["gmail users messages get m2"] = message(
		"m2",
		{ From: "Alerts <alerts@db.com>", To: "alex@acme.com", Subject: "Alert" },
		["INBOX", "CATEGORY_UPDATES"],
	);
	answers["gmail users messages get m3"] = message("m3", {
		From: "Ana <ana@acme.com>",
		To: "team@acme.com",
		Cc: "alex@acme.com",
		Subject: "FYI",
	});
	answer();
	const read = await readGmail(String(NOW - 60_000), NOW, new AbortController().signal);
	expect(read.items.map((item) => [item.kind, item.actor, item.title, item.direct])).toEqual([
		["email", "Ian P", "Access", true],
		["notification", "Alerts", "Alert", false],
		["cc", "Ana", "FYI", false],
	]);
	expect(read.cursor).toBe(String(NOW - 1000));
});
