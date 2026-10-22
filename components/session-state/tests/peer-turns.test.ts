import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import { sendCommand } from "../src/client.js";
import bridge from "../src/index.js";
import { close, query, runtimePid, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
const directory = mkdtempSync(join(tmpdir(), "aps-peer-turns-"));
beforeAll(() => startRuntime(state.socketPath));
afterAll(async () => {
	await stopRuntime(state);
	rmSync(directory, { recursive: true, force: true });
});
const seen = (id: string) =>
	vi.waitFor(() => expect(query(state.dbPath, "select id from sessions where id = ?", id)).toHaveLength(1), {
		timeout: 15000,
	});
const schema = {
	type: "object",
	properties: { value: { type: "integer" } },
	required: ["value"],
	additionalProperties: false,
};

test("a program request returns the final reply, persists in the person's transcript, and leaves the person awake", async () => {
	const manager = SessionManager.create(directory, directory);
	const command = vi.fn();
	const run = await fauxSession(
		[bridge, (pi) => pi.registerCommand("review", { description: "test command", handler: command })],
		[fauxAssistantMessage("The change is sound.")],
		[],
		{ cwd: directory, sessionManager: manager },
	);
	try {
		const id = manager.getSessionId();
		await seen(id);
		const receipt = await sendCommand(id, { kind: "run_turn", task: "/review is the goal, not a slash command" });
		expect(receipt).toMatchObject({ stage: "applied", result: { status: "completed", text: "The change is sound." } });
		expect(command).not.toHaveBeenCalled();
		const transcript = readFileSync(manager.getSessionFile()!, "utf8");
		expect(transcript).toContain("/review is the goal");
		expect(transcript).toContain("The change is sound.");
		expect(run.session.isStreaming).toBe(false);
		expect(query(state.dbPath, "select process_state from incarnations where session_id = ?", id)).toEqual([
			{ process_state: "alive" },
		]);
	} finally {
		await close(run);
	}
}, 20000);

test("a request waits for the person's own work, and returns only the requested run's reply", async () => {
	let release!: (reply: Reply) => void;
	let count = 0;
	const run = await fauxSession(
		[bridge],
		() =>
			++count === 1
				? new Promise<Reply>((resolve) => {
						release = resolve;
					})
				: fauxAssistantMessage("The program's answer"),
		[],
	);
	try {
		const id = run.session.sessionManager.getSessionId();
		await seen(id);
		const own = run.session.prompt("My own work");
		await vi.waitFor(() => expect(count).toBe(1));
		const requested = sendCommand(
			id,
			{ kind: "run_turn", task: "Review the result" },
			{ commandId: "wait-for-own-work" },
		);
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select stage from commands where command_id = ?", "wait-for-own-work")).toEqual([
				{ stage: "delivered" },
			]),
		);
		expect(count).toBe(1);
		release(fauxAssistantMessage("My own result"));
		await own;
		expect(await requested).toMatchObject({ stage: "applied", result: { text: "The program's answer" } });
		expect(count).toBe(2);
	} finally {
		await close(run);
	}
}, 20000);

test("post-hook typed results are validated, with the return tool hidden between runs and reactivated for each schema", async () => {
	let count = 0;
	const run = await fauxSession([
		bridge,
		(pi) => {
			pi.on("tool_result", (event) => {
				if (event.toolName === "pi_exec_return") return { details: { value: Number(event.input.value) + 10 } };
			});
		},
	], () => {
		return fauxAssistantMessage([fauxToolCall("pi_exec_return", { value: ++count })], { stopReason: "toolUse" });
	}, []);
	try {
		const id = run.session.sessionManager.getSessionId();
		await seen(id);
		for (const value of [11, 12]) {
			expect(await sendCommand(id, { kind: "run_turn", task: "Return the value", outputSchema: schema })).toMatchObject(
				{ stage: "applied", result: { value: { value } } },
			);
			expect(run.session.getActiveToolNames()).not.toContain("pi_exec_return");
		}
	} finally {
		await close(run);
	}
}, 20000);

test("a model that never returns a matching typed result fails rather than returning its claim of success", async () => {
	const run = await fauxSession(
		[bridge],
		[
			fauxAssistantMessage([fauxToolCall("pi_exec_return", { value: "wrong" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("I finished"),
		],
		[],
	);
	try {
		const id = run.session.sessionManager.getSessionId();
		await seen(id);
		expect(await sendCommand(id, { kind: "run_turn", task: "Return an integer", outputSchema: schema })).toMatchObject({
			stage: "failed",
			result: { status: "failed", text: "I finished", error: expect.stringContaining("output_schema") },
		});
		expect(run.session.getActiveToolNames()).not.toContain("pi_exec_return");
	} finally {
		await close(run);
	}
}, 20000);

test("a caller cancelling a waiting request leaves the person's own active run alone", async () => {
	let release!: (reply: Reply) => void;
	const run = await fauxSession(
		[bridge],
		() =>
			new Promise<Reply>((resolve) => {
				release = resolve;
			}),
		[],
	);
	try {
		const id = run.session.sessionManager.getSessionId();
		await seen(id);
		const own = run.session.prompt("My own work");
		await vi.waitFor(() => expect(release).toBeTypeOf("function"));
		const controller = new AbortController();
		const pending = sendCommand(
			id,
			{ kind: "run_turn", task: "This request will be cancelled" },
			{ commandId: "cancel-waiting", signal: controller.signal },
		).catch((error) => error);
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select stage from commands where command_id = ?", "cancel-waiting")).toEqual([
				{ stage: "delivered" },
			]),
		);
		controller.abort();
		expect(await pending).toBeInstanceOf(Error);
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select stage from commands where command_id = ?", "cancel-waiting")).toEqual([
				{ stage: "failed" },
			]),
		);
		expect(run.session.isStreaming).toBe(true);
		release(fauxAssistantMessage("Own work completed"));
		await own;
		expect(run.session.getLastAssistantText()).toBe("Own work completed");
	} finally {
		await close(run);
	}
}, 20000);

test("a runtime outage stops an owned program turn but leaves ordinary work alone", async () => {
	let programStarted = false;
	let release!: (reply: Reply) => void;
	const program = await fauxSession([bridge], () => {
		programStarted = true;
		return new Promise<Reply>(() => {});
	}, []);
	const person = await fauxSession(
		[bridge],
		() =>
			new Promise<Reply>((resolve) => {
				release = resolve;
			}),
		[],
	);
	try {
		const id = program.session.sessionManager.getSessionId();
		await seen(id);
		await seen(person.session.sessionManager.getSessionId());
		const own = person.session.prompt("Own work");
		const pending = sendCommand(id, { kind: "run_turn", task: "Program work" }).catch((error) => error);
		await vi.waitFor(() => {
			expect(programStarted).toBe(true);
			expect(release).toBeTypeOf("function");
		});
		const pid = runtimePid(state.pidPath)!;
		expect(pid).not.toBe(process.pid);
		process.kill(pid, "SIGTERM");
		expect(await pending).toBeInstanceOf(Error);
		await vi.waitFor(() => expect(program.session.isStreaming).toBe(false));
		expect(person.session.isStreaming).toBe(true);
		await vi.waitFor(
			() => {
				expect(runtimePid(state.pidPath)).toBeTypeOf("number");
				expect(runtimePid(state.pidPath)).not.toBe(pid);
			},
			{ timeout: 10000 },
		);
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select stage from commands where session_id = ? and kind = 'run_turn'", id)).toEqual([
				{ stage: "failed" },
			]),
		);
		release(fauxAssistantMessage("Own work survived"));
		await own;
		expect(person.session.getLastAssistantText()).toBe("Own work survived");
	} finally {
		await close(program);
		await close(person);
	}
}, 20000);

test("cancelling an active program turn stops that run without closing its person", async () => {
	let count = 0;
	const run = await fauxSession(
		[bridge],
		() => (++count === 1 ? new Promise<Reply>(() => {}) : fauxAssistantMessage("Still here")),
		[],
	);
	try {
		const id = run.session.sessionManager.getSessionId();
		await seen(id);
		const controller = new AbortController();
		const pending = sendCommand(
			id,
			{ kind: "run_turn", task: "Work until cancelled" },
			{ commandId: "cancel-active", signal: controller.signal },
		).catch((error) => error);
		await vi.waitFor(() => expect(count).toBe(1));
		controller.abort();
		expect(await pending).toBeInstanceOf(Error);
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select stage from commands where command_id = ?", "cancel-active")).toEqual([
				{ stage: "failed" },
			]),
		);
		expect(await sendCommand(id, { kind: "run_turn", task: "Are you still here?" })).toMatchObject({
			stage: "applied",
			result: { text: "Still here" },
		});
	} finally {
		await close(run);
	}
}, 20000);
