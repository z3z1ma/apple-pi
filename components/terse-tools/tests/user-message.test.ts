import { UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it } from "vitest";
import { formatUserMessage } from "../src/formatters.js";
import { installTerseToolRenderer, setActiveTheme } from "../src/patch.js";

const testTheme = {
	fg(color: string, text: string) {
		switch (color) {
			case "accent":
				return `\x1b[35m${text}\x1b[39m`;
			case "borderMuted":
			case "muted":
			case "dim":
				return `\x1b[2m${text}\x1b[22m`;
			case "userMessageText":
				return `\x1b[37m${text}\x1b[39m`;
			default:
				return text;
		}
	},
	bold(text: string) {
		return `\x1b[1m${text}\x1b[22m`;
	},
} as any;

describe("user message styling", () => {
	beforeAll(() => {
		setActiveTheme(testTheme);
		installTerseToolRenderer();
	});

	it("formats single-line user message with left accent rail and breathing lines", () => {
		const prompt = "Summarize the latest Zentui editor improvements.";
		const lines = formatUserMessage(prompt, 80, testTheme);

		// Structure:
		// 0: top breathing line with rail
		// 1: prompt content line with rail
		// 2: bottom breathing line with rail
		expect(lines).toHaveLength(3);

		// Terminal width constraint: all lines must fit within 80 cells
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(80);
		}

		const plain = lines.map(stripTerminalSequences);
		expect(plain[0]).toBe(`│ ${" ".repeat(78)}`);
		expect(plain[1]).toBe(`│ ${prompt}${" ".repeat(80 - 2 - prompt.length)}`);
		expect(plain[2]).toBe(`│ ${" ".repeat(78)}`);

		// Styling checks
		expect(lines[0]).toContain("\x1b[35m│\x1b[39m"); // accent rail
		expect(lines[1]).toContain("\x1b[35m│\x1b[39m"); // accent rail

		// OSC 133 prompt zone markers
		expect(lines[0]).toContain("\x1b]133;A\x07");
		expect(lines[2]).toContain("\x1b]133;B\x07\x1b]133;C\x07");
	});

	it("formats multiline user message with left accent rail on every row", () => {
		const prompt = "First paragraph of instruction.\n\nSecond paragraph of instruction.";
		const lines = formatUserMessage(prompt, 80, testTheme);

		expect(lines.length).toBeGreaterThan(2);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(80);
		}

		const plain = lines.map(stripTerminalSequences);
		// Every line starts with the rail
		for (const p of plain) {
			expect(p.startsWith("│ ")).toBe(true);
		}
	});

	it("handles narrow terminal widths gracefully", () => {
		expect(formatUserMessage("test", 0, testTheme)).toEqual([]);
		expect(stripTerminalSequences(formatUserMessage("test", 2, testTheme)[0]!)).toBe("te");

		const narrow = formatUserMessage("test", 10, testTheme);
		expect(narrow.length).toBeGreaterThanOrEqual(3);
		for (const line of narrow) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(10);
		}
	});

	it("handles empty or whitespace-only messages without breaking", () => {
		const lines = formatUserMessage("", 60, testTheme);
		expect(lines.length).toBeGreaterThanOrEqual(3);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(60);
		}
	});

	it("renders through UserMessageComponent.prototype.render integration", () => {
		const comp = new UserMessageComponent("Hello from test user prompt");
		const lines = comp.render(80);

		expect(lines).toHaveLength(3);
		const plain = lines.map(stripTerminalSequences);
		expect(plain[0]).toBe(`│ ${" ".repeat(78)}`);
		expect(plain[1]).toContain("Hello from test user prompt");
		expect(plain[2]).toBe(`│ ${" ".repeat(78)}`);

		// Re-rendering returns cached result
		const cachedLines = comp.render(80);
		expect(cachedLines).toBe(lines);

		// Invalidating clears cache
		comp.invalidate();
		const refreshedLines = comp.render(80);
		expect(refreshedLines).not.toBe(lines);
		expect(refreshedLines).toEqual(lines);
	});
});
