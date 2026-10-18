import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import askUserQuestion from "../../ask-user-question/src/index.js";
import type { QuestionnaireReply } from "../../shared/src/questionnaire-events.js";
import bridge from "../src/index.js";
import { close, query, sendCommand, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
beforeAll(() => startRuntime(state.socketPath));
afterAll(() => stopRuntime(state));

const ENTER = "\r";
const DOWN = "\x1b[B";
const SPACE = " ";
const questions = [
	{
		question: "Which runtime?",
		header: "Runtime",
		multiSelect: false,
		options: [
			{ label: "Node", description: "Built in" },
			{ label: "Rust", description: "Native" },
		],
	},
	{
		question: "What should ship with it?",
		header: "Extras",
		multiSelect: true,
		options: [
			{ label: "Tests", description: "Behaviour checks" },
			{ label: "Docs", description: "Usage notes" },
		],
	},
];
const replies: QuestionnaireReply[] = [{ selected: ["Node"] }, { selected: ["Docs", "Tests"] }];
// The same choices typed in the dialog: Node; then Tests, Docs, and "done"; then submit.
const typedReplies = [ENTER, SPACE, DOWN, SPACE, DOWN, DOWN, ENTER, ENTER];

const toolTurn = (name: string, args: Parameters<typeof fauxToolCall>[1]): Reply =>
	fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const prompt = (id: string) =>
	query<{ prompt: string | null }>(state.dbPath, "select prompt from sessions where id = ?", id)[0]?.prompt ?? null;
const openPrompt = (id: string) =>
	vi.waitFor(
		() => {
			const value = prompt(id);
			expect(value).not.toBeNull();
			return JSON.parse(value as string) as { kind: string; id?: string };
		},
		{ timeout: 15000 },
	);

/** A terminal that shows the real questionnaire dialog and can type into it. */
function terminal() {
	let dialog: { handleInput(data: string): void; focused: boolean } | undefined;
	let closed = false;
	const theme = { fg: (_c: string, t: string) => t, bg: (_c: string, t: string) => t, bold: (t: string) => t };
	const ui = {
		notify: () => {},
		custom: (factory: (...args: unknown[]) => typeof dialog) =>
			new Promise((resolve) => {
				const done = (result: unknown) => {
					closed = true;
					resolve(result);
				};
				dialog = factory(
					{ terminal: { rows: 40, columns: 120 }, requestRender: () => {} },
					theme,
					new KeybindingsManager(TUI_KEYBINDINGS),
					done,
				);
				if (dialog) dialog.focused = true;
			}),
	};
	return {
		ui,
		type: (...keys: string[]) => {
			for (const key of keys) dialog?.handleInput(key);
		},
		isOpen: () => dialog !== undefined && !closed,
	};
}

async function askingSession() {
	const screen = terminal();
	const run = await fauxSession(
		[bridge, askUserQuestion],
		[toolTurn("ask_user_question", { questions }), fauxAssistantMessage("thanks")],
		["ask_user_question"],
	);
	const id = run.session.sessionManager.getSessionId();
	try {
		await run.session.bindExtensions({ mode: "tui", uiContext: screen.ui as never });
		const turn = run.session.prompt("ask me");
		const open = await openPrompt(id);
		return { run, id, turn, screen, questionnaire: open.id as string };
	} catch (error) {
		await close(run); // a session left open would start a new runtime after the test stops this one
		throw error;
	}
}

const toolResultText = (run: Awaited<ReturnType<typeof askingSession>>["run"]) =>
	JSON.stringify(run.session.messages.find((m) => m.role === "toolResult")?.content);

test("an answer command answers an open questionnaire like the terminal would, and closes the dialog", async () => {
	const fromTerminal = await askingSession();
	const fromCommand = await askingSession().catch(async (error) => {
		await close(fromTerminal.run);
		throw error;
	});
	try {
		fromTerminal.screen.type(...typedReplies);
		await fromTerminal.turn;

		expect(fromCommand.screen.isOpen()).toBe(true);
		expect(
			await sendCommand(state.socketPath, fromCommand.id, {
				kind: "answer",
				questionnaire: fromCommand.questionnaire,
				replies,
			}),
		).toEqual([{ stage: "accepted" }, { stage: "delivered" }, { stage: "applied" }]);
		await fromCommand.turn;
		expect(fromCommand.screen.isOpen()).toBe(false);
		expect(toolResultText(fromCommand.run)).toBe(toolResultText(fromTerminal.run));
		expect(toolResultText(fromCommand.run)).toContain("User answered the questions");
	} finally {
		await close(fromTerminal.run);
		await close(fromCommand.run);
	}
}, 30000);

test("once the terminal has answered, an answer command fails and the prompt is cleared", async () => {
	const asking = await askingSession();
	try {
		asking.screen.type(...typedReplies);
		await asking.turn;
		await vi.waitFor(() => expect(prompt(asking.id)).toBeNull());
		const receipts = await sendCommand(state.socketPath, asking.id, {
			kind: "answer",
			questionnaire: asking.questionnaire,
			replies,
		});
		expect(receipts.at(-1)).toMatchObject({ stage: "failed", reason: expect.stringContaining("not open") });
	} finally {
		await close(asking.run);
	}
}, 20000);

test("an answer that does not fit the questions fails and leaves the dialog open", async () => {
	const asking = await askingSession();
	try {
		const receipts = await sendCommand(state.socketPath, asking.id, {
			kind: "answer",
			questionnaire: asking.questionnaire,
			replies: [{ selected: ["Go"] }, { selected: [] }],
		});
		expect(receipts.at(-1)).toMatchObject({
			stage: "failed",
			reason: expect.stringContaining('"Go" is not an option'),
		});
		expect(asking.screen.isOpen()).toBe(true);
		asking.screen.type(...typedReplies);
		await asking.turn;
	} finally {
		await close(asking.run);
	}
}, 20000);

test("other extensions' dialogs are answered only in the terminal", async () => {
	let pick: (value: string | undefined) => void = () => {};
	const picker = (pi: ExtensionAPI) =>
		pi.registerTool({
			name: "pick_color",
			label: "Pick color",
			description: "Ask for a color",
			parameters: Type.Object({}),
			async execute(_id, _params, _signal, _onUpdate, ctx) {
				const color = await ctx.ui.select("Color?", ["red", "blue"]);
				return { content: [{ type: "text", text: color ?? "none" }], details: {} };
			},
		});
	const run = await fauxSession(
		[bridge, picker],
		[toolTurn("pick_color", {}), fauxAssistantMessage("ok")],
		["pick_color"],
	);
	try {
		await run.session.bindExtensions({
			mode: "tui",
			uiContext: { notify: () => {}, select: () => new Promise((resolve) => (pick = resolve)) } as never,
		});
		const id = run.session.sessionManager.getSessionId();
		const turn = run.session.prompt("pick");
		expect(await openPrompt(id)).toEqual({ kind: "select", title: "Color?" });
		const receipts = await sendCommand(state.socketPath, id, {
			kind: "answer",
			questionnaire: "anything",
			replies: [{ selected: ["red"] }],
		});
		expect(receipts.at(-1)).toMatchObject({ stage: "failed" });
		pick("blue");
		await turn;
		expect(JSON.stringify(run.session.messages.find((m) => m.role === "toolResult")?.content)).toContain("blue");
	} finally {
		await close(run);
	}
}, 20000);
