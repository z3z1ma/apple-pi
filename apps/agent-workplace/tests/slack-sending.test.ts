import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, beforeEach, expect, test } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { integrationFiles } from "../src/backend/integrations/credentials.js";
import { installSlackSending } from "../src/slack-sending.js";

const SEND = "mcp__slack__slack_send_message";
const SCHEDULE = "mcp__slack__slack_schedule_message";

let stateDir: string;
let calls: { method: string; params: URLSearchParams }[];
let mcpCalls: string[];
let answers: Record<string, unknown>;

beforeEach(() => {
	stateDir = mkdtempSync(join(tmpdir(), "aw-slack-sending-"));
	calls = [];
	mcpCalls = [];
	answers = {
		"chat.postMessage": { ok: true, ts: "1700000009.000100" },
		"chat.scheduleMessage": { ok: true, scheduled_message_id: "Q1" },
		"conversations.open": { ok: true, channel: { id: "D42" } },
		"conversations.info": { ok: true, channel: { id: "C1", name: "releases" } },
	};
});
afterEach(() => rmSync(stateDir, { recursive: true, force: true }));

function signIn(sendAsMe?: boolean) {
	writeFileSync(
		integrationFiles(stateDir).credentials,
		JSON.stringify({
			slack: { token: "xoxc-1", cookie: "xoxd-1", team: "Acme", url: "https://acme.slack.com/", user: "me", sendAsMe },
		}),
	);
}

const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
	const method = String(url).split("/api/")[1] ?? "";
	calls.push({ method, params: new URLSearchParams(String(init?.body)) });
	return new Response(JSON.stringify(answers[method] ?? { ok: false, error: "unknown_method" }));
}) as typeof globalThis.fetch;

function fakeMcp(pi: ExtensionAPI) {
	for (const name of [SEND, SCHEDULE])
		pi.registerTool({
			name,
			label: name,
			description: name,
			parameters: Type.Object({}, { additionalProperties: true }),
			async execute() {
				mcpCalls.push(name);
				return { content: [{ type: "text", text: "Sent using the Slack app" }], details: {} };
			},
		});
}

async function call(name: string, input: Record<string, string | number>) {
	const run = await fauxSession(
		[
			fakeMcp,
			(pi) => {
				pi.on("session_start", () => pi.setSessionName("Ada Lovelace"));
				installSlackSending(pi, { stateDir: () => stateDir, fetch });
			},
		],
		[fauxAssistantMessage([fauxToolCall(name, input)], { stopReason: "toolUse" }), fauxAssistantMessage("done")],
		[SEND, SCHEDULE],
	);
	try {
		await run.session.prompt("send it");
		const result = run.session.messages.find((message) => message.role === "toolResult");
		if (result?.role !== "toolResult") throw new Error("no tool result");
		const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
		return { isError: result.isError, text };
	} finally {
		run.dispose();
	}
}

const recorded = () =>
	readFileSync(integrationFiles(stateDir).record, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));

test("with sending as the operator off, the Slack app's tool sends as usual", async () => {
	signIn();
	expect(await call(SEND, { channel_id: "C1", message: "hi" })).toEqual({
		isError: false,
		text: "Sent using the Slack app",
	});
	expect(mcpCalls).toEqual([SEND]);
	expect(calls).toEqual([]);
});

test("with it on, the message goes out as the operator in Markdown, succeeds, and is recorded", async () => {
	signIn(true);
	const result = await call(SEND, { channel_id: "C1", message: "**Ship** it", thread_ts: "1700000001.000200" });
	expect(mcpCalls).toEqual([]);
	const post = calls.find((each) => each.method === "chat.postMessage")?.params;
	expect(Object.fromEntries(post ?? [])).toEqual({
		token: "xoxc-1",
		channel: "C1",
		markdown_text: "**Ship** it",
		thread_ts: "1700000001.000200",
	});
	expect(result.isError).toBe(false);
	expect(result.text).toContain(
		"https://acme.slack.com/archives/C1/p1700000009000100?thread_ts=1700000001.000200&cid=C1",
	);
	expect(recorded()).toEqual([
		expect.objectContaining({
			kind: "slack-message",
			by: "Ada Lovelace",
			where: "#releases",
			text: "**Ship** it",
			ok: true,
		}),
	]);
});

test("a direct message to a person opens the conversation first, and a scheduled one is scheduled", async () => {
	signIn(true);
	answers["conversations.info"] = { ok: true, channel: { id: "D42", is_im: true, user: "U7" } };
	answers["users.info"] = { ok: true, user: { name: "ben", profile: { display_name: "Ben" } } };
	const result = await call(SCHEDULE, { channel_id: "U7", message: "later", post_at: 1800000000 });
	expect(mcpCalls).toEqual([]);
	expect(calls[0]).toMatchObject({ method: "conversations.open" });
	expect(Object.fromEntries(calls.find((each) => each.method === "chat.scheduleMessage")?.params ?? [])).toMatchObject({
		channel: "D42",
		markdown_text: "later",
		post_at: "1800000000",
	});
	expect(result).toMatchObject({ isError: false, text: expect.stringContaining("Scheduled as the operator") });
	expect(recorded()[0]).toMatchObject({ where: "Ben", what: "Schedule Slack message" });
});

test("a signed-out session falls back to the Slack app; another refusal fails without it", async () => {
	signIn(true);
	answers["chat.postMessage"] = { ok: false, error: "invalid_auth" };
	expect(await call(SEND, { channel_id: "C1", message: "hi" })).toMatchObject({ isError: false });
	expect(mcpCalls).toEqual([SEND]);
	mcpCalls = [];
	answers["chat.postMessage"] = { ok: false, error: "channel_not_found" };
	expect(await call(SEND, { channel_id: "C1", message: "hi" })).toMatchObject({
		isError: true,
		text: expect.stringContaining("channel_not_found"),
	});
	expect(mcpCalls).toEqual([]);
	expect(recorded()).toEqual([expect.objectContaining({ ok: false, reason: "Slack said channel_not_found." })]);
});
