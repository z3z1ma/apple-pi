import { expect, test } from "vitest";
import type { DormantAgent, WorldSnapshot } from "../src/world.js";
import { searchOrg } from "../web/workplace-org-search-model.js";

function person(id: string, name: string, manager: string | null, extra: Partial<DormantAgent> = {}): DormantAgent {
	return {
		id,
		name,
		role: "worker",
		reportsTo: manager,
		title: "Engineer",
		repository: null,
		cwd: "/work",
		task: null,
		stoppedAt: 1,
		stopReason: "exited",
		startedAt: 0,
		...extra,
	};
}
const world: WorldSnapshot = {
	connected: true,
	characters: [{ id: "awake", name: "Active Ada", role: "independent", place: { kind: "square" }, startedAt: 0 }],
	headquarters: [{ id: "old", name: "Original team", wings: [] }],
	dormant: [
		person("new", "Current team", null),
		person("moved", "Maya", "new", { task: { title: "Ship report", status: "in-progress", bundle: "/tasks/current" } }),
		person("temp", "Temporary Maya", "new", { temporary: true }),
		person("left", "Former Maya", "new", { retiredAt: 2 }),
	],
	workplace: {
		threads: [],
		tasks: [],
		escalations: [],
		workHistory: [
			{
				id: "closed-work",
				bundle: "/tasks/past",
				project: "/work",
				headquarters: "old",
				title: "Past report",
				status: "done",
				thread: "task:past",
				openedAt: 1,
				closedAt: 2,
				updatedAt: 2,
				participants: [{ person: "moved", assignedAt: 1, endedAt: 2, outcome: "finished", focused: false }],
			},
		],
	},
};

test("searches lasting people across names, roles, current tasks and current teams", () => {
	expect(searchOrg(world, "active ada").people).toEqual([
		expect.objectContaining({ id: "awake", name: "Active Ada", home: false }),
	]);
	expect(searchOrg(world, "maya").people).toEqual([
		expect.objectContaining({ id: "moved", name: "Maya", home: true, team: "new", teamName: "Current team" }),
	]);
	expect(searchOrg(world, "SHIP REPORT").people.map((person) => person.id)).toEqual(["moved"]);
	expect(searchOrg(world, "Current team").people.map((person) => person.id)).toEqual(["new", "moved"]);
	expect(searchOrg(world, "Engineer").people.map((person) => person.id)).toEqual(["new", "moved"]);
});

test("work search retains recorded organization after a participant moves", () => {
	const result = searchOrg(world, "Past report");
	expect(result.work).toHaveLength(1);
	expect(result.work[0]).toMatchObject({ id: "closed-work", headquarters: "old", organizationName: "Original team" });
	expect(searchOrg(world, "Original team").work.map((task) => task.id)).toEqual(["closed-work"]);
	expect(searchOrg(world, "Current team").work).toEqual([]);
});

test("blank and unmatched queries offer no people or work", () => {
	expect(searchOrg(world, "  ")).toEqual({ people: [], work: [] });
	expect(searchOrg(world, "no matching recorded metadata")).toEqual({ people: [], work: [] });
});
