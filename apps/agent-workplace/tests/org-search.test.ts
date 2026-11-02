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

test("custom organization names are searchable without renaming people or historical ownership", () => {
	const names = { new: "Reporting Team", old: "Original Archive" };
	expect(searchOrg(world, "reporting team", names).people.map((person) => person.id)).toEqual(["new", "moved"]);
	expect(searchOrg(world, "Maya", names).people).toEqual([
		expect.objectContaining({ id: "moved", name: "Maya", teamName: "Reporting Team" }),
	]);
	expect(searchOrg(world, "moved", names).people.map((person) => person.id)).toEqual(["moved"]);
	expect(searchOrg(world, "Current team", names).people.map((person) => person.id)).toEqual(["new", "moved"]);
	expect(searchOrg(world, "Original Archive", names).work).toEqual([
		expect.objectContaining({
			id: "closed-work",
			headquarters: "old",
			organizationName: "Original Archive",
			recordedTeam: null,
		}),
	]);
	expect(searchOrg(world, "Reporting Team", names).work).toEqual([]);
	expect(searchOrg(world, "Original team", names).work.map((task) => task.id)).toEqual(["closed-work"]);
	expect(
		searchOrg(world, "Renamed again", { ...names, new: "Renamed again" }).people.map((person) => person.id),
	).toEqual(["new", "moved"]);
});

test("recorded work offers a team route only while its own anchor is a visible current root", () => {
	const route = (extra: Partial<DormantAgent> = {}) =>
		searchOrg({ ...world, dormant: [...world.dormant!, person("old", "Original head", null, extra)] }, "Past report", {
			old: "Archive Team",
		}).work[0];
	expect(searchOrg(world, "Past report").work[0].recordedTeam).toBeNull();
	expect(route()).toMatchObject({ headquarters: "old", recordedTeam: "old", organizationName: "Archive Team" });
	for (const extra of [{ reportsTo: "new" }, { temporary: true }, { retiredAt: 2 }])
		expect(route(extra)).toMatchObject({ headquarters: "old", recordedTeam: null });
});

test("blank and unmatched queries offer no people or work", () => {
	expect(searchOrg(world, "  ")).toEqual({ people: [], work: [] });
	expect(searchOrg(world, "no matching recorded metadata")).toEqual({ people: [], work: [] });
});
