import { expect, test } from "vitest";
import { isOrgMoveRequest, isOrgStartRequest } from "../src/org.js";

const team = () => ({
	id: "draft-id",
	cwd: "/work/project",
	goal: "Deliver the agreed work.",
	positions: [
		{ id: "head", role: "coordinator", manager: null },
		{
			id: "report",
			person: "existing-person",
			manager: "head",
			name: "Existing Person",
			goal: "Retain existing work.",
		},
	],
});

test("move IPC accepts a person, a manager or explicit split, and the observed branch", () => {
	expect(isOrgMoveRequest({ person: "person", manager: "manager", branch: ["person", "report"] })).toBe(true);
	expect(isOrgMoveRequest({ person: "person", manager: null, branch: ["person"] })).toBe(true);
	for (const value of [
		null,
		"person",
		{},
		{ person: 3, manager: null, branch: ["person"] },
		{ person: "person", branch: ["person"] },
		{ person: "person", manager: false, branch: ["person"] },
		{ person: "person", manager: null },
		{ person: "person", manager: null, branch: "person" },
		{ person: "person", manager: null, branch: ["person", null] },
	])
		expect(isOrgMoveRequest(value)).toBe(false);
});

test("start IPC accepts a typed draft with optional existing identities and explicit subset choice", () => {
	expect(isOrgStartRequest(team())).toBe(true);
	expect(isOrgStartRequest({ ...team(), withReady: true })).toBe(true);
	expect(isOrgStartRequest({ ...team(), withReady: false })).toBe(true);
});

test("malformed start IPC fields are refused before reaching the controller", () => {
	for (const value of [
		null,
		[],
		{ ...team(), id: 1 },
		{ ...team(), cwd: null },
		{ ...team(), goal: ["work"] },
		{ ...team(), positions: {} },
		{ ...team(), positions: [null] },
		{ ...team(), withReady: "yes" },
	])
		expect(isOrgStartRequest(value)).toBe(false);
	for (const [field, value] of [
		["id", 3],
		["manager", undefined],
		["manager", false],
		["role", null],
		["person", {}],
		["name", []],
		["goal", false],
	] as const) {
		expect(isOrgStartRequest({ ...team(), positions: [{ id: "head", manager: null, [field]: value }] })).toBe(false);
	}
});
