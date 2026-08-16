import { describe, it, expect } from "bun:test";
import { textOf, thinkingOf, toolCallsOf, clip, firstLine } from "../src/core/content.js";

describe("textOf", () => {
	it("returns empty string for undefined content", () => {
		expect(textOf(undefined as any)).toBe("");
	});

	it("returns empty string for null content", () => {
		expect(textOf(null as any)).toBe("");
	});

	it("returns string content as-is", () => {
		expect(textOf("hello")).toBe("hello");
	});

	it("extracts text parts from array content", () => {
		const content = [
			{ type: "text" as const, text: "first" },
			{ type: "toolCall" as const, name: "x", id: "1", arguments: {} },
			{ type: "text" as const, text: "second" },
		];
		expect(textOf(content)).toBe("first\nsecond");
	});

	it("ignores thinking parts", () => {
		const content = [
			{ type: "thinking" as const, thinking: "let me think" },
			{ type: "text" as const, text: "here is the answer" },
		];
		expect(textOf(content)).toBe("here is the answer");
	});
});

describe("thinkingOf", () => {
	it("returns empty string for undefined content", () => {
		expect(thinkingOf(undefined as any)).toBe("");
	});

	it("returns empty string for string content", () => {
		expect(thinkingOf("hello")).toBe("");
	});

	it("extracts thinking parts from array content", () => {
		const content = [
			{ type: "thinking" as const, thinking: "let me think" },
			{ type: "text" as const, text: "here is the answer" },
		];
		expect(thinkingOf(content)).toBe("let me think");
	});

	it("joins multiple thinking parts", () => {
		const content = [
			{ type: "thinking" as const, thinking: "first thought" },
			{ type: "text" as const, text: "answer" },
			{ type: "thinking" as const, thinking: "second thought" },
		];
		expect(thinkingOf(content)).toBe("first thought\nsecond thought");
	});
});

describe("toolCallsOf", () => {
	it("returns empty string for undefined content", () => {
		expect(toolCallsOf(undefined as any)).toBe("");
	});

	it("returns empty string for string content", () => {
		expect(toolCallsOf("hello")).toBe("");
	});

	it("returns empty string when there are no toolCall parts", () => {
		const content = [
			{ type: "text" as const, text: "just text" },
			{ type: "thinking" as const, thinking: "just thinking" },
		];
		expect(toolCallsOf(content)).toBe("");
	});

	it("extracts string-valued args from a bash toolCall", () => {
		const content = [
			{ type: "text" as const, text: "running it" },
			{ type: "toolCall" as const, name: "bash", id: "1", arguments: { command: "grep DEV_API_KEY .dev.vars" } },
		];
		expect(toolCallsOf(content)).toBe("grep DEV_API_KEY .dev.vars");
	});

	it("joins multiple string args within one toolCall", () => {
		const content = [
			{ type: "toolCall" as const, name: "edit", id: "1", arguments: { path: "a.ts", oldText: "x", newText: "y" } },
		];
		expect(toolCallsOf(content)).toBe("a.ts\nx\ny");
	});

	it("joins args across multiple toolCall parts", () => {
		const content = [
			{ type: "toolCall" as const, name: "bash", id: "1", arguments: { command: "ls" } },
			{ type: "toolCall" as const, name: "bash", id: "2", arguments: { command: "pwd" } },
		];
		expect(toolCallsOf(content)).toBe("ls\npwd");
	});

	it("skips non-string args", () => {
		const content = [
			{ type: "toolCall" as const, name: "x", id: "1", arguments: { count: 3, flag: true, name: "keep" } },
		];
		expect(toolCallsOf(content)).toBe("keep");
	});
});
