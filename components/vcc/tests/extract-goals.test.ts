import { describe, expect, it } from "bun:test";
import { extractGoals } from "../src/extract/goals.js";
import type { NormalizedBlock } from "../src/types.js";

describe("extractGoals", () => {
	it("returns empty for no blocks", () => {
		expect(extractGoals([])).toEqual([]);
	});

	it("returns empty when no user blocks", () => {
		const blocks: NormalizedBlock[] = [{ kind: "assistant", text: "hello" }];
		expect(extractGoals(blocks)).toEqual([]);
	});

	it("keeps first-message lines that carry a task verb", () => {
		const blocks: NormalizedBlock[] = [{ kind: "user", text: "Fix login bug\nCheck auth flow" }];
		expect(extractGoals(blocks)).toEqual(["Fix login bug"]);
	});

	it("takes up to 6 task-verb lines from first user block", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "user", text: "fix the login bug\ncheck auth flow\nupdate the tests\nrefactor utils\nclean up" },
		];
		expect(extractGoals(blocks)).toEqual(["fix the login bug", "update the tests", "refactor utils"]);
	});

	it("falls back to the first substantive line when no task verb is present", () => {
		const blocks: NormalizedBlock[] = [{ kind: "user", text: "first goal\nmore leftover context" }];
		expect(extractGoals(blocks)).toEqual(["first goal"]);
	});

	it("ignores subsequent non-task user blocks", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "user", text: "first goal" },
			{ kind: "assistant", text: "ok" },
			{ kind: "user", text: "second request" },
		];
		expect(extractGoals(blocks)).toEqual(["first goal"]);
	});

	it("detects scope change with explicit pivot constructions", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "user", text: "Fix login bug" },
			{ kind: "assistant", text: "ok" },
			{ kind: "user", text: "Change of plan, refactor the auth module" },
		];
		const goals = extractGoals(blocks);
		expect(goals).toContain("Fix login bug");
		expect(goals).toContain("[Scope change]");
		expect(goals.some((g) => g.includes("refactor"))).toBe(true);
	});

	it("detects scope change from now + task verb", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "user", text: "Fix login bug" },
			{ kind: "assistant", text: "done" },
			{ kind: "user", text: "Now implement the user registration flow" },
		];
		const goals = extractGoals(blocks);
		expect(goals).toContain("[Scope change]");
		expect(goals.some((g) => /registration/.test(g))).toBe(true);
	});

	it("keeps latest scope change only", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "user", text: "Fix login bug" },
			{ kind: "assistant", text: "done" },
			{ kind: "user", text: "Switch to the signup page" },
			{ kind: "assistant", text: "ok" },
			{ kind: "user", text: "Change of plan, implement password reset" },
		];
		const goals = extractGoals(blocks);
		const scopeIdx = goals.indexOf("[Scope change]");
		expect(goals[scopeIdx + 1]).toContain("password reset");
	});

	it("does not treat actually/instead as a scope change", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "user", text: "Fix login bug" },
			{ kind: "assistant", text: "ok" },
			{ kind: "user", text: "Actually that file is fine" },
		];
		const goals = extractGoals(blocks);
		expect(goals).toEqual(["Fix login bug"]);
	});

	it("does not treat can-you-add as a scope change or extra goal", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "user", text: "Fix login bug" },
			{ kind: "assistant", text: "ok" },
			{ kind: "user", text: "Can you add a log line" },
		];
		expect(extractGoals(blocks)).toEqual(["Fix login bug"]);
	});

	it("keeps task headlines that arrive after a pivot", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "user", text: "Fix login bug" },
			{ kind: "assistant", text: "ok" },
			{ kind: "user", text: "Switch to the signup page" },
			{ kind: "assistant", text: "ok" },
			{ kind: "user", text: "Add signup integration tests" },
		];
		const goals = extractGoals(blocks);
		expect(goals).toContain("[Scope change]");
		expect(goals.some((g) => /signup page/.test(g))).toBe(true);
		expect(goals).toContain("Add signup integration tests");
	});

	it("appends later task headlines without claiming a scope change", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "user", text: "Fix login bug" },
			{ kind: "assistant", text: "ok" },
			{ kind: "user", text: "Implement the user registration flow" },
		];
		const goals = extractGoals(blocks);
		expect(goals).not.toContain("[Scope change]");
		expect(goals).toContain("Fix login bug");
		expect(goals).toContain("Implement the user registration flow");
	});

	it("skips noise short user messages as goals", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "user", text: "ok" },
			{ kind: "assistant", text: "hello" },
			{ kind: "user", text: "Fix the authentication module" },
		];
		const goals = extractGoals(blocks);
		expect(goals[0]).toContain("Fix the authentication");
		expect(goals.some((g) => g === "ok")).toBe(false);
	});
});
