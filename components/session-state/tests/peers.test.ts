import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import type { Member } from "../../organization/src/directory.js";
import { sendCommand } from "../src/client.js";
import bridge from "../src/index.js";
import {
	close,
	fakeBridge,
	query,
	replyToTurns,
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
			if (last.role === "user") return call("directory", {});
			if (last.toolName === "directory") {
				listed = last.details?.members ?? [];
				const worker = listed.find((peer) => peer.name === "docs-worker");
				return call("send_mail", { to: [worker?.id ?? "none"], subject: "Status", body: "status please" });
			}
			return fauxAssistantMessage("done");
		},
		["directory", "send_mail"],
	);
	try {
		const callerId = caller.session.sessionManager.getSessionId();
		await seen(callerId);
		const peer = await fake("peer-1", {
			session: { name: "docs-worker", cwd: "/work/docs" },
			facts: {
				reportsTo: callerId,
				role: "technical-writer",
				title: "Technical Writer",
				soul: "You count the callers; habit: you reread the ask.",
				prompt: { kind: "select", title: "Overwrite?" },
			},
		});
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
		expect(listed).toContainEqual(expect.objectContaining({ id: callerId, manager: "Operator" }));
		expect(listed.filter((member) => member.id !== callerId && member.id !== "operator")).toEqual([
			{
				id: "peer-1",
				name: "docs-worker",
				role: "technical-writer",
				title: "Technical Writer",
				soul: "You count the callers; habit: you reread the ask.",
				manager: callerId,
				team: `team:${callerId}`,
				status: "asking the operator",
				directory: "/work/docs",
				availability: "available",
				focus: null,
				tasks: [],
				record: [],
				since: expect.any(Number),
			},
			{
				id: "asleep-1",
				name: "reviewer",
				role: null,
				title: null,
				soul: null,
				manager: "docs-worker",
				team: "team:peer-1",
				status: "at home",
				directory: expect.any(String),
				availability: "available",
				focus: null,
				tasks: [],
				record: [],
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

test("a leaf sees its named manager, teammates, and itself, with former members only on request", async () => {
	const results: { members: { id: string; manager: string | null; team: string }[]; former: { id: string }[] }[] = [];
	const run = await fauxSession(
		[bridge],
		(context) => {
			const last = context.messages.at(-1) as { role: string; details?: (typeof results)[number] };
			if (last.role === "user") return call("directory", { former: results.length > 0 });
			if (last.details) results.push(last.details);
			return fauxAssistantMessage("done");
		},
		[],
	);
	const id = run.session.sessionManager.getSessionId();
	try {
		await fake("leaf-boss", { session: { name: "Ada" } });
		const sibling = await fake("leaf-sibling", { session: { name: "Grace" }, facts: { reportsTo: "leaf-boss" } });
		replyToTurns(sibling, "Assignment complete. The task has the result.");
		run.session.extensionRunner.setFlagValue("reports-to", "leaf-boss");
		await run.session.bindExtensions({});
		await vi.waitFor(
			() =>
				expect(query(state.dbPath, "select reports_to from sessions where id = ?", id)).toEqual([
					{ reports_to: "leaf-boss" },
				]),
			{ timeout: 15000 },
		);
		await sendCommand("leaf-sibling", { kind: "retire", reason: "Assignment complete." });
		sibling.send({ type: "shutdown", reason: "quit" });
		await run.session.prompt("who is here?");
		expect(results[0].members.map((member) => member.id).sort()).toEqual(["operator", "leaf-boss", id].sort());
		expect(results[0].members.find((member) => member.id === id)).toMatchObject({
			manager: "Ada",
			team: "team:leaf-boss",
		});
		expect(results[0].former).toEqual([]);
		await run.session.prompt("and who left?");
		expect(results[1].former).toEqual([
			expect.objectContaining({ id: "leaf-sibling", left: { at: expect.any(Number), reason: "Assignment complete." } }),
		]);
	} finally {
		await close(run);
	}
}, 30000);

test("the discovery and mail tools tell peer sessions from subagents", async () => {
	const run = await fauxSession([bridge], [], []);
	try {
		const tools = run.session.getAllTools();
		const description = (name: string) => tools.find((tool) => tool.name === name)?.description ?? "";
		expect(description("directory")).toMatch(/organization.*former.*send_mail/is);
		expect(description("send_mail")).toMatch(/organization.*thread.*my-team/is);
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
