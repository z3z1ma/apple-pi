import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import {
	fakeBridge,
	query,
	standInProcess,
	startRuntime,
	stopRuntime,
	tempStateDir,
} from "../../../components/session-state/tests/helpers.js";
import { type Conversations, openConversations, PAGE_SIZE } from "../src/backend/conversations.js";
import { openWorldBackend, type WorldBackend } from "../src/backend/world-backend.js";
import type { ConversationPage, TranscriptEntry, WorldSnapshot } from "../src/world.js";

// Seam 1 for the conversation panel: the backend API in Node, without Electron, over a real session-state runtime.
const state = tempStateDir();
const dir = mkdtempSync(join(tmpdir(), "aw-conversation-"));
const proc = standInProcess();
const bridges: Awaited<ReturnType<typeof fakeBridge>>[] = [];
let conversations: Conversations;
let world: WorldBackend;
beforeAll(async () => {
	await startRuntime(state.socketPath);
	conversations = openConversations(state.socketPath);
	world = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
});
afterAll(async () => {
	conversations.close();
	world.close();
	for (const bridge of bridges) bridge.socket.destroy();
	proc.child.kill();
	await stopRuntime(state);
	rmSync(dir, { recursive: true, force: true });
});

const START = Date.parse("2026-10-19T09:00:00Z");
type Raw = { type: string; id: string; timestamp: string } & Record<string, unknown>;
const stamp = (n: number) => new Date(START + n * 1000).toISOString();

/** Write `entries` as Pi's session JSONL and report them to the runtime's index as the bridge would. */
async function indexedSession(id: string, entries: Raw[], extra: Record<string, unknown> = {}) {
	const file = join(dir, `${id}.jsonl`);
	const header = { type: "session", id: "header", timestamp: stamp(0) };
	writeFileSync(file, `${[header, ...entries].map((entry) => JSON.stringify(entry)).join("\n")}\n`);
	const bridge = await fakeBridge(state.socketPath, id, proc.pid, proc.startedAt, { session: { file, ...extra } });
	bridges.push(bridge);
	const rows = entries.map((entry) => ({
		entryId: entry.id,
		part: "",
		at: Date.parse(entry.timestamp),
		role: entry.type === "custom_message" ? "custom" : (entry.message as { role: string }).role,
		size: 1,
		preview: "",
	}));
	bridge.send({ type: "index", rows });
	await vi.waitFor(
		() =>
			expect(query(state.dbPath, "select count(*) as n from messages where session_id = ?", id)).toEqual([
				{ n: rows.length },
			]),
		{ timeout: 10000 },
	);
	return bridge;
}

const message = (id: string, n: number, body: Record<string, unknown>): Raw => ({
	type: "message",
	id,
	timestamp: stamp(n),
	message: body,
});

/** A short, real-looking session: a request, thinking, a tool call and its result, mail, and a reply with code. */
const SESSION: Raw[] = [
	message("u1", 1, { role: "user", content: "Run the session-state suite and fix whatever breaks." }),
	message("a1", 2, {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "Start with the suite." },
			{ type: "text", text: "Running the suite first." },
			{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "npx vitest run components\nexit" } },
		],
		stopReason: "toolUse",
	}),
	message("r1", 3, {
		role: "toolResult",
		toolCallId: "call-1",
		toolName: "bash",
		content: [{ type: "text", text: "2 failed | 40 passed" }],
		isError: true,
	}),
	{
		type: "custom_message",
		id: "m1",
		timestamp: stamp(4),
		customType: "apple-pi.mailbox-message",
		content: '<mailbox-message id="x" from="orla" ts="t">\nRebase on main first.\n</mailbox-message>',
		display: true,
		details: { id: "x", from: "orla", ts: "t", body: "Rebase on main first." },
	},
	{
		type: "custom_message",
		id: "n1",
		timestamp: stamp(5),
		customType: "pair-findings",
		content: [{ type: "text", text: "Consider the timeout." }],
		display: false,
	},
	message("a2", 6, {
		role: "assistant",
		content: [{ type: "text", text: "Fixed:\n\n```ts\nawait vi.waitFor(check, { timeout: 5000 });\n```" }],
		stopReason: "stop",
	}),
	message("u2", 7, {
		role: "user",
		content: [
			{ type: "text", text: "Thanks. Look at this:" },
			{ type: "image", data: "", mimeType: "image/png" },
		],
	}),
	message("a3", 8, { role: "assistant", content: [], stopReason: "error", errorMessage: "overloaded" }),
];

const ok = (page: ConversationPage) => {
	if (!page.ok) throw new Error(`expected a page, got: ${page.reason}`);
	return page;
};

test("a page of a conversation comes from the session's transcript, each entry shaped for the panel, oldest first", async () => {
	await indexedSession("talk-1", SESSION);
	const page = ok(await conversations.page("talk-1"));
	expect(page.before).toBeNull();
	expect(page.missing).toBe(0);
	expect(page.entries).toEqual<TranscriptEntry[]>([
		{
			kind: "user",
			id: "u1",
			at: START + 1000,
			text: "Run the session-state suite and fix whatever breaks.",
			images: 0,
		},
		{
			kind: "assistant",
			id: "a1",
			at: START + 2000,
			parts: [
				{ kind: "thinking", text: "Start with the suite." },
				{ kind: "text", text: "Running the suite first." },
				{
					kind: "tool",
					call: {
						id: "call-1",
						name: "bash",
						arg: "npx vitest run components",
						input: JSON.stringify({ command: "npx vitest run components\nexit" }, null, 2),
					},
				},
			],
			error: null,
			aborted: false,
		},
		{
			kind: "tool-result",
			id: "r1",
			at: START + 3000,
			callId: "call-1",
			tool: "bash",
			text: "2 failed | 40 passed",
			isError: true,
			cut: false,
		},
		{ kind: "mail", id: "m1", at: START + 4000, from: "orla", text: "Rebase on main first." },
		{ kind: "note", id: "n1", at: START + 5000, label: "pair-findings", text: "Consider the timeout.", shown: false },
		{
			kind: "assistant",
			id: "a2",
			at: START + 6000,
			parts: [{ kind: "text", text: "Fixed:\n\n```ts\nawait vi.waitFor(check, { timeout: 5000 });\n```" }],
			error: null,
			aborted: false,
		},
		{ kind: "user", id: "u2", at: START + 7000, text: "Thanks. Look at this:", images: 1 },
		{ kind: "assistant", id: "a3", at: START + 8000, parts: [], error: "overloaded", aborted: false },
	]);
}, 30000);

test("pages run newest first with cursors, and every entry of a long transcript arrives once, in order", async () => {
	const count = PAGE_SIZE * 4 + 7;
	const long: Raw[] = [];
	for (let i = 0; i < count; i++)
		long.push(
			i % 2
				? message(`e${i}`, i, {
						role: "assistant",
						content: [{ type: "text", text: `reply ${i}` }],
						stopReason: "stop",
					})
				: message(`e${i}`, i, { role: "user", content: `ask ${i}` }),
		);
	await indexedSession("long-1", long);
	const seen: string[] = [];
	const cursors: (string | null)[] = [];
	let before: string | undefined;
	for (;;) {
		const page = ok(await conversations.page("long-1", before));
		expect(page.entries.length).toBeLessThanOrEqual(PAGE_SIZE);
		seen.unshift(...page.entries.map((entry) => entry.id));
		cursors.push(page.before);
		if (!page.before) break;
		// The cursor is the first entry of this page: the next page ends just before it.
		expect(page.before).toBe(page.entries[0].id);
		before = page.before;
	}
	expect(cursors).toHaveLength(5);
	expect(seen).toEqual(long.map((entry) => entry.id));
}, 30000);

test("a long tool output is cut for the panel and says so", async () => {
	const big = "x".repeat(50_000);
	await indexedSession("big-1", [
		message("b1", 1, {
			role: "toolResult",
			toolCallId: "c",
			toolName: "read",
			content: [{ type: "text", text: big }],
			isError: false,
		}),
	]);
	const [entry] = ok(await conversations.page("big-1")).entries;
	expect(entry).toMatchObject({ kind: "tool-result", cut: true });
	expect(entry.kind === "tool-result" && entry.text.length).toBeLessThan(25_000);
}, 30000);

test("an unknown session or cursor answers with the runtime's reason", async () => {
	expect(await conversations.page("nobody")).toEqual({ ok: false, reason: "unknown session" });
	expect(await conversations.page("talk-1", "nope")).toEqual({ ok: false, reason: "unknown cursor" });
}, 30000);

test("marking a finished character seen clears needs-you in every view, with the command's receipt", async () => {
	const latest = (): WorldSnapshot => world.snapshot();
	const facts = (id: string) => latest().characters.find((c) => c.id === id)?.facts;
	const bridge = await indexedSession("seen-1", SESSION.slice(0, 1));
	bridge.send({ type: "run", run: "thinking" });
	bridge.send({ type: "run", run: "idle" });
	await vi.waitFor(() => expect(facts("seen-1")).toMatchObject({ unseen: true }), { timeout: 5000 });
	expect(facts("seen-1")?.needsYouSince).toBeTypeOf("number");

	expect(await conversations.markSeen("seen-1")).toEqual({ ok: true });
	await vi.waitFor(() => expect(facts("seen-1")).toMatchObject({ unseen: false, needsYouSince: null }), {
		timeout: 3000,
	});
	// The runtime's own record, which the sidebar, dashboard, and notch read.
	expect(
		query<{ needs: number | null }>(state.dbPath, "select needs_you_since as needs from sessions where id = 'seen-1'"),
	).toEqual([{ needs: null }]);
	expect(await conversations.markSeen("nobody")).toEqual({ ok: false, reason: "unknown session" });
}, 30000);
