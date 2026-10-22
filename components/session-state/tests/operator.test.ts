import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import bridge from "../src/index.js";
import { MAIL_CUSTOM_TYPE } from "../src/mail.js";
import { threadsOf, withThreads } from "../src/threads.js";
import { close, query, sendCommand, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
beforeAll(() => startRuntime(state.socketPath));
afterAll(() => stopRuntime(state));
const call = (name: string, args: Parameters<typeof fauxToolCall>[1]): Reply =>
	fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
async function person(manager?: string) {
	const script: Reply[] = [];
	const run = await fauxSession([bridge], () => script.shift() ?? fauxAssistantMessage("Continuing my work."), []);
	const id = run.session.sessionManager.getSessionId();
	if (manager) {
		run.session.extensionRunner.setFlagValue("reports-to", manager);
		await run.session.bindExtensions({});
	}
	await vi.waitFor(
		() =>
			expect(query(state.dbPath, "select reports_to from sessions where id = ?", id)).toEqual([
				{ reports_to: manager ?? null },
			]),
		{ timeout: 15000 },
	);
	await run.session.prompt("ready");
	return { run, id, script };
}
const mails = (run: Awaited<ReturnType<typeof fauxSession>>) =>
	run.session.messages.filter((message) => message.role === "custom" && message.customType === MAIL_CUSTOM_TYPE);
const result = (run: Awaited<ReturnType<typeof fauxSession>>) =>
	run.session.messages.filter((message) => message.role === "toolResult").at(-1);

test("escalation follows the manager chain and reaches the human without blocking the root", async () => {
	const root = await person();
	const leaf = await person(root.id);
	try {
		leaf.script.push(call("escalate", { body: "The rollout exceeds our agreed risk." }));
		await leaf.run.session.prompt("raise the risk");
		expect(result(leaf.run)).toMatchObject({ isError: false, details: { to: root.id } });
		await vi.waitFor(() => expect(mails(root.run)).toHaveLength(1), { timeout: 10000 });
		await vi.waitFor(() => expect(root.run.session.isStreaming).toBe(false), { timeout: 10000 });
		expect(withThreads((db) => threadsOf(db, "operator", true))).toEqual([]);
		root.script.push(call("escalate", { body: "Do you accept the rollout risk? I recommend waiting." }));
		await root.run.session.prompt("ask the operator");
		expect(result(root.run)).toMatchObject({ isError: false, details: { to: "operator" } });
		expect(root.run.session.messages.at(-1)).toMatchObject({
			role: "assistant",
			content: [expect.objectContaining({ text: "Continuing my work." })],
		});
		expect(withThreads((db) => threadsOf(db, "operator", true))).toMatchObject([{ subject: "Escalation", unread: 1 }]);
		root.script.push(call("directory", {}));
		await root.run.session.prompt("who is above us");
		expect(result(root.run)).toMatchObject({
			details: {
				members: expect.arrayContaining([
					expect.objectContaining({ id: "operator", manager: null }),
					expect.objectContaining({ id: root.id, manager: "Operator" }),
				]),
			},
		});
	} finally {
		await close(leaf.run);
		await close(root.run);
	}
}, 40000);

test("the operator reads once and replies to all participants as mail, never as a session prompt", async () => {
	const author = await person();
	const copied = await person(author.id);
	try {
		author.script.push(
			call("send_mail", { to: ["Operator"], cc: [copied.id], subject: "Approval", body: "Approve the change?" }),
		);
		await author.run.session.prompt("ask");
		const sent = result(author.run);
		expect(sent).toMatchObject({ isError: false });
		const thread = (sent!.details as { thread: string }).thread;
		const unread = withThreads((db) => threadsOf(db, "operator", true))!.find((row) => row.id === thread);
		expect(unread?.unread).toBe(1);
		const seq = query(state.dbPath, "select max(seq) as seq from thread_messages where thread_id = ?", thread)[0]
			.seq as number;
		await sendCommand(state.socketPath, "operator", { kind: "thread_read", thread, seq });
		expect(withThreads((db) => threadsOf(db, "operator", true))!.some((row) => row.id === thread)).toBe(false);
		const replied = await sendCommand(state.socketPath, "operator", {
			kind: "thread_post",
			thread,
			body: "Approved; keep the rollback ready.",
		});
		expect(replied.at(-1)?.stage).toBe("applied");
		for (const who of [author, copied]) {
			await vi.waitFor(() => expect(JSON.stringify(mails(who.run))).toContain("Approved; keep the rollback ready."), {
				timeout: 10000,
			});
		}
		expect(query(state.dbPath, "select 1 from commands where kind = 'talk'")).toEqual([]);
	} finally {
		await close(copied.run);
		await close(author.run);
	}
}, 40000);
