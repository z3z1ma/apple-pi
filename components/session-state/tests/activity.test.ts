import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterAll, expect, test, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import askUserQuestion from "../../ask-user-question/src/index.js";
import bridge from "../src/index.js";
import { close, query, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
afterAll(() => stopRuntime(state));

type Row = Record<string, unknown>;
const session = (id: string) => query<Row>(state.dbPath, "select * from sessions where id = ?", id)[0];
const events = (id: string, type: string) =>
	query<{ data: string }>(
		state.dbPath,
		"select data from events where session_id = ? and type = ? order by seq",
		id,
		type,
	).map((row) => JSON.parse(row.data));

/** A tool that runs until the test releases it, reporting progress on the way. */
function heldTool() {
	let release = () => {};
	const done = new Promise<void>((resolve) => {
		release = resolve;
	});
	const factory: ExtensionFactory = (pi) => {
		pi.registerTool({
			name: "slow_build",
			label: "Build",
			description: "Build something slowly",
			parameters: Type.Object({ path: Type.String() }),
			async execute(_id, _params, _signal, onUpdate) {
				for (let step = 0; step < 5; step++)
					onUpdate?.({ content: [{ type: "text", text: `step ${step}` }], details: {} });
				await done;
				return { content: [{ type: "text" as const, text: "built" }], details: {} };
			},
		});
	};
	return { factory, release };
}

const toolTurn = (name: string, args: Parameters<typeof fauxToolCall>[1]): Reply =>
	fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });

test("a running tool shows its name, main argument, and start, then a start and an end event with duration", async () => {
	const tool = heldTool();
	const run = await fauxSession(
		[bridge, tool.factory],
		[toolTurn("slow_build", { path: "src/app.ts" }), fauxAssistantMessage("ok")],
		["slow_build"],
	);
	try {
		const id = run.session.sessionManager.getSessionId();
		const turn = run.session.prompt("build it");
		await vi.waitFor(
			() => expect(session(id)).toMatchObject({ current_tool: "slow_build", current_tool_arg: "src/app.ts" }),
			{
				timeout: 15000,
			},
		);
		expect(session(id).current_tool_since).toBeGreaterThan(0);
		tool.release();
		await turn;
		await vi.waitFor(() => expect(session(id)).toMatchObject({ current_tool: null, current_tool_arg: null }));
		expect(events(id, "tool_started")).toEqual([expect.objectContaining({ name: "slow_build", arg: "src/app.ts" })]);
		expect(events(id, "tool_ended")).toEqual([
			expect.objectContaining({ name: "slow_build", isError: false, durationMs: expect.any(Number) }),
		]);
		// five progress updates, no event for any of them
		const types = query<{ type: string }>(
			state.dbPath,
			"select distinct type from events where session_id = ?",
			id,
		).map((row) => row.type);
		expect(types.filter((type) => /update|progress/.test(type))).toEqual([]);
	} finally {
		await close(run);
	}
}, 20000);

test("an open questionnaire shows its questions until it closes, each change an event", async () => {
	let answer: (value: unknown) => void = () => {};
	const questions = [
		{
			question: "Which runtime?",
			header: "Runtime",
			options: [
				{ label: "Node", description: "Built in" },
				{ label: "Rust", description: "Native" },
			],
		},
	];
	const run = await fauxSession(
		[bridge, askUserQuestion],
		[toolTurn("ask_user_question", { questions }), fauxAssistantMessage("thanks")],
		["ask_user_question"],
	);
	try {
		await run.session.bindExtensions({
			mode: "tui",
			uiContext: { custom: () => new Promise((resolve) => (answer = resolve)), notify: () => {} } as never,
		});
		const id = run.session.sessionManager.getSessionId();
		const turn = run.session.prompt("ask me");
		await vi.waitFor(() => expect(session(id).prompt).not.toBeNull(), { timeout: 15000 });
		expect(JSON.parse(session(id).prompt as string)).toEqual({ kind: "questionnaire", questions });
		answer({ answers: [], cancelled: true });
		await turn;
		await vi.waitFor(() => expect(session(id).prompt).toBeNull());
		expect(events(id, "prompt_opened")).toHaveLength(1);
		expect(events(id, "prompt_closed")).toHaveLength(1);
	} finally {
		await close(run);
	}
}, 20000);

test("steers and follow-ups typed during a run sit in the queue until delivered", async () => {
	let finish: (reply: Reply) => void = () => {};
	const held = new Promise<Reply>((resolve) => (finish = resolve));
	let calls = 0;
	const run = await fauxSession([bridge], () => (calls++ === 0 ? held : fauxAssistantMessage("noted")), []);
	try {
		const id = run.session.sessionManager.getSessionId();
		const turn = run.session.prompt("start");
		await vi.waitFor(() => expect(session(id)?.run_state).toBe("thinking"), { timeout: 15000 });
		await run.session.prompt("go left instead", { streamingBehavior: "steer" });
		await run.session.prompt("then tidy up", { streamingBehavior: "followUp" });
		await vi.waitFor(() => expect(JSON.parse(session(id).queue as string)).toEqual({ steers: 1, followUps: 1 }));
		finish(fauxAssistantMessage("first"));
		await turn;
		await vi.waitFor(() => expect(JSON.parse(session(id).queue as string)).toEqual({ steers: 0, followUps: 0 }), {
			timeout: 5000,
		});
	} finally {
		await close(run);
	}
}, 20000);

test("a failed reply records the last error, and an aborted run records the abort", async () => {
	let calls = 0;
	const run = await fauxSession(
		[bridge],
		() =>
			calls++ === 0
				? { ...fauxAssistantMessage(""), stopReason: "error" as const, errorMessage: "provider exploded" }
				: "until-aborted",
		[],
	);
	try {
		const id = run.session.sessionManager.getSessionId();
		await run.session.prompt("first");
		await vi.waitFor(() => expect(session(id)?.last_error).toBe("provider exploded"), { timeout: 15000 });
		const turn = run.session.prompt("second");
		await vi.waitFor(() => expect(session(id).run_state).toBe("thinking"));
		await run.session.abort();
		await turn.catch(() => {});
		await vi.waitFor(() => expect(session(id).last_abort_at).toBeGreaterThan(0));
		expect(events(id, "last_abort_at_changed")).toHaveLength(1);
	} finally {
		await close(run);
	}
}, 20000);

test("model, thinking level, context use, cost, and configuration are recorded and change with events", async () => {
	const priced = fauxAssistantMessage("priced");
	priced.usage = { ...priced.usage, cost: { ...priced.usage.cost, total: 0.25 } };
	const run = await fauxSession([bridge], [priced], ["read"]);
	try {
		const id = run.session.sessionManager.getSessionId();
		await vi.waitFor(() => expect(session(id)).toBeDefined(), { timeout: 15000 });
		expect(session(id)).toMatchObject({
			model: "faux-session-provider/faux-session-model",
			context_window: 100000,
			cost: 0,
		});
		expect(session(id).thinking_level).toEqual(expect.any(String));
		await run.session.prompt("hello");
		await vi.waitFor(() => expect(session(id).cost).toBe(0.25));
		expect(JSON.parse(session(id).config as string)).toMatchObject({ activeTools: ["read"] }); // refreshed when the run starts
		expect(session(id).context_tokens).toEqual(expect.any(Number));
		expect(events(id, "cost_changed").at(-1)).toMatchObject({ from: 0, to: 0.25 });
		run.session.setSessionName("Docs pass");
		await vi.waitFor(() => expect(JSON.parse(session(id).config as string)).toMatchObject({ name: "Docs pass" }));
		expect(events(id, "config_changed").at(-1)).toMatchObject({ to: { name: "Docs pass" } });
	} finally {
		await close(run);
	}
}, 20000);
