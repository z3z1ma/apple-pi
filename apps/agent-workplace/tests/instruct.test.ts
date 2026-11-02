import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { fauxToolCall } from "@earendil-works/pi-ai/compat";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import askUserQuestion from "../../../components/ask-user-question/src/index.js";
import bridge from "../../../components/session-state/src/index.js";
import {
	close,
	query,
	startRuntime,
	stopRuntime,
	tempStateDir,
} from "../../../components/session-state/tests/helpers.js";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import { type Commands, openCommands } from "../src/backend/commands.js";
import { type Conversations, openConversations } from "../src/backend/conversations.js";
import { instruct } from "../src/backend/instructions.js";
import { openWorldBackend, type WorldBackend } from "../src/backend/world-backend.js";
import type { Instruction, ReceiptStage, ReplyStreamEvent } from "../src/world.js";

// Seam 1 for instructing an agent from the panel: the backend API in Node, without Electron, over a real session-state
// runtime, with faux Pi sessions running the real bridge.
const state = tempStateDir();
const cwd = mkdtempSync(join(tmpdir(), "aw-instruct-"));
writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
const sessionDir = mkdtempSync(join(tmpdir(), "aw-instruct-sessions-"));
let world: WorldBackend;
let commands: Commands;
let conversations: Conversations;
const replies: ReplyStreamEvent[] = [];
beforeAll(async () => {
	await startRuntime(state.socketPath);
	world = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
	commands = openCommands(state.socketPath);
	conversations = openConversations(state.socketPath);
	conversations.onReply((event) => replies.push(event));
});
afterAll(async () => {
	world.close();
	commands.close();
	conversations.close();
	await stopRuntime(state);
	rmSync(cwd, { recursive: true, force: true });
	rmSync(sessionDir, { recursive: true, force: true });
});

const character = (id: string) => world.snapshot().characters.find((c) => c.id === id);
let commandCount = 0;

/** Send an instruction as the panel does, collecting its receipt stages. */
async function send(id: string, instruction: Instruction) {
	const stages: { stage: ReceiptStage; reason?: string }[] = [];
	const commandId = `aw-test-${++commandCount}`;
	const result = await instruct(commands, character(id), commandId, instruction, (stage, reason) =>
		stages.push(reason ? { stage, reason } : { stage }),
	);
	return { result, stages, commandId };
}

/** A faux session with a transcript file, once it is a character in the world. */
async function awake(replyTo: Parameters<typeof fauxSession>[1], streamText = false) {
	const run = await fauxSession([bridge], replyTo, [], {
		streamText,
		cwd,
		sessionManager: SessionManager.create(cwd, sessionDir),
	});
	const id = run.session.sessionManager.getSessionId();
	await vi.waitFor(() => expect(character(id)).toBeDefined(), { timeout: 15000 });
	return { run, id };
}

const feedTexts = () => world.feed().map((line) => line.text);
const commandsFor = (id: string) =>
	query<{ kind: string }>(state.dbPath, "select kind from commands where session_id = ? order by rowid", id).map(
		(row) => row.kind,
	);

test("Reply sends talk with its receipts, and the reply streams to the watcher, ending as the stored entry", async () => {
	const blocks = ["Hello", " there,", " operator."];
	const { run, id } = await awake([fauxAssistantMessage(blocks.map((text) => fauxText(text)))], true);
	try {
		await conversations.watch([id]);
		const sent = await send(id, { kind: "talk", text: "Say hello." });
		expect(sent.result).toEqual({ ok: true });
		expect(sent.stages).toEqual([{ stage: "accepted" }, { stage: "delivered" }, { stage: "applied" }]);
		expect(commandsFor(id)).toEqual(["talk"]);

		await vi.waitFor(() => expect(replies.some((e) => e.kind === "end" && e.characterId === id)).toBe(true), {
			timeout: 10000,
		});
		const mine = replies.filter((e) => e.characterId === id);
		const deltas = mine.filter((e) => e.kind === "delta");
		expect(deltas.map((e) => e.delta).join("")).toBe(blocks.join(""));
		const end = mine.find((e) => e.kind === "end")!;
		expect(end.kind === "end" && end.streamId).toBe(deltas[0].streamId);
		// The stored entry replaces the streamed text with the same words, so nothing jumps.
		const stored = end.kind === "end" ? end.entry : null;
		expect(stored?.kind).toBe("assistant");
		const storedText =
			stored?.kind === "assistant" ? stored.parts.map((part) => (part.kind === "text" ? part.text : "")).join("") : "";
		expect(storedText).toBe(blocks.join(""));
		// The panel's history then holds the same entry, by the same id.
		const page = await conversations.page(id);
		expect(page.ok && page.entries.at(-1)?.id).toBe(end.kind === "end" && end.entry?.id);

		// The chatbox line, from the runtime's own record of the command.
		await vi.waitFor(
			() =>
				expect(feedTexts()).toEqual(
					expect.arrayContaining([
						expect.stringMatching(/^Message for .+: Say hello\.$/),
						expect.stringMatching(/took the message\.$/),
					]),
				),
			{ timeout: 3000 },
		);
	} finally {
		await conversations.watch([]);
		await close(run);
	}
}, 40000);

test("busy: Redirect now sends steer, Tell it after this sends follow_up, and Reply fails as busy; each with receipts", async () => {
	const holds: ((reply: Reply) => void)[] = [];
	const { run, id } = await awake((_context, signal) =>
		signal?.aborted ? fauxAssistantMessage("") : new Promise<Reply>((resolve) => holds.push(resolve)),
	);
	try {
		const turn = run.session.prompt("work");
		await vi.waitFor(() => expect(character(id)?.facts?.run).not.toBe("idle"), { timeout: 5000 });
		const steer = await send(id, { kind: "steer", text: "Go left instead." });
		expect(steer.stages).toEqual([{ stage: "accepted" }, { stage: "delivered" }, { stage: "applied" }]);
		const follow = await send(id, { kind: "follow_up", text: "Then tidy up." });
		expect(follow.stages).toEqual([{ stage: "accepted" }, { stage: "delivered" }, { stage: "applied" }]);
		const talk = await send(id, { kind: "talk", text: "Hi." });
		expect(talk.result).toMatchObject({ ok: false, reason: expect.stringContaining("busy") });
		expect(talk.stages.at(-1)).toMatchObject({ stage: "failed", reason: expect.stringContaining("busy") });
		expect(commandsFor(id)).toEqual(["steer", "follow_up", "talk"]);
		await vi.waitFor(
			() =>
				expect(feedTexts()).toEqual(
					expect.arrayContaining([
						expect.stringMatching(/^Redirect for .+: Go left instead\.$/),
						expect.stringMatching(/^Follow-up for .+: Then tidy up\.$/),
						expect.stringMatching(/took the redirect\.$/),
					]),
				),
			{ timeout: 3000 },
		);
		// The steer and the follow-up would each start another held request; end the run here.
		await run.session.abort();
		await turn.catch(() => {});
	} finally {
		await close(run);
	}
}, 40000);

test("Stop on a busy agent sends nothing until confirmed; confirmed, it sends abort and reports it applied", async () => {
	const { run, id } = await awake(() => "until-aborted");
	try {
		const turn = run.session.prompt("work forever");
		await vi.waitFor(() => expect(character(id)?.facts?.run).not.toBe("idle"), { timeout: 5000 });

		// Declined (or never confirmed): refused here, and the runtime never hears of it.
		const declined = await send(id, { kind: "abort" });
		expect(declined.result).toMatchObject({ ok: false, reason: expect.stringContaining("confirmation") });
		expect(declined.stages).toEqual([{ stage: "failed", reason: expect.stringContaining("confirmation") }]);
		expect(commandsFor(id)).toEqual([]);
		expect(run.session.isStreaming).toBe(true);

		const stop = await send(id, { kind: "abort", confirmed: true });
		expect(stop.stages).toEqual([{ stage: "accepted" }, { stage: "delivered" }, { stage: "applied" }]);
		expect(commandsFor(id)).toEqual(["abort"]);
		await turn.catch(() => {});
		await vi.waitFor(() => expect(character(id)?.facts?.run).toBe("idle"), { timeout: 5000 });
		await vi.waitFor(() => expect(feedTexts()).toContain(`Stop for ${character(id)?.name}.`), { timeout: 3000 });
	} finally {
		await close(run);
	}
}, 40000);

test("an idle agent stops without confirmation; instructions the panel cannot send are refused and send nothing", async () => {
	const { run, id } = await awake([]);
	try {
		expect((await send(id, { kind: "abort" })).result).toEqual({ ok: true });
		expect((await send(id, { kind: "talk", text: "   " })).result).toMatchObject({ ok: false });
		expect((await send(id, { kind: "rename", name: "x" } as never)).result).toMatchObject({ ok: false });
		expect(commandsFor(id)).toEqual(["abort"]);
		expect((await send("nobody", { kind: "talk", text: "hi" })).result).toEqual({
			ok: false,
			reason: "No such character is awake.",
		});
	} finally {
		await close(run);
	}
}, 30000);

// Ticket 14: answering questions in the world.

const questions = [
	{
		question: "Which runtime should the service use?",
		header: "Runtime",
		multiSelect: false,
		options: [
			{ label: "Node", description: "Built in, nothing to install" },
			{ label: "Rust", description: "Native and fast, more to build" },
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
	{
		question: "Anything else?",
		options: [
			{ label: "No", description: "Ship it" },
			{ label: "Yes", description: "Say what" },
		],
	},
];
const ENTER = "\r";
const DOWN = "\x1b[B";
const SPACE = " ";
// In the terminal dialog: Node; Tests and Docs, then done; the free-text choice with words typed; submit.
const typed = [ENTER, SPACE, DOWN, SPACE, DOWN, DOWN, ENTER, DOWN, DOWN, ENTER, ..."Add a changelog", ENTER, ENTER];
const formReplies = [{ selected: ["Node"] }, { selected: ["Tests", "Docs"] }, { custom: "Add a changelog" }];

/** A terminal that shows the real questionnaire dialog and can type into it. */
function terminal() {
	let dialog: { handleInput(data: string): void; focused: boolean } | undefined;
	let closed = false;
	const theme = { fg: (_c: string, t: string) => t, bg: (_c: string, t: string) => t, bold: (t: string) => t };
	const ui = {
		notify: () => {},
		custom: (factory: (...args: unknown[]) => typeof dialog) =>
			new Promise((resolve) => {
				dialog = factory(
					{ terminal: { rows: 40, columns: 120 }, requestRender: () => {} },
					theme,
					new KeybindingsManager(TUI_KEYBINDINGS),
					(result: unknown) => {
						closed = true;
						resolve(result);
					},
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

/** A faux session running a real `ask_user_question`, shown in a terminal, once the world sees the question. */
async function asking() {
	const screen = terminal();
	const run = await fauxSession(
		[bridge, askUserQuestion],
		[
			fauxAssistantMessage([fauxToolCall("ask_user_question", { questions } as never)], { stopReason: "toolUse" }),
			fauxAssistantMessage("thanks"),
		],
		["ask_user_question"],
		{ cwd, sessionManager: SessionManager.create(cwd, sessionDir) },
	);
	const id = run.session.sessionManager.getSessionId();
	try {
		// Without a UI bound before the first prompt, the tool drops itself at before_agent_start.
		await run.session.bindExtensions({ mode: "tui", uiContext: screen.ui as never });
		const turn = run.session.prompt("ask me");
		await vi.waitFor(() => expect(character(id)?.facts?.asking?.questionnaire).toBeDefined(), { timeout: 15000 });
		return { run, id, screen, turn };
	} catch (error) {
		await close(run);
		throw error;
	}
}

const toolResult = (run: { session: { messages: { role: string; content?: unknown }[] } }) =>
	JSON.stringify(run.session.messages.find((m) => m.role === "toolResult")?.content);

test("an open questionnaire reaches the world with its id, questions, options, descriptions, and multi-select", async () => {
	const ask = await asking();
	try {
		const open = character(ask.id)?.facts?.asking;
		expect(open).toMatchObject({ kind: "questionnaire", text: "Which runtime should the service use?" });
		expect(open?.questionnaire?.id).toEqual(expect.any(String));
		expect(open?.questionnaire?.questions).toEqual([
			{ ...questions[0] },
			{ ...questions[1] },
			{ ...questions[2], header: null, multiSelect: false },
		]);
		ask.screen.type(...typed);
		await ask.turn;
	} finally {
		await close(ask.run);
	}
}, 40000);

test("answering from the form sends answer with one reply per question; the tool gets what the terminal would, and the terminal dialog closes", async () => {
	const fromTerminal = await asking();
	const fromForm = await asking().catch(async (error) => {
		await close(fromTerminal.run);
		throw error;
	});
	try {
		fromTerminal.screen.type(...typed);
		await fromTerminal.turn;

		expect(fromForm.screen.isOpen()).toBe(true);
		const questionnaire = character(fromForm.id)!.facts!.asking!.questionnaire!.id;
		const sent = await send(fromForm.id, { kind: "answer", questionnaire, replies: formReplies });
		expect(sent.stages).toEqual([{ stage: "accepted" }, { stage: "delivered" }, { stage: "applied" }]);
		await fromForm.turn;
		expect(fromForm.screen.isOpen()).toBe(false);
		expect(toolResult(fromForm.run)).toBe(toolResult(fromTerminal.run));
		expect(toolResult(fromForm.run)).toContain("Add a changelog");
		expect(commandsFor(fromForm.id)).toEqual(["answer"]);
		// The question closes in every view.
		await vi.waitFor(() => expect(character(fromForm.id)?.facts?.asking).toBeNull(), { timeout: 3000 });
		await vi.waitFor(() => expect(feedTexts()).toContain(`${character(fromForm.id)?.name}'s question was answered.`), {
			timeout: 3000,
		});
	} finally {
		await close(fromTerminal.run);
		await close(fromForm.run);
	}
}, 40000);

test("when the terminal answers first, the question leaves the world, and a late answer from the form fails as not open", async () => {
	const ask = await asking();
	try {
		const questionnaire = character(ask.id)!.facts!.asking!.questionnaire!.id;
		ask.screen.type(...typed);
		await ask.turn;
		await vi.waitFor(() => expect(character(ask.id)?.facts?.asking).toBeNull(), { timeout: 3000 });
		const late = await send(ask.id, { kind: "answer", questionnaire, replies: formReplies });
		expect(late.result).toMatchObject({ ok: false, reason: expect.stringContaining("not open") });
	} finally {
		await close(ask.run);
	}
}, 40000);
