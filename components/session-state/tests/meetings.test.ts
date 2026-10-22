import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import bridge from "../src/index.js";
import { MAIL_CUSTOM_TYPE } from "../src/mail.js";
import { close, query, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
beforeAll(() => startRuntime(state.socketPath));
afterAll(() => stopRuntime(state));
const call = (name: string, args: Parameters<typeof fauxToolCall>[1]): Reply =>
	fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
async function person() {
	const script: Reply[] = [];
	const run = await fauxSession([bridge], () => script.shift() ?? fauxAssistantMessage("noted"), []);
	const id = run.session.sessionManager.getSessionId();
	await vi.waitFor(() => expect(query(state.dbPath, "select 1 from sessions where id = ?", id)).toHaveLength(1), {
		timeout: 15000,
	});
	await run.session.prompt("ready");
	return { run, id, script };
}
const mail = (run: Awaited<ReturnType<typeof fauxSession>>) =>
	JSON.stringify(
		run.session.messages.filter((message) => message.role === "custom" && message.customType === MAIL_CUSTOM_TYPE),
	);
const result = (run: Awaited<ReturnType<typeof fauxSession>>) =>
	run.session.messages.filter((message) => message.role === "toolResult").at(-1)!;

test("a meeting pushes its agenda and discussion to everyone; only the organizer ends it with a final summary", async () => {
	const organizer = await person();
	const reviewer = await person();
	const engineer = await person();
	try {
		organizer.script.push(
			call("meet", { people: [reviewer.id, engineer.id], agenda: "Choose the safer release plan." }),
		);
		await organizer.run.session.prompt("meet");
		expect(result(organizer.run)).toMatchObject({ isError: false });
		const thread = (result(organizer.run).details as { thread: string }).thread;
		for (const who of [reviewer, engineer]) {
			await vi.waitFor(() => expect(mail(who.run)).toContain("Choose the safer release plan."), { timeout: 10000 });
			await vi.waitFor(() => expect(who.run.session.isStreaming).toBe(false));
		}
		reviewer.script.push(call("reply", { thread, body: "Canary first; I verified the rollback." }));
		await reviewer.run.session.prompt("answer");
		for (const who of [organizer, engineer]) {
			await vi.waitFor(() => expect(mail(who.run)).toContain("Canary first; I verified the rollback."));
			await vi.waitFor(() => expect(who.run.session.isStreaming).toBe(false));
		}
		reviewer.script.push(call("end_meeting", { thread, summary: "I decide." }));
		await reviewer.run.session.prompt("try to end someone else's meeting");
		expect(result(reviewer.run)).toMatchObject({
			isError: true,
			content: [expect.objectContaining({ text: expect.stringContaining("only the organizer") })],
		});
		organizer.script.push(call("end_meeting", { thread, summary: "Canary agreed. Rollback verified; watch latency." }));
		await organizer.run.session.prompt("conclude");
		expect(result(organizer.run)).toMatchObject({ isError: false });
		for (const who of [reviewer, engineer]) {
			await vi.waitFor(() => expect(mail(who.run)).toContain("Canary agreed. Rollback verified; watch latency."));
			await vi.waitFor(() => expect(who.run.session.isStreaming).toBe(false));
		}
		engineer.script.push(call("reply", { thread, body: "Another round?" }));
		await engineer.run.session.prompt("late answer");
		expect(result(engineer.run)).toMatchObject({
			isError: true,
			content: [expect.objectContaining({ text: expect.stringContaining("closed") })],
		});
		expect(query(state.dbPath, "select closed_at from threads where id = ?", thread)).toEqual([
			{ closed_at: expect.any(Number) },
		]);
		expect(query(state.dbPath, "select body from thread_messages where thread_id = ? order by seq", thread)).toEqual([
			{ body: "Choose the safer release plan." },
			{ body: "Canary first; I verified the rollback." },
			{ body: "Meeting ended.\n\nCanary agreed. Rollback verified; watch latency." },
		]);
	} finally {
		for (const who of [reviewer, engineer, organizer]) await close(who.run);
	}
}, 40000);
