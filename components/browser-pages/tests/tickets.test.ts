import { describe, expect, it } from "vitest";

import { graphProblems, parseTickets, ticketState } from "../src/tickets.js";

const ticket = (
	n: string,
	title: string,
	blockedBy: string,
	status = "ready-for-agent",
	boxes = "- [ ] One\n- [x] Two",
) => ({
	path: `tickets/${n}-${title.toLowerCase().replace(/\W+/g, "-")}.md`,
	source: `# ${n}: ${title}\n\n**What to build:** It.\n\n**Blocked by:** ${blockedBy}\n\n**Status:** ${status}\n\n${boxes}\n`,
});
const blockers = (files: ReturnType<typeof ticket>[]) =>
	Object.fromEntries(parseTickets(files).map((t) => [t.id, { blockers: t.blockers, unknown: t.unknown }]));

describe("parseTickets", () => {
	it("reads the number, title, status, and acceptance boxes", () => {
		const [t] = parseTickets([ticket("03", "Benchmark runner and report", "None (can start immediately).", "done.")]);
		expect(t).toEqual({
			id: 3,
			path: "tickets/03-benchmark-runner-and-report.md",
			title: "Benchmark runner and report",
			status: "done",
			blockers: [],
			unknown: [],
			done: 1,
			total: 2,
		});
	});

	it("reads blockers in the forms the ledger uses", () => {
		const others = ["01", "02", "03", "04"].map((n) => ticket(n, `T${n}`, "None (can start immediately)."));
		const with5 = (blockedBy: string) => blockers([...others, ticket("05", "Five", blockedBy)])[5];
		expect(with5("03: Benchmark runner and report.")).toEqual({ blockers: [3], unknown: [] });
		expect(with5("03 (Benchmark runner and report).")).toEqual({ blockers: [3], unknown: [] });
		expect(with5("01 (Challenger pass), 02 (Three trap puzzles with reference solutions).").blockers).toEqual([1, 2]);
		expect(with5("02: Build the subagent manager; 03: Add managed tasks to active-work surfaces").blockers).toEqual([
			2, 3,
		]);
		expect(with5("[01: Python programs](01-python.md) and [04](04-evidence.md)").blockers).toEqual([1, 4]);
		expect(with5("#02 and ticket 04").blockers).toEqual([2, 4]);
	});

	it("keeps a missing ticket as unknown, and ignores numbers in titles", () => {
		const files = [
			ticket("01", "One", "None."),
			ticket("02", "Retry 408 and 429 in phase 2", "01: One; 07: Report template."),
		];
		expect(blockers(files)[2]).toEqual({ blockers: [1], unknown: [7] });
		expect(blockers([...files, ticket("03", "Three", "02: Retry 408 and 429 in phase 2.")])[3]).toEqual({
			blockers: [2],
			unknown: [],
		});
	});
});

describe("the ticket graph", () => {
	it("reports a missing blocker, a later blocker, a cycle, and a ticket waiting on itself", () => {
		const tickets = parseTickets([
			ticket("01", "One", "None."),
			ticket("02", "Two", "04: Four; 07: Missing."),
			ticket("03", "Three", "02: Two."),
			ticket("04", "Four", "03: Three."),
			ticket("05", "Five", "05: Five."),
		]);
		expect(graphProblems(tickets)).toEqual([
			"02 waits on 07, which is not a ticket in this bundle.",
			"02 waits on a later ticket, 04; blockers come first.",
			"Cycle: 02 → 04 → 03 → 02. None of these can start.",
			"05 waits on itself.",
		]);
		expect(tickets.map((t) => ticketState(t, tickets))).toEqual([
			"frontier",
			"blocked",
			"blocked",
			"blocked",
			"blocked",
		]);
	});

	it("says so when no ticket can start, and passes a sound graph", () => {
		const loop = parseTickets([ticket("01", "One", "02: Two."), ticket("02", "Two", "01: One.")]);
		expect(graphProblems(loop)).toContain("No ticket can start: every ticket waits on another.");
		const sound = parseTickets([
			ticket("01", "One", "None.", "done"),
			ticket("02", "Two", "01: One.", "in-progress"),
			ticket("03", "Three", "01: One."),
			ticket("04", "Four", "02: Two; 03: Three."),
		]);
		expect(graphProblems(sound)).toEqual([]);
		expect(sound.map((t) => ticketState(t, sound))).toEqual(["done", "progress", "frontier", "blocked"]);
	});
});
