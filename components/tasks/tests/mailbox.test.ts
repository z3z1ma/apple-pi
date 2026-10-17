import { execFile } from "node:child_process";
import {
	appendFileSync,
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { type ExtensionFactory, SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import installTasks from "../src/index.js";
import { MAILBOX_MESSAGE_CUSTOM_TYPE, type MailboxMessage } from "../src/types.js";

let root: string;
let mailboxDir: string;
const cleanup: (() => Promise<void>)[] = [];

// File watch notifications can lag well past waitFor's 1 s default when the machine is busy.
const eventually = (check: () => void) => vi.waitFor(check, { timeout: 4000 });

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "apple-pi-mailbox-"));
	mailboxDir = join(root, "mailbox");
	vi.stubEnv("PI_MAILBOX_DIR", mailboxDir);
});

afterEach(async () => {
	for (const close of cleanup.splice(0)) await close();
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

function send(sessionId: string, message: { id: string; from: string; body: string }) {
	mkdirSync(mailboxDir, { recursive: true });
	appendFileSync(
		join(mailboxDir, `${sessionId}.jsonl`),
		`${JSON.stringify({ ...message, ts: "2026-10-16T12:00:00.000Z" })}\n`,
	);
}

function toolResultText(run: Awaited<ReturnType<typeof open>>): string {
	const result = run.session.messages.find((message) => message.role === "toolResult");
	return (result?.content ?? []).map((part) => ("text" in part ? part.text : "")).join("");
}

async function open(
	sessionManager: SessionManager,
	replies: Parameters<typeof fauxSession>[1] = [],
	extra: { factories?: ExtensionFactory[]; tools?: string[] } = {},
) {
	const run = await fauxSession([installTasks, ...(extra.factories ?? [])], replies, extra.tools ?? [], {
		cwd: root,
		sessionManager,
	});
	let closed = false;
	const close = async () => {
		if (closed) return;
		closed = true;
		await run.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		run.dispose();
	};
	cleanup.push(close);
	const delivered = () =>
		run.session.sessionManager
			.getEntries()
			.flatMap((entry) =>
				entry.type === "custom_message" && entry.customType === MAILBOX_MESSAGE_CUSTOM_TYPE
					? [entry.details as MailboxMessage]
					: [],
			);
	return { ...run, delivered, close };
}

describe("session mailbox", () => {
	it("gives mail that waited for startup to the command's prompt, which Pi still accepts", async () => {
		send("alpha", { id: "m1", from: "shikamaru", body: "Rebase onto main." });
		const run = await open(SessionManager.inMemory(root, { id: "alpha" }));
		expect(run.requests).toHaveLength(0);

		await run.session.prompt("Here is your brief.");

		expect(run.requests).toHaveLength(1);
		const seen = JSON.stringify(run.requests[0]?.messages);
		expect(seen).toContain("Here is your brief.");
		expect(seen).toContain("Rebase onto main.");
		expect(run.delivered()).toEqual([
			{ id: "m1", from: "shikamaru", ts: "2026-10-16T12:00:00.000Z", body: "Rebase onto main." },
		]);
	});

	it("gives mail that waited for startup to the run the next message starts", async () => {
		send("alpha", { id: "m1", from: "shikamaru", body: "first" });
		const run = await open(SessionManager.inMemory(root, { id: "alpha" }));

		send("alpha", { id: "m2", from: "shikamaru", body: "second" });

		await eventually(() => expect(run.requests).toHaveLength(1));
		expect(
			run
				.delivered()
				.map((message) => message.id)
				.sort(),
		).toEqual(["m1", "m2"]);
	});

	it("does not redeliver after the session reopens, but delivers what arrived while it was closed", async () => {
		const sessions = join(root, "sessions");
		send("alpha", { id: "m1", from: "shikamaru", body: "first" });
		const first = await open(SessionManager.create(root, sessions, { id: "alpha" }));
		await first.session.prompt("go");
		const file = first.session.sessionManager.getSessionFile() as string;
		await first.close();

		send("alpha", { id: "m2", from: "shikamaru", body: "second" });
		const reopened = await open(SessionManager.open(file, sessions));
		await reopened.session.prompt("continue");

		expect(reopened.delivered()).toEqual([
			{ id: "m1", from: "shikamaru", ts: "2026-10-16T12:00:00.000Z", body: "first" },
			{ id: "m2", from: "shikamaru", ts: "2026-10-16T12:00:00.000Z", body: "second" },
		]);
	});

	it("delivers a message sent during a run at the next boundary, not in a new run", async () => {
		let queued = () => false;
		const relay: ExtensionFactory = (pi) => {
			pi.registerTool({
				name: "relay",
				label: "Relay",
				description: "Send a mailbox message mid-run",
				parameters: Type.Object({}),
				async execute() {
					send("alpha", { id: "m1", from: "worker", body: "Blocked on review." });
					await eventually(() => expect(queued()).toBe(true));
					return { content: [{ type: "text" as const, text: "relayed" }], details: undefined };
				},
			});
		};
		const run = await open(
			SessionManager.inMemory(root, { id: "alpha" }),
			[
				fauxAssistantMessage(fauxToolCall("relay", {}, { id: "call-1" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			],
			{ factories: [relay], tools: ["relay"] },
		);
		queued = () => run.session.agent.hasQueuedMessages();

		await run.session.prompt("go");
		expect(run.session.messages.find((message) => message.role === "toolResult")).toMatchObject({ isError: false });

		expect(run.requests).toHaveLength(2);
		const roles = run.requests[1]?.messages.map((message) => message.role);
		expect(roles?.slice(-2)).toEqual(["toolResult", "user"]);
		expect(JSON.stringify(run.requests[1]?.messages.at(-1))).toContain("Blocked on review.");
	});

	it("redelivers a message whose steer was queued but not yet recorded when Pi stopped", async () => {
		const sessions = join(root, "sessions");
		const crashed = join(root, "crashed.jsonl");
		let session: Awaited<ReturnType<typeof open>>["session"] | undefined;
		const relay: ExtensionFactory = (pi) => {
			pi.registerTool({
				name: "relay",
				label: "Relay",
				description: "Send a mailbox message mid-run, then snapshot the session file as a crash would leave it",
				parameters: Type.Object({}),
				async execute() {
					send("alpha", { id: "m1", from: "worker", body: "queued" });
					await eventually(() => expect(session?.agent.hasQueuedMessages()).toBe(true));
					copyFileSync(session?.sessionManager.getSessionFile() as string, crashed);
					return { content: [{ type: "text" as const, text: "relayed" }], details: undefined };
				},
			});
		};
		const run = await open(
			SessionManager.create(root, sessions, { id: "alpha" }),
			[
				fauxAssistantMessage(fauxToolCall("relay", {}, { id: "call-1" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			],
			{ factories: [relay], tools: ["relay"] },
		);
		session = run.session;
		await run.session.prompt("go");
		expect(run.session.messages.find((message) => message.role === "toolResult")).toMatchObject({ isError: false });
		await run.close();
		expect(readFileSync(crashed, "utf8")).not.toContain(MAILBOX_MESSAGE_CUSTOM_TYPE);

		const reopened = await open(SessionManager.open(crashed, sessions));
		await reopened.session.prompt("continue");

		expect(reopened.delivered().map((message) => message.id)).toEqual(["m1"]);
	});

	describe("a steer that Pi queued but did not record", () => {
		// m1 arrives while the model is streaming; once Pi queues its steer, `interrupt` ends the run.
		async function queueThen(interrupt: (session: Awaited<ReturnType<typeof open>>["session"]) => void) {
			const run = await open(SessionManager.inMemory(root, { id: "alpha" }), (_context, signal) =>
				signal?.aborted === false && run.requests.length === 1 ? "until-aborted" : fauxAssistantMessage("done"),
			);
			// Pi emits session_start on reload only when a host has bound to the session, as real hosts do.
			await run.session.bindExtensions({ onError: () => {} });
			const prompted = run.session.prompt("go");
			await eventually(() => expect(run.requests).toHaveLength(1));
			send("alpha", { id: "m1", from: "worker", body: "queued" });
			await eventually(() => expect(run.session.agent.hasQueuedMessages()).toBe(true));
			interrupt(run.session);
			await prompted;
			return run;
		}

		it("is delivered after the next run when Escape discarded it, without restarting the cancelled work", async () => {
			const run = await queueThen((session) => {
				session.clearQueue();
				void session.abort();
			});
			expect(run.delivered()).toEqual([]);
			expect(run.requests).toHaveLength(1);

			await run.session.prompt("next");

			await eventually(() => expect(run.delivered().map((message) => message.id)).toEqual(["m1"]));
		});

		it("is not delivered twice when an abort kept it queued and the session reloaded", async () => {
			const run = await queueThen((session) => void session.abort());
			expect(run.session.agent.hasQueuedMessages()).toBe(true);

			await run.session.reload();
			send("alpha", { id: "m2", from: "worker", body: "after reload" });

			await eventually(() => expect(run.delivered().map((message) => message.id)).toContain("m2"));
			await eventually(() => expect(run.session.isIdle).toBe(true));
			expect(
				run
					.delivered()
					.map((message) => message.id)
					.sort(),
			).toEqual(["m1", "m2"]);
		});
	});

	it("survives an unreadable mailbox and resumes delivery once it is readable", async () => {
		send("alpha", { id: "m0", from: "shikamaru", body: "seen" });
		const run = await open(SessionManager.inMemory(root, { id: "alpha" }));
		await run.session.prompt("go");
		const file = join(mailboxDir, "alpha.jsonl");

		chmodSync(file, 0o000);
		await new Promise((resolve) => setTimeout(resolve, 200));
		chmodSync(file, 0o644);
		send("alpha", { id: "m1", from: "shikamaru", body: "after" });

		await eventually(() => expect(run.delivered().map((message) => message.id)).toEqual(["m0", "m1"]));
	});

	it("wakes an idle session when a message arrives", async () => {
		const run = await open(SessionManager.inMemory(root, { id: "alpha" }));

		send("alpha", { id: "m1", from: "shikamaru", body: "Status?" });

		await eventually(() => expect(run.requests).toHaveLength(1));
		expect(run.delivered().map((message) => message.id)).toEqual(["m1"]);
	});
	it("does not redeliver a message recorded on a branch that /tree left, even after a restart", async () => {
		const sessions = join(root, "sessions");
		const run = await open(SessionManager.create(root, sessions, { id: "alpha" }));
		await run.session.prompt("hello");
		const beforeMessage = run.session.sessionManager.getLeafId() as string;
		send("alpha", { id: "m1", from: "shikamaru", body: "first" });
		await eventually(() => expect(run.requests).toHaveLength(2));

		await run.session.navigateTree(beforeMessage, { summarize: false });
		send("alpha", { id: "m2", from: "shikamaru", body: "second" });
		await eventually(() => expect(run.requests).toHaveLength(3));
		expect(JSON.stringify(run.requests[2]?.messages)).not.toContain("first");
		const file = run.session.sessionManager.getSessionFile() as string;
		await run.close();

		const reopened = await open(SessionManager.open(file, sessions));
		send("alpha", { id: "m3", from: "shikamaru", body: "third" });
		await eventually(() => expect(reopened.requests).toHaveLength(1));
		expect(reopened.delivered().map((message) => message.id)).toEqual(["m1", "m2", "m3"]);
	});

	it("gives a fork its own mailbox", async () => {
		const sessions = join(root, "sessions");
		const original = await open(SessionManager.create(root, sessions, { id: "alpha" }));
		await original.session.prompt("hello");
		const file = original.session.sessionManager.getSessionFile() as string;
		await original.close();

		const fork = await open(SessionManager.forkFrom(file, root, sessions));
		const forkId = fork.session.sessionManager.getSessionId();
		send("alpha", { id: "m1", from: "shikamaru", body: "for the original" });
		send(forkId, { id: "m2", from: "shikamaru", body: "for the fork" });

		await eventually(() => expect(fork.requests).toHaveLength(1));
		expect(forkId).not.toBe("alpha");
		expect(fork.delivered().map((message) => message.id)).toEqual(["m2"]);
	});
	it("sends a message to another session with the mailbox_send tool", async () => {
		const run = await open(
			SessionManager.inMemory(root, { id: "alpha" }),
			[
				fauxAssistantMessage(fauxToolCall("mailbox_send", { session_id: "beta", message: "Done." }, { id: "c1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("sent"),
			],
			{ tools: ["mailbox_send"] },
		);

		await run.session.prompt("tell beta");

		const lines = readFileSync(join(mailboxDir, "beta.jsonl"), "utf8").trim().split("\n");
		expect(lines.map((line) => JSON.parse(line))).toEqual([
			{ id: expect.any(String), from: "alpha", ts: expect.any(String), body: "Done." },
		]);
		expect(toolResultText(run)).toContain("No running Pi session in tmux has this id");
	});

	it("says nothing more when a running Pi session in tmux has the receiver's id", async () => {
		const stateDir = process.env.PI_TMUX_STATE_DIR as string;
		mkdirSync(stateDir, { recursive: true });
		const record = join(stateDir, "gamma.json");
		writeFileSync(record, JSON.stringify({ sessionId: "gamma", pid: process.pid }));
		cleanup.push(async () => rmSync(record, { force: true }));
		const run = await open(
			SessionManager.inMemory(root, { id: "alpha" }),
			[
				fauxAssistantMessage(fauxToolCall("mailbox_send", { session_id: "gamma", message: "Done." }, { id: "c1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("sent"),
			],
			{ tools: ["mailbox_send"] },
		);

		await run.session.prompt("tell gamma");

		expect(toolResultText(run)).toMatch(/^Sent \S+ to gamma\.$/);
	});

	it("rejects a session id that is not a valid Pi session id", async () => {
		const run = await open(
			SessionManager.inMemory(root, { id: "alpha" }),
			[
				fauxAssistantMessage(fauxToolCall("mailbox_send", { session_id: "../alpha", message: "x" }, { id: "c1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("ok"),
			],
			{ tools: ["mailbox_send"] },
		);

		await run.session.prompt("go");

		const result = run.session.messages.find((message) => message.role === "toolResult");
		expect(result).toMatchObject({ isError: true });
		expect(existsSync(join(root, "alpha.jsonl"))).toBe(false);
	});
	describe("pi-send", () => {
		const script = join(import.meta.dirname, "../scripts/pi-send.mjs");
		const run = (args: string[], stdin?: string) =>
			new Promise<{ code: number; stdout: string }>((resolve) => {
				const child = execFile(process.execPath, [script, ...args], { env: process.env }, (error, stdout) =>
					resolve({ code: error ? Number(error.code ?? 1) : 0, stdout }),
				);
				child.stdin?.end(stdin);
			});

		it("loses nothing when many senders append at once", async () => {
			const senders = Array.from({ length: 20 }, (_, index) => run(["beta", "--from", `w${index}`, `msg ${index}`]));
			expect((await Promise.all(senders)).map((result) => result.code)).toEqual(Array(20).fill(0));

			const session = await open(SessionManager.inMemory(root, { id: "beta" }));
			await session.session.prompt("go");

			expect(session.delivered()).toHaveLength(20);
			expect(new Set(session.delivered().map((message) => message.body)).size).toBe(20);
			expect(session.delivered().find((message) => message.body === "msg 3")?.from).toBe("w3");
		});

		it("reads the message from stdin and names the shell as the default sender", async () => {
			expect((await run(["beta"], "Tick.\n")).code).toBe(0);

			const [line] = readFileSync(join(mailboxDir, "beta.jsonl"), "utf8").trim().split("\n");
			expect(JSON.parse(line as string)).toMatchObject({ from: "shell", body: "Tick." });
		});

		it("rejects an invalid session id", async () => {
			expect((await run(["../beta", "x"])).code).not.toBe(0);
		});
	});
});
