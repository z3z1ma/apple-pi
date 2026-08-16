import { KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import { QuestionnaireDialog } from "../components/ask-user-question/dialog.js";
import {
	buildQuestionnaireToolResult,
	reconcileAskUserQuestionTool,
	registerAskUserQuestionTool,
} from "../components/ask-user-question/index.js";
import { runRpcQuestionnaire } from "../components/ask-user-question/rpc.js";
import {
	ASK_USER_QUESTION_TOOL_NAME,
	validateQuestionnaire,
	type AskUserQuestionParams,
	type QuestionnaireResult,
} from "../components/ask-user-question/types.js";

const DOWN = "\x1b[B";
const UP = "\x1b[A";
const ENTER = "\r";
const SPACE = " ";

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as any;

function params(overrides: Partial<AskUserQuestionParams> = {}): AskUserQuestionParams {
	return {
		questions: [
			{
				question: "Which storage strategy should we use?",
				header: "Storage",
				options: [
					{ label: "SQLite", description: "Keep state in one local transactional file." },
					{ label: "Postgres", description: "Use a shared database with network operations." },
				],
			},
		],
		...overrides,
	};
}

function fakeTui() {
	return {
		terminal: { rows: 40, columns: 120 },
		requestRender: vi.fn(),
	} as any;
}

function keybindings(overrides: Record<string, string | string[]> = {}) {
	return new KeybindingsManager(TUI_KEYBINDINGS, overrides);
}

function captureTool() {
	const tools = new Map<string, any>();
	const handlers = new Map<string, (...args: any[]) => unknown>();
	let active = ["read", ASK_USER_QUESTION_TOOL_NAME];
	const pi = {
		registerTool: (tool: any) => tools.set(tool.name, tool),
		on: (event: string, handler: (...args: any[]) => unknown) => handlers.set(event, handler),
		getActiveTools: () => active,
		setActiveTools: (tools: string[]) => {
			active = tools;
		},
	} as any;
	registerAskUserQuestionTool(pi);
	return { pi, tool: tools.get(ASK_USER_QUESTION_TOOL_NAME), handlers, active: () => active };
}

async function executeWithTui(input: AskUserQuestionParams, drive: (component: any) => void) {
	const { tool } = captureTool();
	const custom = vi.fn(async (factory: any) => {
		let result: QuestionnaireResult | undefined;
		const component = factory(fakeTui(), theme, keybindings(), (value: QuestionnaireResult) => {
			result = value;
		});
		component.focused = true;
		drive(component);
		return result;
	});
	return tool.execute("ask-1", input, undefined, undefined, {
		hasUI: true,
		mode: "tui",
		ui: { custom },
	} as any);
}

describe("ask_user_question registration and validation", () => {
	it("registers one sequential structured tool with model guidance", () => {
		const { tool, handlers } = captureTool();
		expect(tool.name).toBe(ASK_USER_QUESTION_TOOL_NAME);
		expect(tool.executionMode).toBe("sequential");
		expect(tool.parameters.properties).toHaveProperty("questions");
		expect(tool.promptGuidelines.join("\n")).toContain("Use ask_user_question");
		expect(handlers.has("before_agent_start")).toBe(true);
	});

	it("rejects duplicate questions, duplicate options, and reserved labels", () => {
		const base = params().questions[0];
		expect(validateQuestionnaire({ questions: [base, base] })).toMatchObject({
			ok: false,
			error: "duplicate_question",
		});
		expect(
			validateQuestionnaire({
				questions: [{ ...base, options: [base.options[0], base.options[0]] }],
			}),
		).toMatchObject({ ok: false, error: "duplicate_option_label" });
		expect(
			validateQuestionnaire({
				questions: [
					{
						...base,
						options: [
							{ label: "Other", description: "Reserved." },
							base.options[1],
						],
					},
				],
			}),
		).toMatchObject({ ok: false, error: "reserved_option_label" });
	});

	it("removes the tool without UI without disturbing siblings", () => {
		const { pi, active } = captureTool();
		reconcileAskUserQuestionTool(pi, { hasUI: false } as any);
		expect(active()).toEqual(["read"]);
		reconcileAskUserQuestionTool(pi, { hasUI: true } as any);
		expect(active()).toEqual(["read"]);
	});

	it("does not re-enable a tool that was disabled independently", () => {
		const { pi, active } = captureTool();
		pi.setActiveTools(["read"]);
		reconcileAskUserQuestionTool(pi, { hasUI: true } as any);
		expect(active()).toEqual(["read"]);
	});
});

describe("ask_user_question TUI", () => {
	it("returns an authored single-select answer", async () => {
		const result = await executeWithTui(params(), (component) => {
			component.handleInput(DOWN);
			component.handleInput(ENTER);
		});
		expect(result.details).toMatchObject({
			cancelled: false,
			answers: [{ kind: "option", answer: "Postgres", header: "Storage" }],
		});
		expect(result.content[0].text).toContain('"Which storage strategy should we use?" = "Postgres"');
	});

	it("accepts a custom answer", async () => {
		const result = await executeWithTui(params(), (component) => {
			component.handleInput(DOWN);
			component.handleInput(DOWN);
			component.handleInput(ENTER);
			for (const character of "Flat file") component.handleInput(character);
			component.handleInput(ENTER);
		});
		expect(result.details).toMatchObject({
			cancelled: false,
			answers: [{ kind: "custom", answer: "Flat file" }],
		});
	});

	it("collects and submits multiple authored choices", async () => {
		const input = params({
			questions: [{ ...params().questions[0], multiSelect: true }],
		});
		const result = await executeWithTui(input, (component) => {
			component.handleInput(SPACE);
			component.handleInput(DOWN);
			component.handleInput(ENTER);
			component.handleInput(DOWN);
			component.handleInput(DOWN);
			component.handleInput(ENTER);
		});
		expect(result.details).toMatchObject({
			cancelled: false,
			answers: [{ kind: "multi", selected: ["SQLite", "Postgres"] }],
		});
	});

	it("uses tabs and a final review for several questions", async () => {
		const input = params({
			questions: [
				params().questions[0],
				{
					question: "How should migrations run?",
					header: "Migrations",
					options: [
						{ label: "Automatic", description: "Run migrations during startup." },
						{ label: "Explicit", description: "Run a separate deployment step." },
					],
				},
			],
		});
		const result = await executeWithTui(input, (component) => {
			component.handleInput(ENTER);
			component.handleInput(DOWN);
			component.handleInput(ENTER);
			component.handleInput(ENTER);
		});
		expect(result.details.answers).toMatchObject([
			{ answer: "SQLite" },
			{ answer: "Explicit" },
		]);
	});

	it("honors remapped selector navigation and confirmation keys", () => {
		let result: QuestionnaireResult | undefined;
		const dialog = new QuestionnaireDialog(
			fakeTui(),
			theme,
			keybindings({ "tui.select.down": "ctrl+n", "tui.select.confirm": "ctrl+y" }),
			params(),
			(value) => {
				result = value;
			},
		);
		dialog.handleInput("\x0e");
		dialog.handleInput("\x19");
		expect(result?.answers[0]).toMatchObject({ answer: "Postgres" });
	});

	it("invalidates a committed multi-select answer when its choices change", () => {
		const input = params({
			questions: [
				{ ...params().questions[0], multiSelect: true },
				{
					question: "Continue?",
					header: "Continue",
					options: [
						{ label: "Yes", description: "Continue." },
						{ label: "No", description: "Stop." },
					],
				},
			],
		});
		const done = vi.fn();
		const dialog = new QuestionnaireDialog(fakeTui(), theme, keybindings(), input, done);
		dialog.handleInput(SPACE);
		for (let index = 0; index < 3; index++) dialog.handleInput(DOWN);
		dialog.handleInput(ENTER);
		dialog.handleInput(ENTER);
		dialog.handleInput("\x1b[Z");
		dialog.handleInput("\x1b[Z");
		for (let index = 0; index < 3; index++) dialog.handleInput(UP);
		dialog.handleInput(SPACE);
		dialog.handleInput("\t");
		dialog.handleInput("\t");
		dialog.handleInput(ENTER);
		expect(done).not.toHaveBeenCalled();
		expect(dialog.render(80).join("\n")).toContain("Answer every question before submitting");
	});

	it("closes an open TUI questionnaire when tool execution is aborted", () => {
		const controller = new AbortController();
		const done = vi.fn();
		new QuestionnaireDialog(fakeTui(), theme, keybindings(), params(), done, controller.signal);
		controller.abort();
		expect(done).toHaveBeenCalledWith({ answers: [], cancelled: true });
	});

	it("never renders a line wider than the available terminal width", () => {
		const dialog = new QuestionnaireDialog(fakeTui(), theme, keybindings(), params(), vi.fn());
		for (const width of [1, 4, 12, 40, 80]) {
			for (const line of dialog.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});
});

describe("ask_user_question RPC and failure envelopes", () => {
	it("walks single- and multi-select questions through native dialogs", async () => {
		const input = params({
			questions: [
				params().questions[0],
				{ ...params().questions[0], question: "Which environments?", header: "Envs", multiSelect: true },
			],
		});
		const ui = {
			select: vi.fn(async (_title: string, options: string[]) => options[1]),
			input: vi.fn(async () => "1,2"),
		};
		const result = await runRpcQuestionnaire(ui, input);
		expect(result).toMatchObject({
			cancelled: false,
			answers: [
				{ kind: "option", answer: "Postgres" },
				{ kind: "multi", selected: ["SQLite", "Postgres"] },
			],
		});
	});

	it("returns multi-select choices in authored order", async () => {
		const input = params({ questions: [{ ...params().questions[0], multiSelect: true }] });
		const ui = {
			select: vi.fn(),
			input: vi.fn(async () => "2,1,2"),
		};
		const result = await runRpcQuestionnaire(ui, input);
		expect(result.answers[0]).toMatchObject({ selected: ["SQLite", "Postgres"] });
	});

	it("preserves an out-of-range numeric multi-select response as a custom answer", async () => {
		const input = params({ questions: [{ ...params().questions[0], multiSelect: true }] });
		const ui = {
			select: vi.fn(),
			input: vi.fn(async () => "2026"),
		};
		const result = await runRpcQuestionnaire(ui, input);
		expect(result.answers[0]).toMatchObject({ kind: "custom", answer: "2026" });
	});

	it("re-prompts a blank RPC custom answer", async () => {
		const responses = ["   ", "Flat file"];
		const ui = {
			select: vi.fn(async (_title: string, options: string[]) => options.at(-1)),
			input: vi.fn(async () => responses.shift()),
		};
		const result = await runRpcQuestionnaire(ui, params());
		expect(ui.input).toHaveBeenCalledTimes(2);
		expect(result.answers[0]).toMatchObject({ kind: "custom", answer: "Flat file" });
	});

	it("passes the abort signal to RPC dialogs and resolves cancellation", async () => {
		const controller = new AbortController();
		const ui = {
			select: vi.fn(
				async (_title: string, _options: string[], dialogOptions?: { signal?: AbortSignal }) =>
					new Promise<string | undefined>((resolve) => {
						dialogOptions?.signal?.addEventListener("abort", () => resolve(undefined), { once: true });
					}),
			),
			input: vi.fn(),
		};
		const pending = runRpcQuestionnaire(ui, params(), controller.signal);
		controller.abort();
		await expect(pending).resolves.toMatchObject({ cancelled: true });
		expect(ui.select.mock.calls[0][2]).toEqual({ signal: controller.signal });
	});

	it("distinguishes missing UI from a user's cancellation", () => {
		const noUi = buildQuestionnaireToolResult({ answers: [], cancelled: true, error: "no_ui" });
		const cancelled = buildQuestionnaireToolResult({ answers: [], cancelled: true });
		expect(noUi.content[0].text).toContain("was not shown");
		expect(cancelled.content[0].text).toContain("cancelled");
		expect(noUi.content[0].text).not.toContain("cancelled");
	});
});
