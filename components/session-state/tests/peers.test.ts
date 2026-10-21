import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import bridge from "../src/index.js";
import type { Member } from "../../organization/src/directory.js";
import { close, fakeBridge, query, standInProcess, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

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
const fake = async (id: string, hello: Parameters<typeof fakeBridge>[4] = {}) => {
	const stand = standInProcess();
	processes.push(stand);
	const link = await fakeBridge(state.socketPath, id, stand.pid, stand.startedAt, hello);
	await seen(id);
	return link;
};
const call = (name: string, args: Parameters<typeof fauxToolCall>[1]): Reply =>
	fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });

test("a session lists its organization, awake and asleep, not subagents or strangers, and mails one using only these tools", async () => {
	let listed: Member[] = [];
	const caller = await fauxSession(
		[bridge],
		(context) => {
			const last = context.messages.at(-1) as { role: string; toolName?: string; details?: { members?: Member[] } };
			if (last.role === "user") return call("list_peer_sessions", {});
			if (last.toolName === "list_peer_sessions") {
				listed = last.details?.members ?? [];
				const worker = listed.find((peer) => peer.name === "docs-worker");
				return call("mailbox_send", { session_id: worker?.id ?? "none", message: "status please" });
			}
			return fauxAssistantMessage("done");
		},
		["list_peer_sessions", "mailbox_send"],
	);
	try {
		const callerId = caller.session.sessionManager.getSessionId();
		await seen(callerId);
		const peer = await fake("peer-1", {
			session: { name: "docs-worker", cwd: "/work/docs" },
			facts: {
				reportsTo: callerId,
				role: "technical-writer",
				currentTask: { bundle: "/work/docs/.ledger/202610180001-docs", taskId: "202610180001-docs" },
				prompt: { kind: "select", title: "Overwrite?" },
			},
		});
		peer.send({
			type: "task_link",
			bundle: "/work/docs/.ledger/202610170001-old",
			taskId: "202610170001-old",
			via: "ledger",
			at: 1,
		});
		peer.send({
			type: "task_link",
			bundle: "/work/docs/.ledger/202610180001-docs",
			taskId: "202610180001-docs",
			via: "ledger",
			at: 2,
		});
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select 1 from session_tasks where session_id = 'peer-1'")).toHaveLength(2),
		);
		await fake("child-1", { session: { kind: "child", spawnedBy: callerId } });
		await fake("stranger-1", { session: { name: "stranger" } });
		const asleep = await fake("asleep-1", { session: { name: "reviewer" }, facts: { reportsTo: "peer-1" } });
		asleep.send({ type: "shutdown", reason: "quit" });
		await vi.waitFor(() =>
			expect(
				query(state.dbPath, "select 1 from incarnations where session_id = 'asleep-1' and ended_at is not null"),
			).toHaveLength(1),
		);
		const mail = new Promise<unknown>((resolve) =>
			peer.socket.on("data", (chunk) => {
				const line = chunk
					.toString()
					.split("\n")
					.find((l) => l.includes('"mail"'));
				if (line) resolve(JSON.parse(line));
			}),
		);

		await caller.session.prompt("check on the docs worker");
		expect(listed).toEqual([
			{
				id: "peer-1",
				name: "docs-worker",
				role: "technical-writer",
				reportsTo: callerId,
				status: "waiting",
				cwd: "/work/docs",
				currentTask: "202610180001-docs",
				tasks: ["202610180001-docs", "202610170001-old"],
				since: expect.any(Number),
			},
			{
				id: "asleep-1",
				name: "reviewer",
				role: null,
				reportsTo: "peer-1",
				status: "asleep",
				cwd: expect.any(String),
				currentTask: null,
				tasks: [],
				since: expect.any(Number),
			},
		]);
		expect(await mail).toMatchObject({
			type: "command",
			command: { kind: "mail", from: callerId, body: "status please" },
		});
	} finally {
		await close(caller);
	}
}, 30000);

test("the discovery and mail tools tell peer sessions from subagents", async () => {
	const run = await fauxSession([bridge], [], []);
	try {
		const tools = run.session.getAllTools();
		const description = (name: string) => tools.find((tool) => tool.name === name)?.description ?? "";
		expect(description("list_peer_sessions")).toMatch(/organization.*mailbox_send.*subagents are not people.*agent/is);
		expect(description("mailbox_send")).toMatch(/peer session.*list_peer_sessions.*subagents.*steer_subagent/is);
	} finally {
		await close(run);
	}
}, 20000);

test("/pi-sessions lists the live top-level sessions, the caller's own too", async () => {
	const notices: string[] = [];
	const run = await fauxSession([bridge], [], []);
	try {
		await run.session.bindExtensions({ uiContext: { notify: (text: string) => notices.push(text) } as never });
		const id = run.session.sessionManager.getSessionId();
		await seen(id);
		await fake("listed-1", { session: { name: "docs-worker" }, run: "thinking" });
		await run.session.prompt("/pi-sessions");
		expect(notices.at(-1)).toMatch(/^Live Pi sessions \(\d+\):/);
		expect(notices.at(-1)).toContain("busy    listed-1  docs-worker");
		expect(notices.at(-1)).toContain(id);
	} finally {
		await close(run);
	}
}, 20000);
