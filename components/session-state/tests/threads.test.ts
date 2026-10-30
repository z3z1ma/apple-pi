import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import bridge from "../src/index.js";
import { MAIL_CUSTOM_TYPE } from "../src/mail.js";
import { threadsOf, withThreads } from "../src/threads.js";
import {
	close,
	fakeBridge,
	query,
	sendCommand,
	standInProcess,
	startRuntime,
	stopRuntime,
	tempStateDir,
} from "./helpers.js";

const state = tempStateDir();
const processes: ReturnType<typeof standInProcess>[] = [];
beforeAll(() => startRuntime(state.socketPath));
afterAll(async () => {
	for (const { child } of processes) child.kill();
	await stopRuntime(state);
});

type MailCommand = { kind: string; from: string; body: string; thread?: string; subject?: string; fromName?: string };
const seen = (id: string) =>
	vi.waitFor(() => expect(query(state.dbPath, "select 1 from sessions where id = ?", id)).toHaveLength(1), {
		timeout: 15000,
	});
/**
 * A person's bridge that records the mail the runtime hands it and, unless `unread`, reports it applied as a
 * transcript would (a pushed message that reached the transcript counts as read).
 */
const person = async (id: string, name: string, reportsTo: string | null, unread = false) => {
	const stand = standInProcess();
	processes.push(stand);
	const link = await fakeBridge(state.socketPath, id, stand.pid, stand.startedAt, {
		session: { name },
		facts: { reportsTo },
	});
	await seen(id);
	const mail: MailCommand[] = [];
	link.socket.on("data", (chunk) => {
		for (const line of chunk.toString().split("\n")) {
			if (!line.includes('"command"')) continue;
			const message = JSON.parse(line) as { type: string; commandId: string; command?: MailCommand };
			if (message.type !== "command" || message.command?.kind !== "mail") continue;
			mail.push(message.command);
			if (!unread) link.send({ type: "command_progress", commandId: message.commandId, stage: "applied" });
		}
	});
	return { ...link, mail, stand };
};
const call = (name: string, args: Parameters<typeof fauxToolCall>[1]): Reply =>
	fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const results = (run: Awaited<ReturnType<typeof fauxSession>>) =>
	run.session.sessionManager
		.getEntries()
		.filter((entry) => entry.type === "message" && entry.message.role === "toolResult")
		.map((entry) => {
			const message = (entry as { message: { isError?: boolean; content: { text?: string }[] } }).message;
			return { isError: message.isError ?? false, text: message.content.map((part) => part.text ?? "").join("") };
		});
const tools = ["send_mail", "reply", "inbox", "read_thread"];

test("mail is a thread: send_mail with a copy reaches everyone, a reply reaches all, and read_thread shows it in order", async () => {
	const script: Reply[] = [];
	const manager = await fauxSession([bridge], () => script.shift() ?? fauxAssistantMessage("ok"), tools);
	const managerId = manager.session.sessionManager.getSessionId();
	try {
		await seen(managerId);
		manager.session.sessionManager.appendSessionInfo("Nana");
		const ada = await person("thr-ada", "Ada", managerId);
		const ben = await person("thr-ben", "Ben", managerId);

		script.push(
			call("send_mail", { to: ["Ada"], cc: ["thr-ben"], subject: "Release plan", body: "Who takes the rollout?" }),
		);
		await manager.session.prompt("ask the team");
		const [sent] = results(manager);
		expect(sent.isError).toBe(false);
		const thread = JSON.parse(sent.text).effect.thread.id as string;
		expect(thread).toBeDefined();
		for (const who of [ada, ben])
			await vi.waitFor(() =>
				expect(who.mail).toMatchObject([
					{ from: managerId, body: "Who takes the rollout?", thread, subject: "Release plan" },
				]),
			);

		// Ada replies through the runtime as her session would; the manager and Ben both receive it.
		const receipts = await sendCommand(state.socketPath, "thr-ada", {
			kind: "thread_post",
			thread,
			body: "I take it.",
		});
		expect(receipts.at(-1)?.stage).toBe("applied");
		await vi.waitFor(() => expect(ben.mail.map((m) => m.body)).toEqual(["Who takes the rollout?", "I take it."]));
		expect(ben.mail[1].fromName).toBe("Ada");
		await vi.waitFor(() =>
			expect(
				manager.session.messages.filter((m) => m.role === "custom" && m.customType === MAIL_CUSTOM_TYPE),
			).toHaveLength(1),
		);

		script.push(call("read_thread", { thread, view: "range", limit: 10 }));
		await manager.session.prompt("read it");
		const read = results(manager).at(-1)!;
		const page = JSON.parse(read.text).effect.page;
		expect(page.thread.name).toBe("Release plan");
		expect(page.messages).toMatchObject([
			{ body: "Who takes the rollout?" },
			{ from: "thr-ada", fromName: "Ada", body: "I take it." },
		]);

		script.push(call("reply", { thread, body: "Thanks, Ada." }));
		await manager.session.prompt("thank her");
		await vi.waitFor(() => expect(ada.mail.map((m) => m.body)).toEqual(["Who takes the rollout?", "Thanks, Ada."]));
		await vi.waitFor(() => expect(ben.mail.at(-1)?.body).toBe("Thanks, Ada."));
	} finally {
		await close(manager);
	}
}, 40000);

test("my-team and my-manager follow the tree; mail to a sleeping person waits and the sender is told", async () => {
	const script: Reply[] = [];
	const lead = await fauxSession([bridge], () => script.shift() ?? fauxAssistantMessage("ok"), tools);
	const leadId = lead.session.sessionManager.getSessionId();
	try {
		await seen(leadId);
		const cy = await person("thr-cy", "Cy", leadId);
		const dee = await person("thr-dee", "Dee", leadId);
		// Dee goes to sleep: its process ends.
		dee.stand.child.kill();
		dee.socket.destroy();
		await vi.waitFor(
			() =>
				expect(
					query(state.dbPath, "select 1 from incarnations where session_id = 'thr-dee' and ended_at is null"),
				).toHaveLength(0),
			{ timeout: 10000 },
		);
		script.push(call("send_mail", { to: ["my-team"], subject: "Standup", body: "Status, please." }));
		await lead.session.prompt("ask the team");
		const [sent] = results(lead);
		expect(sent).toMatchObject({ isError: false });
		expect(JSON.parse(sent.text).effect.queued).toContain("thr-dee");
		await vi.waitFor(() => expect(cy.mail.map((m) => m.body)).toEqual(["Status, please."]));
		const waiting = query(state.dbPath, "select stage from commands where session_id = 'thr-dee' and kind = 'mail'");
		expect(waiting).toEqual([{ stage: "accepted" }]);

		// A report's my-manager is its manager.
		const sent2 = await sendCommand(state.socketPath, "thr-cy", {
			kind: "thread_post",
			thread: "t-cymanager",
			subject: "Done",
			body: "Finished.",
			to: [leadId],
		});
		expect(sent2.at(-1)?.stage).toBe("applied");
		script.push(call("send_mail", { to: ["nobody-here"], subject: "x", body: "y" }));
		await lead.session.prompt("mail a stranger");
		expect(results(lead).at(-1)).toMatchObject({ isError: true });
		expect(results(lead).at(-1)?.text).toContain("Nobody in your organization is named nobody-here");
	} finally {
		await close(lead);
	}
}, 40000);

test("inbox lists only the caller's threads, counts what it has not read, and reading clears it", async () => {
	const script: Reply[] = [];
	const reader = await fauxSession([bridge], () => script.shift() ?? fauxAssistantMessage("ok"), tools);
	const readerId = reader.session.sessionManager.getSessionId();
	try {
		await seen(readerId);
		await person("thr-eve", "Eve", readerId);
		// Fay's process takes mail but never records it, so it stays unread for her.
		await person("thr-fay", "Fay", readerId, true);
		await sendCommand(state.socketPath, "thr-eve", {
			kind: "thread_post",
			thread: "t-inbox1",
			subject: "Question for the lead",
			body: "Can I merge?",
			to: [readerId],
		});
		await sendCommand(state.socketPath, "thr-eve", {
			kind: "thread_post",
			thread: "t-inbox2",
			subject: "Between us",
			body: "Not for the lead.",
			to: ["thr-fay"],
		});
		await sendCommand(state.socketPath, "thr-eve", { kind: "thread_post", thread: "t-inbox2", body: "And another." });
		expect(withThreads((db) => threadsOf(db, "thr-fay", true))).toMatchObject([
			{ id: "t-inbox2", subject: "Between us", unread: 2, last: { from: "Eve", body: "And another." } },
		]);
		// The reader's mail reached its transcript, so nothing is new; with all: true it still lists its thread.
		await vi.waitFor(() => expect(withThreads((db) => threadsOf(db, readerId, true))).toEqual([]));
		script.push(call("inbox", { all: true }));
		await reader.session.prompt("what threads am I in");
		const listed = JSON.parse(results(reader).at(-1)!.text);
		expect(listed.threads).toContainEqual(
			expect.objectContaining({ id: "t-inbox1", name: "Question for the lead", unread: 0 }),
		);
		expect(listed.threads).not.toContainEqual(expect.objectContaining({ id: "t-inbox2" }));
		script.push(call("read_thread", { thread: "t-inbox2", limit: 1 }));
		await reader.session.prompt("snoop");
		expect(results(reader).at(-1)).toMatchObject({ isError: true });
		expect(results(reader).at(-1)!.text).not.toContain("Not for the lead.");
		// Reading marks a thread read for its reader.
		await sendCommand(state.socketPath, "thr-fay", { kind: "thread_read", thread: "t-inbox2", seq: 1_000_000 });
		expect(withThreads((db) => threadsOf(db, "thr-fay", true))).toEqual([]);
	} finally {
		await close(reader);
	}
}, 40000);

test("mailbox_send is gone; the mail tools are the only way to write", async () => {
	const run = await fauxSession([bridge], [fauxAssistantMessage("ok")], []);
	try {
		const names = run.session.getAllTools().map((tool) => tool.name);
		expect(names).toEqual(expect.arrayContaining(tools));
		expect(names).not.toContain("mailbox_send");
	} finally {
		await close(run);
	}
});
