import { describe, expect, it } from "bun:test";
import { extractCausalChain, identifyTurns } from "../src/core/brief.js";

describe("extractCausalChain", () => {
	it("extracts specific issue/fix markers", () => {
		const chain = extractCausalChain("The issue is a race in refresh. I will fix this by adding a mutex.");
		expect(chain.cause).toContain("a race");
		expect(chain.resolution).toBeTruthy();
	});

	it("does not treat bare because/since/wrong/missing as a cause", () => {
		expect(extractCausalChain("I skipped it because the test was already red.").cause).toBeNull();
		expect(extractCausalChain("I have been here since last week.").cause).toBeNull();
		expect(extractCausalChain("That is the wrong file to edit.").cause).toBeNull();
		expect(extractCausalChain("We are missing a couple of tests still.").cause).toBeNull();
	});
});

describe("identifyTurns causal gating", () => {
	it("omits causal fragments when the turn has no write and no failure", () => {
		const turns = identifyTurns([
			{ kind: "user", text: "Look at auth" },
			{ kind: "assistant", text: "The issue is a missing null check in refreshToken." },
			{ kind: "tool_call", name: "Read", args: { file_path: "auth.ts" } },
		]);
		expect(turns).toHaveLength(1);
		expect(turns[0].summary).not.toContain("missing null check");
	});

	it("includes causal fragments when the turn uses write_file", () => {
		const turns = identifyTurns([
			{ kind: "user", text: "Fix login" },
			{ kind: "assistant", text: "The issue is a missing null check. I will fix this by adding a guard." },
			{ kind: "tool_call", name: "write_file", args: { file_path: "auth.ts" } },
		]);
		expect(turns[0].summary).toContain("missing null check");
	});

	it("includes causal fragments when the turn writes a file", () => {
		const turns = identifyTurns([
			{ kind: "user", text: "Fix login" },
			{ kind: "assistant", text: "The issue is a missing null check. I will fix this by adding a guard." },
			{ kind: "tool_call", name: "Edit", args: { file_path: "auth.ts" } },
		]);
		expect(turns[0].summary).toContain("missing null check");
		expect(turns[0].summary).toContain("adding a guard");
		expect(turns[0].summary).toContain("edited");
	});

	it("includes causal fragments when the turn hits a failing tool", () => {
		const turns = identifyTurns([
			{ kind: "user", text: "Fix login" },
			{ kind: "assistant", text: "The issue is a race on refresh." },
			{ kind: "tool_result", name: "bash", text: "FAIL", isError: true },
		]);
		expect(turns[0].summary).toContain("a race on refresh");
	});
});
