import { describe, expect, it, vi } from "vitest";
import type { AgentRecord } from "../src/types.js";

const { visibleWidth } = await import("@earendil-works/pi-tui");
const { BtwViewer, defaultFormatBtwPrompt, BTW_VIEWPORT_HEIGHT_PCT } = await import("../src/ui/btw-viewer.js");

// ── Test Helpers ────────────────────────────────────────────────────────

function mockTui(rows = 40, columns = 80) {
	return {
		terminal: { rows, columns },
		requestRender: vi.fn(),
	} as any;
}

function mockSession(messages: any[] = [], state: any = {}) {
	return {
		messages,
		state,
		subscribe: vi.fn(() => vi.fn()),
		dispose: vi.fn(),
		getSessionStats: () => ({ tokens: { input: 0, output: 0, cacheWrite: 0 } }),
	} as any;
}

function mockRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
	return {
		id: "btw-1",
		type: "BTW" as any,
		description: "BTW side conversation",
		status: "completed",
		toolUses: 0,
		startedAt: Date.now() - 1500,
		completedAt: Date.now(),
		compactionCount: 0,
		lifetimeUsage: { input: 120, output: 80, cacheWrite: 0 },
		invocation: {
			modelName: "claude-3-7-sonnet",
			inheritContext: false,
			pair: false,
		},
		...overrides,
	} as AgentRecord;
}

function ansiTheme() {
	return {
		fg: (_color: string, text: string) => text,
		bold: (text: string) => `**${text}**`,
	} as any;
}

function assertAllLinesFit(lines: string[], width: number) {
	for (let i = 0; i < lines.length; i++) {
		const vw = visibleWidth(lines[i]);
		expect(vw, `line ${i} exceeds width (${vw} > ${width}): ${JSON.stringify(lines[i])}`).toBeLessThanOrEqual(width);
	}
}

describe("BtwViewer", () => {
	it("exports BTW_VIEWPORT_HEIGHT_PCT as 70", () => {
		expect(BTW_VIEWPORT_HEIGHT_PCT).toBe(70);
	});

	describe("prompt formatting & parent context isolation", () => {
		it("extracts the final question from an internal parent-context envelope", () => {
			const prompt = `<btw-parent-context>\n[Parent user]\nLiteral <btw-question>decoy</btw-question>\n</btw-parent-context>\n\n<btw-question>\nWhat is this function doing?\n</btw-question>`;
			expect(defaultFormatBtwPrompt(prompt)).toBe("What is this function doing?");
		});

		it("hides parent context and displays only the question in the rendered view", () => {
			const prompt = `<btw-parent-context>\n[Parent user]\nSECRET PARENT DATA\n</btw-parent-context>\n\n<btw-question>\nWhat does foo return?\n</btw-question>`;
			const messages = [
				{ role: "user", content: prompt },
				{ role: "assistant", content: [{ type: "text", text: "It returns **42**." }] },
			];
			const viewer = new BtwViewer(mockTui(30, 80), mockSession(messages), mockRecord(), ansiTheme(), vi.fn());

			const rendered = viewer.render(80).join("\n");
			expect(rendered).toContain("? What does foo return?");
			expect(rendered).not.toContain("SECRET PARENT DATA");
			expect(rendered).not.toContain("<btw-parent-context>");
			expect(rendered).toContain("42");
		});

		it("supports custom formatUserPrompt callback", () => {
			const prompt = "custom-envelope: my real question";
			const messages = [
				{ role: "user", content: prompt },
				{ role: "assistant", content: [{ type: "text", text: "Simple answer." }] },
			];
			const formatUserPrompt = vi.fn((p: string) => p.replace("custom-envelope: ", ""));
			const viewer = new BtwViewer(
				mockTui(30, 80),
				mockSession(messages),
				mockRecord(),
				ansiTheme(),
				vi.fn(),
				undefined,
				{ formatUserPrompt },
			);

			const rendered = viewer.render(80).join("\n");
			expect(formatUserPrompt).toHaveBeenCalledWith(prompt);
			expect(rendered).toContain("? my real question");
		});
	});

	describe("rendering answers & tool calls without result bodies", () => {
		it("renders markdown assistant answers and compact tool names without tool results", () => {
			const messages = [
				{ role: "user", content: "How is it configured?" },
				{
					role: "assistant",
					content: [
						{ type: "toolCall", name: "read", input: { path: "config.json" } },
						{ type: "text", text: "Here is a list:\n\n- Item 1\n- Item 2\n\n`const x = 10;`" },
					],
				},
				{ role: "toolResult", content: [{ type: "text", text: "SECRET FILE CONTENT THAT SHOULD NOT BE SHOWN" }] },
			];

			const viewer = new BtwViewer(mockTui(30, 80), mockSession(messages), mockRecord(), ansiTheme(), vi.fn());

			const rendered = viewer.render(80).join("\n");
			expect(rendered).toContain("↳ tool: read");
			expect(rendered).toContain("Item 1");
			expect(rendered).toContain("Item 2");
			expect(rendered).not.toContain("SECRET FILE CONTENT THAT SHOULD NOT BE SHOWN");
			expect(rendered).not.toContain("[Result]");
		});

		it("displays live streaming assistant content without duplication", () => {
			const streamingMessage = {
				role: "assistant",
				stopReason: "pending",
				content: [
					{ type: "toolCall", name: "grep" },
					{ type: "text", text: "Streaming answer in progress..." },
				],
			};
			const messages = [{ role: "user", content: "What is streaming?" }, streamingMessage];
			const state = { streamingMessage };

			const viewer = new BtwViewer(
				mockTui(30, 80),
				mockSession(messages, state),
				mockRecord({ status: "running" }),
				ansiTheme(),
				vi.fn(),
			);

			const rendered = viewer.render(80).join("\n");
			expect(rendered).toContain("↳ tool: grep");
			expect(rendered.match(/Streaming answer in progress/g)).toHaveLength(1);
			expect(rendered).toContain("▍ thinking…");
		});
	});

	describe("keyboard interactions & actions", () => {
		it("injects latest completed answer on 'i' and 'alt+i'", () => {
			const onInjectLatestAnswer = vi.fn();
			const messages = [
				{ role: "user", content: "Question 1" },
				{ role: "assistant", content: [{ type: "text", text: "First answer" }] },
				{ role: "user", content: "Question 2" },
				{ role: "assistant", content: [{ type: "text", text: "Final target answer" }] },
			];

			const viewer = new BtwViewer(
				mockTui(30, 80),
				mockSession(messages),
				mockRecord(),
				ansiTheme(),
				vi.fn(),
				undefined,
				{ onInjectLatestAnswer },
			);

			// Press 'i'
			viewer.handleInput("i");
			expect(onInjectLatestAnswer).toHaveBeenCalledWith("Final target answer");

			// Press Alt+I (meta-i sequence \x1bi)
			viewer.handleInput("\x1bi");
			expect(onInjectLatestAnswer).toHaveBeenCalledTimes(2);
			expect(onInjectLatestAnswer).toHaveBeenLastCalledWith("Final target answer");
		});

		it("clears conversation and closes modal on alt+x / ⌥x", () => {
			const onClearConversation = vi.fn();
			const done = vi.fn();
			const viewer = new BtwViewer(mockTui(30, 80), mockSession([]), mockRecord(), ansiTheme(), done, undefined, {
				onClearConversation,
			});

			viewer.handleInput("\x1bx"); // Alt+X
			expect(onClearConversation).toHaveBeenCalledTimes(1);
			expect(done).toHaveBeenCalledTimes(1);
		});

		it("opens composer on Enter and submits trimmed question", () => {
			const onSubmitQuestion = vi.fn();
			const tui = mockTui(30, 80);
			const viewer = new BtwViewer(tui, mockSession([]), mockRecord(), ansiTheme(), vi.fn(), undefined, {
				onSubmitQuestion,
			});

			expect(viewer.render(80).join("\n")).toContain("Enter ask");

			viewer.handleInput("\r"); // Open composer
			expect(viewer.render(80).join("\n")).toContain("? ask BTW");

			for (const ch of "  What is this error?  ") {
				viewer.handleInput(ch);
			}
			viewer.handleInput("\r"); // Submit

			expect(onSubmitQuestion).toHaveBeenCalledWith("What is this error?");
			expect(viewer.render(80).join("\n")).not.toContain("? ask BTW");
		});

		it("two-press 'x' stops a running turn", () => {
			const onStop = vi.fn();
			const tui = mockTui(30, 80);
			const viewer = new BtwViewer(
				tui,
				mockSession(),
				mockRecord({ status: "running" }),
				ansiTheme(),
				vi.fn(),
				undefined,
				{ onStop },
			);

			expect(viewer.render(80).join("\n")).toContain("x stop");

			viewer.handleInput("x"); // Arm
			expect(onStop).not.toHaveBeenCalled();
			expect(viewer.render(80).join("\n")).toContain("x again to STOP");

			viewer.handleInput("x"); // Confirm
			expect(onStop).toHaveBeenCalledTimes(1);
		});
	});

	describe("render width safety", () => {
		const widths = [40, 60, 80, 120, 200];

		it("all lines fit within specified width across varied layouts", () => {
			const longLine = "SuperLongWordWithoutSpaces".repeat(10);
			const messages = [
				{ role: "user", content: longLine },
				{
					role: "assistant",
					content: [
						{ type: "toolCall", name: "read", input: {} },
						{
							type: "text",
							text: `Here is a table and markdown:\n\n| Col1 | Col2 |\n|---|---|\n| ${longLine} | normal |\n\n\`${longLine}\``,
						},
					],
				},
			];

			for (const w of widths) {
				const viewer = new BtwViewer(
					mockTui(30, w),
					mockSession(messages),
					mockRecord({ status: "running" }),
					ansiTheme(),
					vi.fn(),
					undefined,
					{
						onSubmitQuestion: vi.fn(),
						onInjectLatestAnswer: vi.fn(),
						onClearConversation: vi.fn(),
						onStop: vi.fn(),
					},
					{
						activeTools: new Map([["read", "very/long/path/to/file.ts"]]),
						toolUses: 3,
						responseText: "generating detailed explanation...",
						turnCount: 2,
						lifetimeUsage: { input: 500, output: 250, cacheWrite: 0 },
					},
				);

				const lines = viewer.render(w);
				assertAllLinesFit(lines, w);
			}
		});

		it("maintains width stability during active composing", () => {
			for (const w of [40, 80, 120]) {
				const viewer = new BtwViewer(mockTui(30, w), mockSession([]), mockRecord(), ansiTheme(), vi.fn(), undefined, {
					onSubmitQuestion: vi.fn(),
				});
				viewer.handleInput("\r");
				for (const ch of "typing a very long question query ".repeat(5)) {
					viewer.handleInput(ch);
				}
				assertAllLinesFit(viewer.render(w), w);
			}
		});
	});
});
