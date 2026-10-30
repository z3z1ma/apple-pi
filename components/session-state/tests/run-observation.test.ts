import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import type { BeforeAgentStartEvent, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, expect, test, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import bridge from "../src/index.js";
import { type RunObservation, RunObserver } from "../src/run-observation.js";
import { close, query, sendCommand, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
afterAll(() => stopRuntime(state));
const events = (person: string) =>
	query<{ data: string; at: number; seq: number; generation: number }>(
		state.dbPath,
		"select data, at, seq, generation from events where session_id = ? and type = 'execution' order by seq",
		person,
	).map((row) => ({ ...row, observation: JSON.parse(row.data) as RunObservation }));
const prepared = {
	type: "before_agent_start",
	messageType: "user",
	prompt: "secret prompt",
	systemPrompt: "private instructions",
} as BeforeAgentStartEvent;

test("preparation, repeated loops, reload and settlement preserve one identity without private input", () => {
	const facts: RunObservation[] = [];
	const observer = new RunObserver("unit-person", false, true, (fact) => facts.push(fact));
	observer.prepare(prepared);
	expect(observer.snapshot().active).toBe(false);
	observer.start();
	observer.start();
	const mail = {
		role: "custom",
		customType: "apple-pi.mailbox-message",
		content: "secret body",
		details: { id: "delivery", body: "secret body", thread: "thread", reference: { id: "message", seq: 1 } },
	};
	observer.consume(mail);
	observer.close(true);
	const restored = new RunObserver("unit-person", true, false, (fact) => facts.push(fact));
	expect(restored.snapshot()).toEqual(observer.snapshot());
	restored.start();
	restored.consume(mail);
	restored.settle(true);
	expect(facts.filter((fact) => fact.phase === "start")).toHaveLength(1);
	expect(facts.filter((fact) => fact.phase === "input")).toHaveLength(1);
	expect(new Set(facts.map((fact) => fact.id)).size).toBe(1);
	expect(restored.snapshot().active).toBe(false);
	expect(JSON.stringify(facts)).not.toContain("secret");
	const unknown = new RunObserver("unit-person", true, false, () => {});
	expect(unknown.snapshot().input.kind).toBe("unknown");
	unknown.close(false);
});

test("the bridge records actual consumed mail, not delivery into a busy queue, and preserves the initiating input", async () => {
	let release: (reply: Reply) => void = () => {};
	const run = await fauxSession(
		[bridge],
		(context) =>
			JSON.stringify(context.messages.at(-1)).includes("hold secret")
				? new Promise<Reply>((resolve) => {
						release = resolve;
					})
				: fauxAssistantMessage("noted"),
		[],
	);
	const id = run.session.sessionManager.getSessionId();
	try {
		await vi.waitFor(() => expect(events(id).length).toBeGreaterThan(0), { timeout: 15000 });
		await sendCommand(
			state.socketPath,
			id,
			{ kind: "mail", from: "sender", sentAt: new Date().toISOString(), body: "private mail start" },
			{ commandId: "mail-start" },
		);
		await vi.waitFor(() => expect(events(id).some((row) => row.observation.phase === "settle")).toBe(true), {
			timeout: 10000,
		});
		const first = events(id).find((row) => row.observation.phase === "prepare")!.observation;
		expect(first).toMatchObject({ input: { kind: "mail", command: "mail-start" } });
		const turn = run.session.prompt("hold secret");
		await vi.waitFor(() => expect(run.requests).toHaveLength(2));
		const pending = sendCommand(
			state.socketPath,
			id,
			{ kind: "mail", from: "sender", sentAt: new Date().toISOString(), body: "private injected mail" },
			{ commandId: "mail-injected" },
		);
		await vi.waitFor(() =>
			expect(
				query(state.dbPath, "select 1 from commands where command_id = 'mail-injected' and stage = 'delivered'"),
			).toHaveLength(1),
		);
		expect(
			events(id).some((row) => row.observation.phase === "input" && row.observation.input.command === "mail-injected"),
		).toBe(false);
		release(fauxAssistantMessage("continuing"));
		await turn;
		await pending;
		await vi.waitFor(() => expect(events(id).filter((row) => row.observation.phase === "settle")).toHaveLength(2));
		const second = events(id).filter((row) => row.observation.phase === "prepare")[1].observation;
		expect(second).toMatchObject({ input: { kind: "user", command: null } });
		expect(
			events(id).find((row) => row.observation.phase === "input" && row.observation.input.command === "mail-injected")!
				.observation.id,
		).toBe(second.id);
		expect(events(id).filter((row) => row.observation.phase === "start")).toHaveLength(2);
		expect(JSON.stringify(events(id))).not.toMatch(/private mail|private injected|hold secret/);
	} finally {
		release(fauxAssistantMessage("done"));
		await run.session.abort();
		await close(run);
	}
}, 30000);

test("startup replay is received inside the explicit user run, and retained mail is not received again", async () => {
	await startRuntime(state.socketPath);
	const id = "observation-startup";
	await sendCommand(
		state.socketPath,
		id,
		{ kind: "mail", from: "sender", sentAt: new Date().toISOString(), body: "queued private mail" },
		{ commandId: "startup-mail" },
	);
	const run = await fauxSession([bridge], [fauxAssistantMessage("first"), fauxAssistantMessage("second")], [], {
		sessionManager: SessionManager.inMemory(undefined, { id }),
	});
	try {
		await vi.waitFor(
			() =>
				expect(
					query(state.dbPath, "select 1 from commands where command_id = 'startup-mail' and stage = 'delivered'"),
				).toHaveLength(1),
			{ timeout: 10000 },
		);
		expect(run.requests).toHaveLength(0);
		await run.session.prompt("start explicitly");
		await run.session.prompt("another request");
		await vi.waitFor(() => expect(events(id).filter((row) => row.observation.phase === "settle")).toHaveLength(2));
		expect(
			events(id)
				.filter((row) => row.observation.phase === "prepare")
				.map((row) => row.observation),
		).toMatchObject([{ input: { kind: "user" } }, { input: { kind: "user" } }]);
		expect(
			events(id).filter((row) => row.observation.phase === "input" && row.observation.input.command === "startup-mail"),
		).toHaveLength(1);
	} finally {
		await close(run);
	}
}, 20000);

test("an actual host continuation emits several loop starts inside one observed run", async () => {
	let loops = 0,
		continued = false;
	const continuation: ExtensionFactory = (pi) => {
		pi.on("agent_start", () => {
			loops++;
		});
		pi.on("agent_end", () => {
			if (continued) return;
			continued = true;
			pi.sendMessage(
				{ customType: "fixture.follow-up", content: "continue", display: false },
				{ deliverAs: "followUp", triggerTurn: true },
			);
		});
	};
	const run = await fauxSession(
		[bridge, continuation],
		[fauxAssistantMessage("first"), fauxAssistantMessage("continued")],
		[],
	);
	const id = run.session.sessionManager.getSessionId();
	try {
		await vi.waitFor(() => expect(events(id).length).toBeGreaterThan(0), { timeout: 10000 });
		await run.session.prompt("begin");
		await vi.waitFor(() => expect(events(id).filter((row) => row.observation.phase === "settle")).toHaveLength(1));
		expect(loops).toBeGreaterThan(1);
		expect(events(id).filter((row) => row.observation.phase === "start")).toHaveLength(1);
	} finally {
		await close(run);
	}
}, 20000);
