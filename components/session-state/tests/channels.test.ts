import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import bridge from "../src/index.js";
import { MAIL_CUSTOM_TYPE } from "../src/mail.js";
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
const seen = (id: string) =>
	vi.waitFor(() => expect(query(state.dbPath, "select 1 from sessions where id = ?", id)).toHaveLength(1), {
		timeout: 15000,
	});
const person = async (id: string, manager: string | null) => {
	const stand = standInProcess();
	processes.push(stand);
	const link = await fakeBridge(state.socketPath, id, stand.pid, stand.startedAt, {
		session: { name: id },
		facts: { reportsTo: manager },
	});
	await seen(id);
	return link;
};
const call = (name: string, args: Parameters<typeof fauxToolCall>[1]): Reply =>
	fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const result = (run: Awaited<ReturnType<typeof fauxSession>>) =>
	run.session.messages.filter((m) => m.role === "toolResult").at(-1);
const mails = (run: Awaited<ReturnType<typeof fauxSession>>) =>
	run.session.messages.filter((m) => m.role === "custom" && m.customType === MAIL_CUSTOM_TYPE);
const members = (channel: string) =>
	query(
		state.dbPath,
		"select participant from thread_participants where thread_id = ? order by participant",
		channel,
	).map((p) => p.participant);
const command = async (who: string, message: Parameters<typeof sendCommand>[2]) =>
	(await sendCommand(state.socketPath, who, message)).at(-1);

async function colleague(name: string, manager?: string) {
	const script: Reply[] = [];
	const run = await fauxSession([bridge], () => script.shift() ?? fauxAssistantMessage("received"), []);
	const id = run.session.sessionManager.getSessionId();
	run.session.sessionManager.appendSessionInfo(name);
	if (manager) run.session.extensionRunner.setFlagValue("reports-to", manager);
	await run.session.bindExtensions({});
	await vi.waitFor(
		() =>
			expect(query(state.dbPath, "select name, reports_to from sessions where id = ?", id)).toEqual([
				{ name, reports_to: manager ?? null },
			]),
		{ timeout: 15000 },
	);
	await run.session.prompt("ready");
	return { run, id, script };
}

test("channels are pulled; only a named participant receives a post as a turn", async () => {
	const lead = await colleague("Lead");
	const ada = await colleague("Ada Lovelace", lead.id);
	const channel = `team:${lead.id}`;
	try {
		await person("ch-ben", lead.id);
		lead.script.push(call("post", { channel, body: "Build is green. Adaline is not a mention." }));
		await lead.run.session.prompt("post the update");
		expect(result(lead.run)).toMatchObject({ isError: false });
		expect(query(state.dbPath, "select 1 from commands where kind = 'mail'")).toEqual([]);
		expect(mails(ada.run)).toEqual([]);

		ada.script.push(call("inbox", {}));
		await ada.run.session.prompt("check the channel");
		expect(result(ada.run)).toMatchObject({
			isError: false,
			details: { threads: [expect.objectContaining({ id: channel, unread: 1 })] },
		});
		ada.script.push(call("read_thread", { thread: channel }));
		await ada.run.session.prompt("read it");
		expect(result(ada.run)).toMatchObject({
			isError: false,
			details: { messages: [expect.objectContaining({ body: "Build is green. Adaline is not a mention." })] },
		});

		lead.script.push(call("post", { channel, body: "@Ada Lovelace, check the deployment." }));
		await lead.run.session.prompt("ask Ada");
		await vi.waitFor(() => expect(mails(ada.run)).toHaveLength(1), { timeout: 10000 });
		expect(query(state.dbPath, "select session_id from commands where kind = 'mail'")).toEqual([
			{ session_id: ada.id },
		]);
		await vi.waitFor(() => expect(ada.run.session.isStreaming).toBe(false), { timeout: 10000 });
		expect(ada.run.session.messages.at(-1)).toMatchObject({
			role: "assistant",
			content: [expect.objectContaining({ text: "received" })],
		});
		// A later, unaddressed reply stays pulled: a mention never subscribes someone to every post.
		lead.script.push(call("reply", { thread: channel, body: "Deployment finished." }));
		await lead.run.session.prompt("post the outcome");
		expect(query(state.dbPath, "select session_id from commands where kind = 'mail'")).toEqual([
			{ session_id: ada.id },
		]);
	} finally {
		await close(ada.run);
		await close(lead.run);
	}
}, 40000);

test("moving teams changes channel membership and an outsider needs an invitation", async () => {
	await person("ch-root", null);
	await person("ch-old", "ch-root");
	await person("ch-new", "ch-root");
	await person("ch-report", "ch-old");
	await person("ch-guest", null);
	const old = "team:ch-old";
	const next = "team:ch-new";
	expect(members(old)).toEqual(["ch-old", "ch-report"]);
	expect(
		await command("ch-guest", {
			kind: "thread_post",
			thread: old,
			threadKind: "channel",
			body: "Let me in",
			to: ["ch-guest"],
		}),
	).toMatchObject({ stage: "failed", reason: "you are not in this thread" });
	expect(await command("ch-report", { kind: "transfer", manager: "ch-new", by: "ch-root" })).toMatchObject({
		stage: "applied",
	});
	expect(members(old)).toEqual(["ch-old"]);
	expect(members(next)).toEqual(["ch-new", "ch-report"]);
	expect(await command("ch-report", { kind: "thread_post", thread: old, body: "Old team" })).toMatchObject({
		stage: "failed",
		reason: "you are not in this thread",
	});
	expect(
		await command("ch-new", {
			kind: "thread_post",
			thread: next,
			threadKind: "channel",
			body: "Invited a reviewer.",
			to: ["ch-guest"],
		}),
	).toMatchObject({ stage: "applied" });
	expect(await command("ch-guest", { kind: "thread_post", thread: next, body: "Here is what I found." })).toMatchObject(
		{ stage: "applied" },
	);
	expect(query(state.dbPath, "select 1 from commands where kind = 'mail' and session_id = 'ch-guest'")).toEqual([]);
	await command("ch-report", { kind: "transfer", manager: "ch-old", by: "ch-root" });
	expect(members(next)).toEqual(["ch-guest", "ch-new"]);
}, 30000);

test("post invites by name and refuses a mail thread in place of a channel", async () => {
	const lead = await colleague("Inviter");
	try {
		await person("ch-invitee", lead.id);
		lead.script.push(call("post", { channel: `team:${lead.id}`, body: "Shared context.", invite: ["ch-invitee"] }));
		await lead.run.session.prompt("invite");
		expect(result(lead.run)).toMatchObject({ isError: false });
		await command(lead.id, {
			kind: "thread_post",
			thread: "t-not-channel",
			subject: "Mail",
			to: ["ch-invitee"],
			body: "Hello.",
		});
		lead.script.push(call("post", { channel: "t-not-channel", body: "Not a channel." }));
		await lead.run.session.prompt("wrong channel");
		expect(result(lead.run)).toMatchObject({ isError: true });
	} finally {
		await close(lead.run);
	}
}, 30000);
