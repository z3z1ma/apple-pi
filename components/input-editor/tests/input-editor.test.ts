import type { ExtensionContext, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { FooterSnapshot } from "../src/index.js";
import { collectInputCardSnapshot, InputCardEditor, renderInputCard } from "../src/index.js";

const colorCodes: Record<string, number> = {
	accent: 35,
	dim: 90,
	muted: 36,
	syntaxType: 96,
	thinkingMedium: 93,
	thinkingText: 97,
};

const theme = {
	fg: (color: string, text: string) => `\u001b[${colorCodes[color] ?? 37}m${text}\u001b[0m`,
	bold: (text: string) => `\u001b[1m${text}\u001b[22m`,
} as unknown as Theme;

function footerData(statuses: Map<string, string>): ReadonlyFooterDataProvider {
	return {
		getGitBranch: () => "main",
		getExtensionStatuses: () => statuses,
		getAvailableProviderCount: () => 2,
		onBranchChange: () => () => {},
	};
}

function contextFor(statuses = new Map<string, string>()): {
	ctx: ExtensionContext;
	data: ReadonlyFooterDataProvider;
} {
	const data = footerData(statuses);
	const ctx = {
		ui: { theme },
		mode: "tui",
		cwd: `${process.env.HOME ?? "/Users/test"}/project`,
		model: {
			provider: "openai",
			id: "gpt-test",
			name: "GPT Test",
			reasoning: true,
			contextWindow: 128_000,
		},
		thinkingLevel: "high",
		modelRegistry: { getProviderDisplayName: () => "OpenAI" },
		getContextUsage: () => ({ tokens: 42_000, contextWindow: 128_000, percent: 32.8 }),
	} as unknown as ExtensionContext;
	return { ctx, data };
}

const completeSnapshot: FooterSnapshot = {
	model: {
		provider: "openai",
		providerName: "OpenAI",
		id: "gpt-test",
		name: "GPT Test",
		reasoning: true,
		thinkingLevel: "high",
	},
	context: { percent: 32.8 },
	statuses: [
		{ key: "subagents", text: "2 running agents" },
		{ key: "q-pair", text: "│ Pair programmer (reviewing): $0.42" },
		{ key: "backlog", text: "backlog 3" },
		{ key: "mcp", text: "MCP 3 servers enabled" },
	],
};

describe("input editor rendering", () => {
	it("keeps the custom editor with left rail and model metadata", () => {
		const lines = renderInputCard(completeSnapshot, theme, 120, ["hello world"]);
		const plain = lines.map(stripTerminalSequences);

		// 0: top breathing line
		expect(plain[0]).toBe(`│ ${" ".repeat(118)}`);
		// 1: prompt line
		expect(plain[1]).toBe(`│ hello world${" ".repeat(107)}`);
		// 2: breathing line before metadata
		expect(plain[2]).toBe(`│ ${" ".repeat(118)}`);
		// 3: metadata line with right-justified status
		expect(plain[3]).toMatch(/^│ GPT Test {2}OpenAI {2}high/);
		expect(plain[3].trimEnd().endsWith("pair · mcp:3 · ctx 32.8%")).toBe(true);
		expect(lines).toHaveLength(4);
	});

	it("renders the compact status in one muted style on the bottom editor line", () => {
		const output = renderInputCard(completeSnapshot, theme, 120, [""]).join("\n");
		expect(output).toContain("\u001b[36mpair · mcp:3 · ctx 32.8%\u001b[0m");
	});

	it("shows pair only while it is reviewing", () => {
		const idle = {
			...completeSnapshot,
			statuses: [
				{ key: "q-pair", text: "Pair programmer: $0.42" },
				{ key: "mcp", text: "3 servers enabled" },
			],
		};
		const output = stripTerminalSequences(renderInputCard(idle, theme, 120, [""]).join("\n"));
		expect(output).toContain("mcp:3 · ctx 32.8%");
		expect(output).not.toMatch(/\bpair\b/);
	});

	it.each([
		["MCP 2/5", "mcp:5"],
		["MCP connecting to 4 servers...", "mcp:4"],
		["1 server enabled (1 connected)", "mcp:1"],
		["mcp:3", "mcp:3"],
	])("derives the configured MCP server count from %s", (status, expected) => {
		const snapshot = { ...completeSnapshot, statuses: [{ key: "mcp", text: status }] };
		const output = stripTerminalSequences(renderInputCard(snapshot, theme, 120, [""]).join("\n"));
		expect(output).toContain(`${expected} · ctx 32.8%`);
	});

	it("omits MCP when no server count is available", () => {
		const snapshot = { ...completeSnapshot, statuses: [{ key: "mcp", text: "MCP authenticating" }] };
		const output = stripTerminalSequences(renderInputCard(snapshot, theme, 120, [""]).join("\n"));
		expect(output).toContain("ctx 32.8%");
		expect(output).not.toContain("mcp");
	});

	it("right-aligns context when no model metadata is present", () => {
		const lines = renderInputCard({ context: { percent: 0 }, statuses: [] }, theme, 30, [""]);
		const bottom = stripTerminalSequences(lines.at(-1)!);
		expect(bottom).toBe(`│ ${" ".repeat(20)}ctx 0.0%`);
	});

	it("preserves full model metadata at moderate width by dropping optional status parts before context", () => {
		const lines = renderInputCard(completeSnapshot, theme, 40, [""]);
		const bottom = stripTerminalSequences(lines.at(-1)!);
		expect(bottom).toContain("GPT Test  OpenAI  high");
		expect(bottom).toContain("ctx 32.8%");
		expect(bottom).not.toContain("pair");
		expect(bottom).not.toContain("mcp");
	});

	it("drops optional status parts when the terminal is narrow, keeping context", () => {
		const output = renderInputCard(completeSnapshot, theme, 18, ["prompt"]).map(stripTerminalSequences);
		expect(output.at(-1)).toContain("ctx 32.8%");
		expect(output.at(-1)).not.toContain("pair");
		expect(output.at(-1)).not.toContain("mcp");
	});

	it("does not render any bottom rail or former Starship footer", () => {
		const output = stripTerminalSequences(renderInputCard(completeSnapshot, theme, 240, ["hello"]).join("\n"));
		expect(output).not.toContain("~/project");
		expect(output).not.toContain("on ⑂ main");
		expect(output).not.toContain("$0.42");
		expect(output).not.toContain("running agents");
		expect(output.split("\n").some((line) => /^─+$/.test(line))).toBe(false);
	});

	it("shows fast mode beside thinking without adding a status", () => {
		const snapshot: FooterSnapshot = {
			...completeSnapshot,
			model: { ...completeSnapshot.model!, provider: "openai-codex" },
			fastModeEnabled: true,
			statuses: [...completeSnapshot.statuses, { key: "fast-mode", text: "fast" }],
		};
		const output = stripTerminalSequences(renderInputCard(snapshot, theme, 120, [""]).join("\n"));
		expect(output).toContain("OpenAI  high ⚡");
		expect(output).not.toMatch(/\bfast\b/);
	});

	it("leaves native prompt text styling unchanged", () => {
		const nativePrompt = "hello \u001b[7mworld\u001b[0m again";
		const prompt = renderInputCard(completeSnapshot, theme, 80, [nativePrompt]).find((line) =>
			line.includes(nativePrompt),
		)!;
		expect(prompt).toContain(nativePrompt);
		expect(prompt).not.toContain(`\u001b[35m${nativePrompt}`);
	});

	it.each([1, 2, 3, 8, 20, 36, 80, 160])("fits every row within a %d-cell terminal", (width) => {
		const lines = renderInputCard(completeSnapshot, theme, width, ["a very long prompt with ANSI"]);
		expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
	});

	it("switches rail color to bashMode when prompt begins with shell exclamation", () => {
		const lines = renderInputCard(completeSnapshot, theme, 80, ["!git status"]);
		expect(lines[0]).toContain("│");
		expect(lines[1]).toContain("!git status");
	});

	it("renders top and bottom borders only when viewport indicators exist", () => {
		const normal = renderInputCard(completeSnapshot, theme, 80, ["text"]).map(stripTerminalSequences);
		expect(normal.some((l) => l.includes("more"))).toBe(false);
		expect(normal.some((l) => /^─+$/.test(l))).toBe(false);

		const scrolled = renderInputCard(completeSnapshot, theme, 80, ["text"], {
			above: "4",
			below: "2",
		}).map(stripTerminalSequences);
		expect(scrolled[0]).toContain("↑ 4 more");
		expect(scrolled.at(-1)).toContain("↓ 2 more");
	});

	it("delegates editor input to Pi's native CustomEditor handler", () => {
		const { ctx, data } = contextFor();
		const tui = { terminal: { rows: 24 }, requestRender: () => {} } as never;
		const editorTheme = { borderColor: (text: string) => text, selectList: {} } as never;
		const editor = new InputCardEditor(ctx, tui, editorTheme, {} as never, data, theme);
		const nativeHandler = vi
			.spyOn(Object.getPrototypeOf(InputCardEditor.prototype), "handleInput")
			.mockImplementation(() => {});

		editor.handleInput("hello");
		expect(nativeHandler).toHaveBeenCalledWith("hello");
		nativeHandler.mockRestore();
	});
});

describe("input editor snapshot", () => {
	it("reads model, context, and extension status from public Pi APIs", () => {
		const statuses = new Map([
			["q-pair", "Pair programmer (reviewing): $0.00"],
			["mcp", "3 servers enabled"],
		]);
		const { ctx, data } = contextFor(statuses);
		const snapshot = collectInputCardSnapshot(ctx, data);
		expect(snapshot.model?.name).toBe("GPT Test");
		expect(snapshot.context?.percent).toBe(32.8);
		expect(snapshot.statuses).toEqual([
			{ key: "q-pair", text: "Pair programmer (reviewing): $0.00" },
			{ key: "mcp", text: "3 servers enabled" },
		]);
	});
});
