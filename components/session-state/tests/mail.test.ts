import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { type AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, expect, test, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import bridge from "../src/index.js";
import { MAIL_CUSTOM_TYPE } from "../src/mail.js";
import { close, query, runtimePid, sendCommand, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
const dirs: string[] = [];
afterAll(async () => {
	await stopRuntime(state);
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

type MailRow = {
	sender: string;
	receiver: string;
	body: string;
	sent_at: number;
	delivered_at: number | null;
	stage: string;
};
const mail = (receiver: string) =>
	query<MailRow>(state.dbPath, "select * from mail where receiver = ? order by sent_at", receiver);
const seen = (id: string) =>
	vi.waitFor(() => expect(query(state.dbPath, "select 1 from sessions where id = ?", id)).toHaveLength(1), {
		timeout: 15000,
	});
const mailIn = (session: AgentSession) =>
	session.messages.filter((m) => m.role === "custom" && m.customType === MAIL_CUSTOM_TYPE);
const mailTo = (to: string, message: string): Reply =>
	fauxAssistantMessage([fauxToolCall("send_mail", { to: [to], subject: "Note", body: message })], {
		stopReason: "toolUse",
	});
const sawText = (requests: { messages: unknown[] }[], text: string) =>
	requests.some((request) => JSON.stringify(request.messages).includes(text));

test("pi-send with no runtime running starts one and the mail waits for its session", async () => {
	expect(runtimePid(state.pidPath)).toBeUndefined();
	const script = new URL("../scripts/pi-send.mjs", import.meta.url).pathname;
	const { stdout, stderr } = await promisify(execFile)(
		process.execPath,
		[script, "mail-target-1", "--from", "launchd", "Nightly sweep finished."],
		{ env: process.env, timeout: 20000 },
	);
	expect(stdout.trim()).toMatch(/^[0-9a-f-]{36}$/);
	expect(stderr).toContain("waits until a session with this id opens");
	expect(runtimePid(state.pidPath)).toBeDefined();
	expect(mail("mail-target-1")).toMatchObject([
		{ sender: "launchd", body: "Nightly sweep finished.", delivered_at: null },
	]);

	const run = await fauxSession([bridge], [fauxAssistantMessage("on it")], [], {
		sessionManager: SessionManager.inMemory(undefined, { id: "mail-target-1" }),
	});
	try {
		await seen("mail-target-1");
		await run.session.prompt("morning");
		expect(sawText(run.requests, "Nightly sweep finished.")).toBe(true);
		await vi.waitFor(() => expect(mail("mail-target-1")[0].delivered_at).not.toBeNull(), { timeout: 5000 });
	} finally {
		await close(run);
	}
}, 40000);

test("mail between sessions starts a turn when idle and steers a running turn, and records sender, receiver, and delivery", async () => {
	let release: (reply: Reply) => void = () => {};
	const receiver = await fauxSession(
		[bridge],
		(context) => {
			const last = JSON.stringify(context.messages.at(-1));
			if (last.includes("work long")) return new Promise<Reply>((resolve) => (release = resolve));
			return fauxAssistantMessage("noted");
		},
		[],
	);
	const to = receiver.session.sessionManager.getSessionId();
	const sender = await fauxSession(
		[bridge],
		[
			mailTo(to, "please review"),
			fauxAssistantMessage("sent"),
			mailTo(to, "switch to docs"),
			fauxAssistantMessage("sent"),
		],
		["send_mail"],
	);
	const from = sender.session.sessionManager.getSessionId();
	try {
		await seen(to);
		await seen(from);
		// The receiver has not run yet: live mail still starts a turn; only mail that waited for it rides the next one.
		await sender.session.prompt("ask for a review");
		await vi.waitFor(() => expect(mailIn(receiver.session)).toHaveLength(1), { timeout: 10000 });
		await vi.waitFor(() => expect(receiver.session.messages.at(-1)).toMatchObject({ role: "assistant" }));
		expect(sawText(receiver.requests, "please review")).toBe(true);

		const turn = receiver.session.prompt("work long");
		await vi.waitFor(() => expect(receiver.session.isStreaming).toBe(true));
		await sender.session.prompt("redirect it");
		// Handed to the receiver while its run still waits on the model.
		await vi.waitFor(() => expect(mail(to)[1]).toMatchObject({ body: "switch to docs", stage: "delivered" }));
		const before = receiver.requests.length;
		release(fauxAssistantMessage("working"));
		await turn; // the steer joined this run: its model saw the mail without a new prompt
		expect(receiver.requests.length).toBeGreaterThan(before);
		expect(sawText(receiver.requests.slice(before), "switch to docs")).toBe(true);

		await vi.waitFor(() => expect(mail(to).every((row) => row.delivered_at !== null)).toBe(true), { timeout: 5000 });
		for (const row of mail(to)) {
			expect(row).toMatchObject({ sender: from, receiver: to });
			expect(row.delivered_at).toBeGreaterThanOrEqual(row.sent_at);
		}
	} finally {
		await close(sender);
		await close(receiver);
	}
}, 40000);

test("mail that piles up during a run arrives together at the next boundary, in one model request", async () => {
	let release: (reply: Reply) => void = () => {};
	const receiver = await fauxSession(
		[bridge],
		(context) => {
			const last = JSON.stringify(context.messages.at(-1));
			if (last.includes("work long")) return new Promise<Reply>((resolve) => (release = resolve));
			return fauxAssistantMessage("noted");
		},
		[],
	);
	const to = receiver.session.sessionManager.getSessionId();
	const notes = ["first note", "second note", "third note"];
	const sender = await fauxSession(
		[bridge],
		[
			fauxAssistantMessage(
				notes.map((body) => fauxToolCall("send_mail", { to: [to], subject: "Note", body })),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("sent"),
		],
		["send_mail"],
	);
	try {
		await seen(to);
		await seen(sender.session.sessionManager.getSessionId());
		const turn = receiver.session.prompt("work long");
		await vi.waitFor(() => expect(receiver.session.isStreaming).toBe(true));
		await sender.session.prompt("send three notes");
		await vi.waitFor(() => expect(mail(to).filter((row) => row.stage === "delivered")).toHaveLength(3));
		const before = receiver.requests.length;
		release(fauxAssistantMessage("working"));
		await turn;
		const after = receiver.requests.slice(before);
		expect(after).toHaveLength(1);
		for (const note of notes) expect(sawText(after, note)).toBe(true);
	} finally {
		await close(sender);
		await close(receiver);
	}
}, 40000);

test("mail to a stopped session waits and arrives in its next turn after it opens", async () => {
	const sessionDir = mkdtempSync(join(tmpdir(), "aps-mail-sessions-"));
	dirs.push(sessionDir);
	const first = await fauxSession([bridge], [fauxAssistantMessage("hi")], [], {
		sessionManager: SessionManager.create(tmpdir(), sessionDir),
	});
	const id = first.session.sessionManager.getSessionId();
	const file = first.session.sessionManager.getSessionFile() as string;
	try {
		await seen(id);
		await first.session.prompt("hi");
	} finally {
		await close(first);
	}

	const receipts = await sendCommand(state.socketPath, id, {
		kind: "mail",
		from: "coordinator-1",
		body: "pick up ticket 7",
		sentAt: new Date().toISOString(),
	});
	expect(receipts).toEqual([{ stage: "accepted", reason: "not running; the mail waits until it opens" }]);
	expect(mail(id)).toMatchObject([{ body: "pick up ticket 7", delivered_at: null }]);

	const reopened = await fauxSession([bridge], [fauxAssistantMessage("picking it up")], [], {
		sessionManager: SessionManager.open(file, sessionDir),
	});
	try {
		// The reopened session's bridge has the waiting mail before the first prompt.
		await vi.waitFor(
			() =>
				expect(query(state.dbPath, "select stage from commands where session_id = ? and kind = 'mail'", id)).toEqual([
					{ stage: "delivered" },
				]),
			{ timeout: 15000 },
		);
		expect(reopened.requests).toHaveLength(0);
		await reopened.session.prompt("resume");
		expect(sawText(reopened.requests, "pick up ticket 7")).toBe(true);
		expect(mailIn(reopened.session)).toHaveLength(1);
		await vi.waitFor(() => expect(mail(id)[0].delivered_at).not.toBeNull(), { timeout: 5000 });
	} finally {
		await close(reopened);
	}
}, 40000);

test("a worker that closes mails its supervisor, but not on reload", async () => {
	const supervisor = await fauxSession([bridge], [fauxAssistantMessage("noted")], []);
	const supervisorId = supervisor.session.sessionManager.getSessionId();
	const worker = await fauxSession(
		[
			(pi) => {
				const getFlag = pi.getFlag.bind(pi);
				pi.getFlag = (name) => (name === "reports-to" ? supervisorId : getFlag(name));
				bridge(pi);
			},
		],
		[],
		[],
	);
	try {
		await seen(supervisorId);
		await supervisor.session.prompt("start"); // past startup, so mail starts a turn
		worker.session.sessionManager.appendSessionInfo("docs-worker");
		const workerId = worker.session.sessionManager.getSessionId();
		await worker.session.bindExtensions({}); // the recorded reporting line survives a rebind
		await vi.waitFor(
			() =>
				expect(query(state.dbPath, "select reports_to from sessions where id = ?", workerId)).toEqual([
					{ reports_to: supervisorId },
				]),
			{ timeout: 10000 },
		);
		await worker.session.extensionRunner.emit({ type: "session_shutdown", reason: "reload" }); // no notice
		worker.session.sessionManager.appendSessionInfo("docs-worker-reloaded");
		await worker.session.bindExtensions({});
		await vi.waitFor(
			() =>
				expect(query(state.dbPath, "select name from sessions where id = ?", workerId)).toEqual([
					{ name: "docs-worker-reloaded" },
				]),
			{ timeout: 10000 },
		);
		expect(mailIn(supervisor.session)).toHaveLength(0);
		await worker.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		await vi.waitFor(() => expect(mailIn(supervisor.session)).toHaveLength(1), { timeout: 10000 });
		const details = (mailIn(supervisor.session)[0] as { details: { from: string; body: string } }).details;
		expect(details.from).toBe(worker.session.sessionManager.getSessionId());
		expect(details.body).toBe(`Session "docs-worker-reloaded" closed (quit) while idle. Directory: ${worker.cwd}`);
	} finally {
		await close(worker);
		await close(supervisor);
	}
}, 30000);

test("mail counts as delivered only once the session's file holds it", async () => {
	const sessionDir = mkdtempSync(join(tmpdir(), "aps-mail-disk-"));
	dirs.push(sessionDir);
	let release: (reply: Reply) => void = () => {};
	const receiver = await fauxSession([bridge], () => new Promise<Reply>((resolve) => (release = resolve)), [], {
		sessionManager: SessionManager.create(tmpdir(), sessionDir),
	});
	const id = receiver.session.sessionManager.getSessionId();
	try {
		await seen(id);
		const sending = sendCommand(state.socketPath, id, {
			kind: "mail",
			from: "coordinator-1",
			body: "first thing",
			sentAt: new Date().toISOString(),
		});
		await vi.waitFor(() => expect(mailIn(receiver.session)).toHaveLength(1), { timeout: 10000 });
		// The mail opened the session's first turn; Pi writes no file until a reply exists, so it is not delivered.
		await new Promise((resolve) => setTimeout(resolve, 1500));
		expect(mail(id)[0]).toMatchObject({ stage: "delivered", delivered_at: null });
		release(fauxAssistantMessage("on it"));
		expect((await sending).at(-1)).toEqual({ stage: "applied" });
	} finally {
		await close(receiver);
	}
}, 30000);

test("no mailbox file is written or read", () => {
	expect(readdirSync(join(state.agentDir, "state"))).not.toContain("mailbox");
});
