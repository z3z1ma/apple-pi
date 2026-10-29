import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";

type DirectoryMember = { id: string; manager: string | null };

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
/** A person's bridge, recording every command the runtime sends it. */
const fake = async (id: string, reportsTo: string) => {
	const stand = standInProcess();
	processes.push(stand);
	const link = await fakeBridge(state.socketPath, id, stand.pid, stand.startedAt, {
		session: { name: `Person ${id}` },
		facts: { reportsTo },
	});
	await seen(id);
	const received: { kind: string; manager?: string }[] = [];
	link.socket.on("data", (chunk) => {
		for (const line of chunk.toString().split("\n")) {
			if (!line.includes('"command"')) continue;
			const message = JSON.parse(line) as { type: string; command?: { kind: string; manager?: string } };
			if (message.type === "command" && message.command) {
				received.push(message.command);
				if (message.command.kind === "close") {
					link.send({ type: "shutdown", reason: "quit" });
					stand.child.kill();
				}
			}
		}
	});
	return { ...link, received };
};
const call = (name: string, args: Parameters<typeof fauxToolCall>[1]): Reply =>
	fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const toolResults = (run: Awaited<ReturnType<typeof fauxSession>>) =>
	run.session.sessionManager
		.getEntries()
		.filter((entry) => entry.type === "message" && entry.message.role === "toolResult")
		.map((entry) => {
			const message = (entry as { message: { isError?: boolean; content: { text?: string }[] } }).message;
			return { isError: message.isError ?? false, text: message.content.map((part) => part.text ?? "").join("") };
		});
const reportsTo = (id: string) =>
	(query(state.dbPath, "select reports_to from sessions where id = ?", id)[0] as { reports_to: string | null })
		.reports_to;
const mailTo = (to: string) =>
	query(
		state.dbPath,
		"select command from commands where session_id = ? and kind = 'mail' order by created_at",
		to,
	).map((row) => {
		const { from, body } = JSON.parse(row.command as string) as { from: string; body: string };
		return { from, body };
	});

test("a manager transfers a person with its team, is refused a cycle or a stranger, retires a person, and the record keeps every move", async () => {
	let listed: { members: DirectoryMember[] } | undefined;
	const root = await fauxSession(
		[bridge],
		(context) => {
			const last = context.messages.at(-1) as {
				role: string;
				toolName?: string;
				details?: { members: DirectoryMember[] };
			};
			if (last.toolName === "directory") listed = last.details;
			if (last.role !== "user") return fauxAssistantMessage("done");
			const text = (last as unknown as { content: { text?: string }[] }).content.map((p) => p.text ?? "").join("");
			if (text === "move p1") return call("move", { person: "Person p1", manager: "Person m2" });
			if (text === "cycle") return call("move", { person: "m2", manager: "p2" });
			if (text === "stranger") return call("move", { person: "p1", manager: "stranger" });
			if (text === "retire") return call("let_go", { person: "p2", reason: "The burst is over." });
			return call("directory", { subtree: root.session.sessionManager.getSessionId() });
		},
		["directory", "move", "let_go"],
	);
	root.session.extensionRunner.setFlagValue("role", "coordinator");
	await root.session.bindExtensions({});
	const rootId = root.session.sessionManager.getSessionId();
	try {
		await seen(rootId);
		const m1 = await fake("m1", rootId);
		const m2 = await fake("m2", rootId);
		const p1 = await fake("p1", "m1");
		const p2 = await fake("p2", "p1");
		replyToTurns(p2, "The burst is complete. Context is in the task bundle.");
		await fake("stranger", "nobody");

		await root.session.prompt("move p1");
		expect(toolResults(root).at(-1)).toMatchObject({ isError: false, text: "Person p1 now reports to Person m2." });
		expect(reportsTo("p1")).toBe("m2");
		expect(reportsTo("p2")).toBe("p1"); // the team moved with its manager
		await vi.waitFor(() => expect(p1.received).toContainEqual({ kind: "transfer", manager: "m2", by: rootId }));
		const notice = {
			from: rootId,
			body: expect.stringContaining("Person p1 now reports to Person m2 (moved from m1)"),
		};
		expect(mailTo("p1")).toEqual([notice]);
		expect(mailTo("m2")).toEqual([notice]);
		expect(mailTo("m1")).toEqual([notice]);

		await root.session.prompt("cycle");
		expect(toolResults(root).at(-1)).toMatchObject({
			isError: true,
			text: expect.stringContaining("p2 reports to m2; a manager cannot report to its own report"),
		});
		expect(reportsTo("m2")).toBe(rootId);

		await root.session.prompt("stranger");
		expect(toolResults(root).at(-1)).toMatchObject({
			isError: true,
			text: expect.stringContaining("stranger is not in p1's organization"),
		});
		expect(reportsTo("p1")).toBe("m2");

		await root.session.prompt("retire");
		expect(toolResults(root).at(-1)).toMatchObject({
			isError: false,
			text: expect.stringContaining(
				"Departure request accepted for p2; handoff and cleanup run asynchronously. Request:",
			),
		});
		await vi.waitFor(() => expect(p2.received).toContainEqual({ kind: "close" }), { timeout: 15000 });
		await vi.waitFor(() => expect(query(state.dbPath, "select id from sessions where id = 'p2'")).toEqual([]), {
			timeout: 15000,
		});
		expect(
			query<{ data: string }>(
				state.dbPath,
				"select data from events where session_id = 'p2' and type = 'person_departed'",
			).map((row) => JSON.parse(row.data)),
		).toEqual([expect.objectContaining({ reason: "The burst is over." })]);

		await root.session.prompt("list");
		expect(listed?.members.map((m) => [m.id, m.manager])).toEqual([
			[rootId, null],
			["m1", rootId],
			["m2", rootId],
			["p1", "m2"],
		]);
		expect(mailTo("p1")).toContainEqual({
			from: "harness",
			body: expect.stringContaining("Permanent departure committed for Person p2 (p2)."),
		});
		await vi.waitFor(
			() =>
				expect(mailTo("p1")).toContainEqual({
					from: "harness",
					body: expect.stringContaining("Permanent departure cleanup completed for p2."),
				}),
			{ timeout: 15000 },
		);
		expect(query(state.dbPath, "select session_id, from_manager, to_manager, by from manager_changes")).toEqual([
			{ session_id: "p1", from_manager: "m1", to_manager: "m2", by: rootId },
		]);
		m1.socket.destroy();
		m2.socket.destroy();
	} finally {
		await close(root);
	}
}, 40000);

test("after a transfer, prompt context and close notices use the new manager, and a restart preserves it over the old flag", async () => {
	const mover = await fauxSession(
		[
			(pi) => {
				const getFlag = pi.getFlag.bind(pi);
				pi.getFlag = (name) => (name === "reports-to" ? "m-old" : getFlag(name));
				bridge(pi);
			},
		],
		() => fauxAssistantMessage("hi"),
		[],
	);
	const moverId = mover.session.sessionManager.getSessionId();
	const boss = await fauxSession(
		[bridge],
		[call("move", { person: moverId, manager: "m-new" }), fauxAssistantMessage("done")],
		["move"],
	);
	boss.session.extensionRunner.setFlagValue("role", "coordinator");
	await boss.session.bindExtensions({});
	const bossId = boss.session.sessionManager.getSessionId();
	try {
		await seen(bossId);
		await fake("m-old", bossId);
		await fake("m-new", bossId);
		await vi.waitFor(() => expect(reportsTo(moverId)).toBe("m-old"), { timeout: 15000 });
		await mover.session.prompt("before transfer");
		expect(mover.session.agent.state.systemPrompt).toContain("You report to the session `m-old`");
		const prefix = mover.requests.at(-1)!.messages;

		await boss.session.prompt("move");
		expect(toolResults(boss).at(-1)).toMatchObject({ isError: false });
		expect(reportsTo(moverId)).toBe("m-new");
		await mover.session.prompt("after transfer");
		expect(mover.session.agent.state.systemPrompt).toContain("You report to the session `m-new`");
		expect(mover.session.agent.state.systemPrompt).not.toContain("You report to the session `m-old`");
		const updated = mover.requests.at(-1)!.messages;
		expect(updated.slice(0, prefix.length)).toEqual(prefix);
		const delta = updated.slice(prefix.length).filter((message) => message.role === "system");
		expect(delta).toContainEqual(
			expect.objectContaining({
				sections: expect.objectContaining({ org: expect.stringContaining("You report to the session `m-new`") }),
			}),
		);

		// A replacement bridge still carries the old flag; wait until it applies the recorded manager.
		await mover.session.bindExtensions({});
		await vi.waitFor(
			() =>
				expect(
					query(
						state.dbPath,
						"select 1 from commands where session_id = ? and kind = 'transfer' and json_extract(command, '$.by') = 'runtime' and stage = 'applied'",
						moverId,
					),
				).toHaveLength(1),
			{ timeout: 15000 },
		);
		await mover.session.prompt("hi");
		expect(reportsTo(moverId)).toBe("m-new");
		expect(mover.session.agent.state.systemPrompt).toContain("You report to the session `m-new`");
		await close(mover);
		await vi.waitFor(
			() => expect(mailTo("m-new")).toContainEqual({ from: moverId, body: expect.stringContaining("closed") }),
			{ timeout: 15000 },
		);
		expect(mailTo("m-old").map((mail) => mail.from)).toEqual([bossId]); // the transfer notice only
	} finally {
		await close(mover);
		await close(boss);
	}
}, 40000);
