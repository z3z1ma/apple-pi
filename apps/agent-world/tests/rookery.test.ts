import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import bridge from "../../../components/session-state/src/index.js";
import { MAIL_CUSTOM_TYPE } from "../../../components/session-state/src/mail.js";
import {
	close,
	fakeBridge,
	standInProcess,
	startRuntime,
	stopRuntime,
	tempStateDir,
} from "../../../components/session-state/tests/helpers.js";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import { type Commands, openCommands } from "../src/backend/commands.js";
import { type Lifecycle, openLifecycle } from "../src/backend/lifecycle.js";
import { openWorldBackend, type WorldBackend } from "../src/backend/world-backend.js";
import type { FeedLine, MailItem } from "../src/world.js";

// Seam 1 for the rookery (ticket 16): the backend API over a real session-state runtime, with faux Pi sessions that
// mail each other through the bridge's `mailbox_send`, a stopped session whose mail waits, and the operator's own
// letters sent as `mail` commands with their receipts.
const state = tempStateDir();
let world: WorldBackend;
let commands: Commands;
let lifecycle: Lifecycle;
const runs: Awaited<ReturnType<typeof fauxSession>>[] = [];
const lines: FeedLine[] = [];
beforeAll(async () => {
	await startRuntime(state.socketPath);
	world = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
	world.subscribeFeed((batch) => lines.push(...batch));
	commands = openCommands(state.socketPath);
	lifecycle = openLifecycle({ db: state.dbPath, agentDir: state.agentDir }, commands, () => world.snapshot());
});
afterAll(async () => {
	for (const run of runs) await close(run);
	world.close();
	commands.close();
	await stopRuntime(state);
});

const soon = (check: () => void, timeout = 8000) => vi.waitFor(check, { timeout });
const mailTo = (to: string, message: string): Reply =>
	fauxAssistantMessage([fauxToolCall("mailbox_send", { session_id: to, message })], { stopReason: "toolUse" });
const mailItem = (body: string): MailItem | undefined => world.snapshot().mail?.find((item) => item.body === body);
const nameOf = (id: string) => world.snapshot().characters.find((c) => c.id === id)?.name;

/** A faux session that answers every turn with "noted", awake in the world. */
async function listener() {
	const run = await fauxSession([bridge], () => fauxAssistantMessage("noted"), []);
	runs.push(run);
	const id = run.session.sessionManager.getSessionId();
	await soon(() => expect(nameOf(id)).toBeDefined(), 15000);
	return { run, id };
}

test("mail between two sessions is listed, newest first, with sender, receiver, time, and delivery", async () => {
	const receiver = await listener();
	const sender = await fauxSession(
		[bridge],
		[
			mailTo(receiver.id, "Please review the parser."),
			fauxAssistantMessage("sent"),
			mailTo(receiver.id, "And the lexer."),
			fauxAssistantMessage("sent"),
		],
		["mailbox_send"],
	);
	runs.push(sender);
	const from = sender.session.sessionManager.getSessionId();
	await soon(() => expect(nameOf(from)).toBeDefined(), 15000);
	await sender.session.prompt("ask for a review");
	await sender.session.prompt("and another");

	await soon(() => expect(mailItem("And the lexer.")?.state).toBe("delivered"));
	const first = mailItem("Please review the parser.")!;
	expect(first).toMatchObject({
		from,
		fromName: nameOf(from),
		to: receiver.id,
		toName: nameOf(receiver.id),
		state: "delivered",
		reason: null,
	});
	expect(first.sentAt).toBeTypeOf("number");
	expect(first.deliveredAt).toBeGreaterThanOrEqual(first.sentAt);
	const bodies = world.snapshot().mail!.map((item) => item.body);
	expect(bodies.indexOf("And the lexer.")).toBeLessThan(bodies.indexOf("Please review the parser."));
}, 60000);

test("mail to a dormant agent waits until it wakes, and says so in its receipt", async () => {
	const stand = standInProcess();
	const link = await fakeBridge(state.socketPath, "sleepy", stand.pid, stand.startedAt, {
		session: { name: "sleepy" },
	});
	await soon(() => expect(nameOf("sleepy")).toBe("sleepy"));
	link.send({ type: "shutdown", reason: "quit" });
	link.socket.end();
	stand.child.kill();
	await soon(() => expect(world.snapshot().dormant?.map((agent) => agent.id)).toContain("sleepy"));

	expect(await lifecycle.sendMail("sleepy", "Rebase on main when you wake.")).toEqual({
		ok: true,
		stage: "accepted",
		note: "not running; the mail waits until it opens",
	});
	await soon(() =>
		expect(mailItem("Rebase on main when you wake.")).toMatchObject({
			from: "operator",
			fromName: "You",
			to: "sleepy",
			toName: "sleepy",
			state: "waiting",
			deliveredAt: null,
		}),
	);
	expect(await lifecycle.sendMail("sleepy", "   ")).toEqual({ ok: false, reason: "The message is empty." });
}, 30000);

test("a letter written as the operator reaches an awake agent's transcript, with its receipt and a feed line", async () => {
	const receiver = await listener();
	expect(await lifecycle.sendMail(receiver.id, "How is the parser going?")).toEqual({ ok: true, stage: "applied" });
	const delivered = receiver.run.session.messages.filter(
		(message) => message.role === "custom" && message.customType === MAIL_CUSTOM_TYPE,
	);
	expect(JSON.stringify(delivered)).toContain('from=\\"operator\\"');
	expect(JSON.stringify(delivered)).toContain("How is the parser going?");
	await soon(() => expect(mailItem("How is the parser going?")?.state).toBe("delivered"));
	await soon(() =>
		expect(lines.map((line) => line.text)).toContain(
			`Mail from you to ${nameOf(receiver.id)}: How is the parser going?`,
		),
	);
}, 60000);
