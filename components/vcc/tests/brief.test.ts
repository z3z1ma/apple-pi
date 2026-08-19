import { describe, expect, it } from "bun:test";
import { compileBrief } from "../src/core/brief.js";
import type { NormalizedBlock } from "../src/types.js";

describe("compileBrief", () => {
	it("returns empty string for no blocks", () => {
		expect(compileBrief([])).toBe("");
	});

	it("renders user and assistant text", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "user", text: "fix auth bug" },
			{ kind: "assistant", text: "Let me look at the auth module." },
		];
		const r = compileBrief(blocks);
		expect(r).toContain("[user]");
		expect(r).toContain("fix auth bug");
		expect(r).toContain("[assistant]");
		expect(r).toContain("Let me look at the auth module.");
	});

	it("renders bash commands as user actions", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "bash", command: "npm test", output: "FAIL noisy output", exitCode: 1, sourceIndex: 2 },
		];
		const r = compileBrief(blocks);
		expect(r).toContain("[user]\n$ npm test (#2)");
		expect(r).not.toContain("FAIL noisy output");
	});

	it("strips filler prefixes but preserves meaningful lead-ins", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "assistant", text: "Okay, I found the root cause." },
			{ kind: "assistant", text: "Actually, the issue is in middleware." },
			{ kind: "assistant", text: "Let me check the logs." },
		];
		const r = compileBrief(blocks);
		expect(r).toContain("I found the root cause.");
		expect(r).toContain("the issue is in middleware.");
		expect(r).toContain("Let me check the logs.");
	});

	it("collapses tool calls to one-liners under [assistant]", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "assistant", text: "Let me check." },
			{ kind: "tool_call", name: "Read", args: { file_path: "auth.ts" } },
			{ kind: "tool_call", name: "Edit", args: { file_path: "auth.ts" } },
		];
		const r = compileBrief(blocks);
		expect(r).toContain('* Read "auth.ts"');
		expect(r).toContain('* Edit "auth.ts"');
		// Should merge into single [assistant] section
		const matches = r.match(/\[assistant\]/g);
		expect(matches?.length).toBe(1);
	});

	it("keeps successful tool result bodies in the unbudgeted brief", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "tool_result", name: "Read", text: "const x = 1;\nconst y = 2;\n// lots of code", isError: false },
		];
		const r = compileBrief(blocks);
		expect(r).toContain("[tool_result] Read");
		expect(r).toContain("const x = 1");
	});

	it("keeps older successful tool results until compile packs the budget", () => {
		const blocks: NormalizedBlock[] = Array.from({ length: 10 }, (_, i) => ({
			kind: "tool_result" as const,
			name: "Read",
			text: `file ${i} contents`,
			isError: false,
		}));
		const r = compileBrief(blocks);
		expect(r).toContain("file 0 contents");
		expect(r).toContain("file 9 contents");
	});

	it("shows tool errors with first line", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "tool_result", name: "bash", text: "FAIL auth.test.ts\nexpected 200 got 401", isError: true },
		];
		const r = compileBrief(blocks);
		expect(r).toContain("[tool_error] bash");
		expect(r).toContain("FAIL auth.test.ts");
	});

	it("hides thinking blocks", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "thinking", text: "Let me think about this...", redacted: false },
			{ kind: "assistant", text: "Here's what I found." },
		];
		const r = compileBrief(blocks);
		expect(r).not.toContain("think");
		expect(r).toContain("Here's what I found.");
	});

	it("merges adjacent assistant sections", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "assistant", text: "First part." },
			{ kind: "tool_call", name: "Read", args: { file_path: "a.ts" } },
			// No user/tool_result between these — should merge
			{ kind: "assistant", text: "Second part." },
			{ kind: "tool_call", name: "Read", args: { file_path: "b.ts" } },
		];
		const r = compileBrief(blocks);
		const matches = r.match(/\[assistant\]/g);
		expect(matches?.length).toBe(1);
	});

	it("does NOT merge assistant after user", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "assistant", text: "First." },
			{ kind: "user", text: "Next task." },
			{ kind: "assistant", text: "Second." },
		];
		const r = compileBrief(blocks);
		const matches = r.match(/\[assistant\]/g);
		expect(matches?.length).toBe(2);
	});

	it("does not clip user or assistant text in the unbudgeted brief", () => {
		const longText = Array.from({ length: 300 }, (_, i) => `word${i}`).join(" ");
		const r = compileBrief([
			{ kind: "user", text: longText },
			{ kind: "assistant", text: longText },
		]);
		expect(r).not.toContain("(truncated)");
		expect(r).toContain("word299");
	});

	it("renders a realistic conversation flow", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "user", text: "fix the login bug" },
			{ kind: "thinking", text: "I need to check...", redacted: false },
			{ kind: "assistant", text: "Let me investigate." },
			{ kind: "tool_call", name: "Read", args: { file_path: "login.ts" } },
			{ kind: "tool_result", name: "Read", text: "export function login() { ... }", isError: false },
			{ kind: "tool_call", name: "bash", args: { command: "npm test" } },
			{ kind: "tool_result", name: "bash", text: "FAIL: login test\nExpected true, got false", isError: true },
			{ kind: "assistant", text: "The test is failing because..." },
			{ kind: "tool_call", name: "Edit", args: { file_path: "login.ts" } },
			{ kind: "tool_result", name: "Edit", text: "File edited successfully", isError: false },
			{ kind: "user", text: "test lại đi" },
			{ kind: "assistant", text: "Running tests again." },
			{ kind: "tool_call", name: "bash", args: { command: "npm test" } },
			{ kind: "tool_result", name: "bash", text: "All tests passed", isError: false },
		];
		const r = compileBrief(blocks);

		// Check structure
		expect(r).toContain("[user]\nfix the login bug");
		expect(r).toContain('[assistant]\nLet me investigate.\n* Read "login.ts"');
		expect(r).toContain("[tool_error] bash\nFAIL: login test");
		expect(r).toContain('[assistant]\nThe test is failing because...\n* Edit "login.ts"');
		expect(r).toContain("[user]\ntest lại đi");
		expect(r).toContain('[assistant]\nRunning tests again.\n* bash "npm test"');

		expect(r).not.toContain("think");
		expect(r).toContain("[tool_result] Read");
		expect(r).toContain("export function login");
		expect(r).toContain("File edited successfully");
		expect(r).toContain("All tests passed");
	});

	// ── noise filtering tests (aligned with VCC) ──

	it("suppresses blank lines between consecutive tool-only sections", () => {
		const blocks: NormalizedBlock[] = [
			{ kind: "assistant", text: "Checking files." },
			{ kind: "tool_call", name: "Read", args: { file_path: "a.ts" } },
			{ kind: "tool_result", name: "Read", text: "...", isError: false },
			// tool_result hidden → next tool_call starts new assistant section
			// but since both are tool-only, no blank line between
			{ kind: "tool_call", name: "Read", args: { file_path: "b.ts" } },
			{ kind: "tool_result", name: "Read", text: "...", isError: false },
		];
		const r = compileBrief(blocks);
		expect(r.match(/\[assistant\]/g)?.length).toBe(2);
		expect(r).toContain("[tool_result] Read");
	});

	it("keeps all tool-call one-liners in the unbudgeted brief", () => {
		const blocks: NormalizedBlock[] = [{ kind: "assistant", text: "Working." }];
		for (let i = 1; i <= 12; i++) {
			blocks.push({ kind: "tool_call", name: "bash", args: { command: `echo ${i}` } });
		}
		const r = compileBrief(blocks);
		expect(r).not.toContain("entries omitted");
		expect(r).toContain("echo 1");
		expect(r).toContain("echo 12");
	});
});
