import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import bridge from "../src/index.js";
import type { Peer } from "../src/peers.js";
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

test("a session lists its live peers, not subagents or ended sessions, and mails one using only these tools", async () => {
	let listed: Peer[] = [];
	const caller = await fauxSession(
		[bridge],
		(context) => {
			const last = context.messages.at(-1) as { role: string; toolName?: string; details?: { peers?: Peer[] } };
			if (last.role === "user") return call("list_peer_sessions", {});
			if (last.toolName === "list_peer_sessions") {
				listed = last.details?.peers ?? [];
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
				reportsTo: "coordinator-1",
				role: "technical-writer",
				currentTask: { bundle: "/work/docs/.ledger/202610180001-docs", taskId: "202610180001-docs" },
				prompt: { kind: "select", title: "Overwrite?" },
			},
		});
		await fake("child-1", { session: { kind: "child", spawnedBy: callerId } });
		const ended = await fake("ended-1");
		ended.send({ type: "shutdown", reason: "quit" });
		await vi.waitFor(() =>
			expect(
				query(state.dbPath, "select 1 from incarnations where session_id = 'ended-1' and ended_at is not null"),
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
				cwd: "/work/docs",
				status: "waiting",
				reportsTo: "coordinator-1",
				role: "technical-writer",
				currentTask: "202610180001-docs",
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
		expect(description("list_peer_sessions")).toMatch(/peer sessions.*mailbox_send.*subagents are not peers.*agent/is);
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
