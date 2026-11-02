import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { expect, test, vi } from "vitest";
import bridge from "../../../components/session-state/src/index.js";
import {
	close,
	query,
	startRuntime,
	stopRuntime,
	tempStateDir,
} from "../../../components/session-state/tests/helpers.js";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { openCommands } from "../src/backend/commands.js";
import { openMailbox } from "../src/backend/mail.js";
import { openWorldBackend } from "../src/backend/world-backend.js";

const state = tempStateDir();
test("the world shows unread operator threads, reading clears attention, and a reply reaches everyone as mail", async () => {
	await startRuntime(state.socketPath);
	const world = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
	const commands = openCommands(state.socketPath);
	const mailbox = openMailbox(state.dbPath, commands);
	const colleague = await fauxSession([bridge], () => fauxAssistantMessage("noted"), []);
	const colleagueId = colleague.session.sessionManager.getSessionId();
	const author = await fauxSession(
		[bridge],
		[
			fauxAssistantMessage(
				[
					fauxToolCall("send_mail", {
						to: ["operator"],
						cc: [colleagueId],
						subject: "Release approval",
						body: "May we release?",
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("continuing"),
		],
		[],
	);
	try {
		await vi.waitFor(
			() => expect(query(state.dbPath, "select 1 from sessions where id = ?", colleagueId)).toHaveLength(1),
			{ timeout: 15000 },
		);
		await colleague.session.prompt("ready");
		await author.session.prompt("ask");
		expect(author.session.messages.filter((message) => message.role === "toolResult").at(-1)).toMatchObject({
			isError: false,
		});
		await vi.waitFor(
			() =>
				expect(world.snapshot().operatorMail).toEqual([
					expect.objectContaining({ subject: "Release approval", unread: 1 }),
				]),
			{ timeout: 15000 },
		);
		const id = world.snapshot().operatorMail![0].id;
		const read = await mailbox.readThread(id);
		expect(read).toMatchObject({
			ok: true,
			thread: {
				messages: [expect.objectContaining({ body: "May we release?" })],
				participants: expect.arrayContaining([expect.objectContaining({ id: "operator" })]),
			},
		});
		await vi.waitFor(() => expect(world.snapshot().operatorMail?.[0].unread).toBe(0), { timeout: 10000 });
		expect(await mailbox.replyThread(id, "Approved.")).toEqual({ ok: true, stage: "applied" });
		for (const run of [author, colleague])
			await vi.waitFor(() => expect(JSON.stringify(run.session.messages)).toContain("Approved."), { timeout: 10000 });
		expect(query(state.dbPath, "select kind from commands where kind = 'talk'")).toEqual([]);
		expect(await mailbox.readThread("not-a-thread")).toMatchObject({ ok: false });
		expect(await mailbox.replyThread(id, " ")).toMatchObject({ ok: false });
	} finally {
		await close(author);
		await close(colleague);
		commands.close();
		world.close();
		await stopRuntime(state);
	}
}, 40000);
