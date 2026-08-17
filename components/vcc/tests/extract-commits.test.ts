import { describe, expect, it } from "bun:test";
import { extractCommits, formatCommits } from "../src/extract/commits.js";
import type { NormalizedBlock } from "../src/types.js";

describe("extractCommits", () => {
	it("pairs bash tool_call -m message with the following hash", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "tool_call", name: "bash", args: { command: 'git commit -m "feat: login"' } },
			{ kind: "tool_result", name: "bash", text: "[main abcdef1] feat: login", isError: false },
		];
		expect(extractCommits(blocks)).toEqual([{ hash: "abcdef1", message: "feat: login" }]);
	});

	it("accepts Bash tool name", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "tool_call", name: "Bash", args: { command: "git commit -m 'fix tests'" } },
			{ kind: "tool_result", name: "Bash", text: "[main 1234567] fix tests", isError: false },
		];
		expect(extractCommits(blocks)).toEqual([{ hash: "1234567", message: "fix tests" }]);
	});

	it("reads hash from bashExecution output", () => {
		const blocks: NormalizedBlock[] = [
			{
				kind: "bash",
				command: 'git commit -m "chore: bump"',
				output: "[main deadbee] chore: bump",
				exitCode: 0,
			},
		];
		expect(extractCommits(blocks)).toEqual([{ hash: "deadbee", message: "chore: bump" }]);
	});

	it("skips git commit without -m", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "tool_call", name: "bash", args: { command: "git commit --amend --no-edit" } },
		];
		expect(extractCommits(blocks)).toEqual([]);
	});

	it("formats most recent commits with hash prefix", () => {
		expect(formatCommits([{ hash: "abcdef1", message: "feat: login" }])).toEqual(["abcdef1: feat: login"]);
	});
});
