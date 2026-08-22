import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionContext, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { FooterSnapshot, TelemetrySession } from "../src/index.js";
import { collectInputCardSnapshot, collectUsageTotals, InputCardEditor, renderInputCard } from "../src/index.js";

const colorCodes: Record<string, number> = {
	accent: 35,
	dim: 90,
	error: 31,
	muted: 36,
	success: 32,
	text: 37,
	warning: 33,
	customMessageLabel: 95,
	mdLink: 96,
	syntaxFunction: 94,
	syntaxKeyword: 95,
	syntaxNumber: 91,
	syntaxString: 92,
	syntaxType: 96,
	syntaxVariable: 93,
	thinkingMedium: 93,
	thinkingText: 97,
};

const theme = {
	fg: (color: string, text: string) => `\u001b[${colorCodes[color] ?? 37}m${text}\u001b[0m`,
	bold: (text: string) => `\u001b[1m${text}\u001b[22m`,
} as unknown as Theme;

function usage(input: number, output: number, cacheRead: number, cacheWrite: number, cost: number): Usage {
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: input + output + cacheRead + cacheWrite,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
	};
}

function messageEntry(role: "assistant" | "toolResult", entryUsage?: Usage): never {
	return {
		type: "message",
		id: `${role}-test`,
		parentId: null,
		timestamp: new Date().toISOString(),
		message: { role, usage: entryUsage },
	} as never;
}

function summaryEntry(type: "branch_summary" | "compaction", entryUsage: Usage): never {
	return {
		type,
		id: `${type}-test`,
		parentId: null,
		timestamp: new Date().toISOString(),
		usage: entryUsage,
	} as never;
}

function footerData(
	statuses: Map<string, string>,
	branch: string | (() => string) = "main",
	onBranchChange: (callback: () => void) => () => void = () => () => {},
): ReadonlyFooterDataProvider {
	return {
		getGitBranch: () => (typeof branch === "function" ? branch() : branch),
		getExtensionStatuses: () => statuses,
		getAvailableProviderCount: () => 2,
		onBranchChange,
	};
}

function telemetrySession(entries: readonly never[], autoCompactionEnabled = true): TelemetrySession {
	return {
		sessionManager: { getEntries: () => entries },
		modelRuntime: { isUsingSubscription: () => true },
		autoCompactionEnabled,
	};
}

function contextFor(
	entries: readonly never[],
	statuses = new Map<string, string>(),
	branch: string | (() => string) = "main",
	onBranchChange: (callback: () => void) => () => void = () => () => {},
): { ctx: ExtensionContext; session: TelemetrySession; data: ReadonlyFooterDataProvider } {
	const session = telemetrySession(entries);
	const data = footerData(statuses, branch, onBranchChange);
	const ctx = {
		ui: { theme },
		mode: "tui",
		cwd: `${process.env.HOME ?? "/Users/test"}/project`,
		sessionManager: {
			getCwd: () => `${process.env.HOME ?? "/Users/test"}/project`,
			getSessionName: () => "work",
		},
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
	return { ctx, session, data };
}

const completeSnapshot: FooterSnapshot = {
	cwd: `${process.env.HOME ?? "/Users/test"}/project`,
	sessionName: "work",
	branch: "main",
	model: {
		provider: "openai",
		providerName: "OpenAI",
		id: "gpt-test",
		name: "GPT Test",
		reasoning: true,
		thinkingLevel: "high",
	},
	context: { percent: 32.8, contextWindow: 128_000 },
	usage: {
		input: 12_000,
		output: 4_000,
		cacheRead: 8_000,
		cacheWrite: 2_000,
		cost: 1.234,
		latestCacheHitRate: 36.4,
	},
	usingSubscription: true,
	autoCompactionEnabled: true,
	availableProviderCount: 2,
	statuses: [
		{ key: "subagents", text: "2 running agents" },
		{ key: "q-advisor", text: "Advisor reviewing · $0.42" },
		{ key: "backlog", text: "backlog 3" },
		{ key: "mcp-auth", text: "MCP authenticating docs" },
		{ key: "mcp", text: "MCP 3 servers" },
		{ key: "unknown", text: "Extension active" },
	],
};

describe("input card rendering", () => {
	it("composes a soft, inset prompt, metadata, divider, and compact strip", () => {
		const lines = renderInputCard(completeSnapshot, theme, 240, ["hello world"]);
		const output = lines.join("\n");
		const plainOutput = stripTerminalSequences(output);

		expect(stripTerminalSequences(lines[0] ?? "").trimStart()).toMatch(/^─/);
		expect(plainOutput).not.toMatch(/[╭╮│╰╯]/);
		expect(output).toContain("GPT Test");
		expect(plainOutput).toContain("GPT Test  OpenAI");
		expect(plainOutput).not.toContain("openai/GPT Test");
		expect(output).toContain("32.8%");
		expect(output).toContain("↑12k");
		expect(output).toContain("$1.234 (sub)");
		expect(output).toContain("(auto)");
		for (const status of completeSnapshot.statuses) expect(output.split(status.text).length - 1).toBe(1);
		expect(output).not.toMatch(/(?:project|model|provider|thinking|ctx|cost):/i);
	});

	it("right-aligns Fleet navigation opposite model metadata without duplicating it in the strip", () => {
		const hint = "esc to interrupt · ← for agents · ↓ to manage";
		const snapshot = {
			...completeSnapshot,
			statuses: [...completeSnapshot.statuses, { key: "subagents-navigation", text: hint }],
		};
		const lines = renderInputCard(snapshot, theme, 120, [""]);
		const plainLines = lines.map(stripTerminalSequences);
		const metadata = plainLines.find((line) => line.includes("GPT Test"))!;

		expect(metadata.trimStart()).toMatch(/^GPT Test {2}OpenAI · high/);
		expect(metadata.trimEnd().endsWith(hint)).toBe(true);
		expect(plainLines.join("\n").split(hint)).toHaveLength(2);

		const narrow = renderInputCard(snapshot, theme, 36, [""]).map(stripTerminalSequences);
		expect(narrow.some((line) => line.includes("GPT Test  OpenAI · high"))).toBe(true);
		expect(narrow.join("\n")).not.toContain("esc to interrupt");

		const withoutModel = renderInputCard({ ...snapshot, model: undefined }, theme, 120, [""])
			.map(stripTerminalSequences)
			.join("\n");
		expect(withoutModel).not.toContain(hint);
	});

	it("leaves native prompt text styling unchanged", () => {
		const nativePrompt = "hello \u001b[7mworld\u001b[0m again";
		const prompt = renderInputCard(completeSnapshot, theme, 80, [nativePrompt])[1]!;

		expect(prompt).toContain(nativePrompt);
		expect(prompt).not.toContain(`\u001b[35m${nativePrompt}`);
	});

	it("gives known component statuses and telemetry distinct semantic colors", () => {
		const output = renderInputCard(completeSnapshot, theme, 240, [""]).join("\n");

		expect(output).toContain("\u001b[33mMCP authenticating docs\u001b[0m");
		expect(output).toContain("\u001b[94mMCP 3 servers\u001b[0m");
		expect(output).toContain("\u001b[36mbacklog 3\u001b[0m");
		expect(output).toContain("\u001b[95mAdvisor reviewing · $0.42\u001b[0m");
		expect(output).toContain("\u001b[32m2 running agents\u001b[0m");
		expect(output).toContain("\u001b[36mExtension active\u001b[0m");
		expect(output).toContain("\u001b[93m↑12k\u001b[0m");
		expect(output).toContain("\u001b[32m↓4.0k\u001b[0m");
		expect(output).toContain("\u001b[91mR8.0k\u001b[0m");
		expect(output).toContain("\u001b[92mW2.0k\u001b[0m");
		expect(output).toContain("\u001b[96mCH36.4%\u001b[0m");
		expect(output).toContain("\u001b[33m$1.234 (sub)\u001b[0m");
		expect(output).toContain("\u001b[95m(auto)\u001b[0m");
	});

	it("restores producer color after nested status styling resets", () => {
		const advisorStatus = "\u001b[90m│\u001b[0m Advisor reviewing";
		const snapshot = {
			...completeSnapshot,
			statuses: [{ key: "q-advisor", text: advisorStatus }],
		};
		const output = renderInputCard(snapshot, theme, 120, [""]).join("\n");

		expect(output).toContain("\u001b[95m\u001b[90m│\u001b[0m\u001b[95m Advisor reviewing\u001b[0m");
		expect(stripTerminalSequences(output).split("│ Advisor reviewing")).toHaveLength(2);
	});

	it("uses a safe theme role for an unknown future thinking level", () => {
		const snapshot = {
			...completeSnapshot,
			model: { ...completeSnapshot.model!, thinkingLevel: "future" },
		};
		const output = renderInputCard(snapshot, theme, 120, [""]).join("\n");

		expect(output).toContain("\u001b[97m · future\u001b[0m");
	});

	it("uses the full terminal width rather than capping or centering wide cards", () => {
		const lines = renderInputCard(completeSnapshot, theme, 240, ["hello world"]);
		expect(visibleWidth(lines[0]!)).toBe(240);
		expect(stripTerminalSequences(lines[0]!)).toMatch(/^─+/);
	});

	it.each([1, 2, 3, 8, 20, 36, 80, 160])("fits every row within a %d-cell terminal", (width) => {
		const lines = renderInputCard(completeSnapshot, theme, width, ["a very long prompt with ANSI"]);
		expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
	});

	it("reflows before truncating lower-priority telemetry and marks omission", () => {
		const lines = renderInputCard(completeSnapshot, theme, 36, ["prompt"]);
		const output = lines.join("\n");
		expect(lines.length).toBeGreaterThan(5);
		expect(output).toContain("…");
		expect(output).toContain("GPT");
		expect(output).toContain("32.8%");
		expect(output).not.toMatch(/(?:project|model|provider|thinking|ctx|cost):/i);
	});

	it("omits empty statuses without inventing a status row", () => {
		const snapshot = { ...completeSnapshot, statuses: [] };
		const lines = renderInputCard(snapshot, theme, 160, [""]);
		expect(lines.every((line) => visibleWidth(line) > 0)).toBe(true);
		expect(lines.join("\n")).not.toContain("status:");
	});

	it("keeps the latest branch and status values in a card editor and disposes its listener", () => {
		const statuses = new Map([["mcp", "MCP connecting"]]);
		let branch = "main";
		let branchCallback: (() => void) | undefined;
		let requests = 0;
		const { ctx, session, data } = contextFor(
			[],
			statuses,
			() => branch,
			(callback) => {
				branchCallback = callback;
				return () => {
					branchCallback = undefined;
				};
			},
		);
		const tui = { terminal: { rows: 24 }, requestRender: () => requests++ } as never;
		const editorTheme = { borderColor: (text: string) => `\u001b[34m${text}\u001b[0m`, selectList: {} } as never;
		const editor = new InputCardEditor(ctx, session, tui, editorTheme, {} as never, data, theme);

		const initialRender = editor.render(100);
		expect(initialRender.join("\n")).toContain("MCP connecting");
		expect(initialRender[0]).not.toContain("\u001b[34m");
		branch = "feature/live";
		statuses.set("mcp", "MCP authenticated");
		branchCallback?.();
		expect(requests).toBe(1);
		expect(editor.render(100).join("\n")).toContain("feature/live");
		expect(editor.render(100).join("\n")).toContain("MCP authenticated");

		editor.dispose();
		branchCallback?.();
		expect(requests).toBe(1);
	});

	it("delegates editor input to Pi's native CustomEditor handler", () => {
		const { ctx, session, data } = contextFor([]);
		const tui = { terminal: { rows: 24 }, requestRender: () => {} } as never;
		const editorTheme = { borderColor: (text: string) => text, selectList: {} } as never;
		const editor = new InputCardEditor(ctx, session, tui, editorTheme, {} as never, data, theme);
		const nativeHandler = vi
			.spyOn(Object.getPrototypeOf(InputCardEditor.prototype), "handleInput")
			.mockImplementation(() => {});

		editor.handleInput("hello");
		expect(nativeHandler).toHaveBeenCalledWith("hello");
		nativeHandler.mockRestore();
	});
});

describe("input card telemetry", () => {
	it("accumulates native-equivalent usage from every session entry", () => {
		const entries = [
			messageEntry("assistant", usage(100, 20, 10, 5, 0.1)),
			messageEntry("toolResult", usage(3, 4, 0, 0, 0.2)),
			summaryEntry("branch_summary", usage(7, 8, 0, 0, 0.3)),
			summaryEntry("compaction", usage(11, 12, 0, 0, 0.4)),
			messageEntry("assistant", usage(40, 50, 20, 0, 0.5)),
		];
		const totals = collectUsageTotals(entries);

		expect(totals.input).toBe(161);
		expect(totals.output).toBe(94);
		expect(totals.cacheRead).toBe(30);
		expect(totals.cacheWrite).toBe(5);
		expect(totals.cost).toBeCloseTo(1.5);
		expect(totals.latestCacheHitRate).toBeCloseTo(33.333, 2);
	});

	it("reads native subscription and automatic-compaction state without guessing", () => {
		const { ctx, session, data } = contextFor([]);
		const snapshot = collectInputCardSnapshot(ctx, data, session);
		expect(snapshot.usingSubscription).toBe(true);
		expect(snapshot.autoCompactionEnabled).toBe(true);
		expect(snapshot.model?.name).toBe("GPT Test");
		expect(snapshot.model?.providerName).toBe("OpenAI");
	});
	it("orders todos after backlog and before advisor and subagents", () => {
		const snapshot = {
			...completeSnapshot,
			statuses: [
				{ key: "subagents", text: "agents 1" },
				{ key: "todos", text: "todos 2" },
				{ key: "q-advisor", text: "advisor idle" },
				{ key: "backlog", text: "backlog 1" },
			],
		};
		const output = stripTerminalSequences(renderInputCard(snapshot, theme, 240, ["prompt"]).join("\n"));
		expect(output.indexOf("backlog 1")).toBeLessThan(output.indexOf("todos 2"));
		expect(output.indexOf("todos 2")).toBeLessThan(output.indexOf("advisor idle"));
		expect(output.indexOf("advisor idle")).toBeLessThan(output.indexOf("agents 1"));
	});
});
