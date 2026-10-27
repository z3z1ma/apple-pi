import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import type { Member } from "../../organization/src/directory.js";
import * as organizations from "../../organization/src/directory.js";
import bridge from "../src/index.js";
import { directoryView } from "../src/peers.js";
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

test("a session discovers compact people, drills into one, and mails its returned ID, excluding subagents and strangers", async () => {
	let listed: { id: string; name: string }[] = [];
	const texts: string[] = [];
	const details: unknown[] = [];
	const caller = await fauxSession(
		[bridge],
		(context) => {
			const last = context.messages.at(-1) as {
				role: string;
				toolName?: string;
				details?: { members?: typeof listed };
				content?: { text: string }[];
			};
			if (last.role === "user") return call("directory", { limit: 10 });
			if (last.toolName === "directory") {
				texts.push(last.content?.[0]?.text ?? "");
				details.push(last.details);
			}
			if (last.toolName === "directory" && texts.length === 1) {
				listed = last.details?.members ?? [];
				return call("directory", { person: "docs-worker" });
			}
			if (last.toolName === "directory")
				return call("send_mail", {
					to: [listed.find((peer) => peer.name === "docs-worker")?.id ?? "none"],
					subject: "Status",
					body: "status please",
				});
			return fauxAssistantMessage("done");
		},
		["directory", "send_mail"],
	);
	try {
		const id = caller.session.sessionManager.getSessionId();
		await seen(id);
		const peer = await fake("peer-1", {
			session: { name: "docs-worker", cwd: "/work/docs" },
			facts: {
				reportsTo: id,
				role: "technical-writer",
				title: "Technical Writer",
				soul: "private soul marker",
				prompt: { kind: "select", title: "Overwrite?" },
			},
		});
		await fake("child-1", { session: { kind: "child", spawnedBy: id } });
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
					.find((line) => line.includes('"mail"'));
				if (line) resolve(JSON.parse(line));
			}),
		);
		await caller.session.prompt("check on the docs worker");
		expect(listed.map((member) => member.id).sort()).toEqual([id, "peer-1", "asleep-1"].sort());
		expect(listed).toContainEqual(
			expect.objectContaining({
				id: "peer-1",
				manager: id,
				managerName: id,
				status: "asking the operator",
				held: 0,
				finished: 0,
			}),
		);
		expect(texts[0]).toContain("reviewer (asleep-1): at home, available");
		expect(texts[1]).toContain("Directory: /work/docs");
		expect(JSON.stringify({ texts, details })).not.toContain("private soul marker");
		expect(details[1]).toMatchObject({ kind: "person", tasks: [], finished: 0 });
		expect(details[0]).not.toHaveProperty("record");
		expect(await mail).toMatchObject({ type: "command", command: { kind: "mail", from: id, body: "status please" } });
	} finally {
		await close(caller);
	}
}, 30000);

test("a leaf uses an overview, team and self-name selectors without losing its manager or teammates", async () => {
	const results: { kind: string; root: string; total: number; members?: { id: string }[]; id?: string }[] = [];
	let request: Parameters<typeof fauxToolCall>[1] = {};
	const run = await fauxSession(
		[bridge],
		(context) => {
			const last = context.messages.at(-1) as { role: string; details?: (typeof results)[number] };
			if (last.role === "user") return call("directory", request);
			if (last.details) results.push(last.details);
			return fauxAssistantMessage("done");
		},
		[],
	);
	const id = run.session.sessionManager.getSessionId();
	try {
		await fake("leaf-boss", { session: { name: "Ada" } });
		await fake("leaf-sibling", { session: { name: "Grace" }, facts: { reportsTo: "leaf-boss" } });
		run.session.setSessionName("Leaf caller");
		run.session.extensionRunner.setFlagValue("reports-to", "leaf-boss");
		await run.session.bindExtensions({});
		await vi.waitFor(
			() =>
				expect(query(state.dbPath, "select reports_to, name from sessions where id = ?", id)).toEqual([
					{ reports_to: "leaf-boss", name: "Leaf caller" },
				]),
			{ timeout: 15000 },
		);
		await run.session.prompt("overview");
		expect(results[0]).toMatchObject({ kind: "overview", root: "leaf-boss", total: 3 });
		expect(results[0]).not.toHaveProperty("members");
		request = { team: "Ada" };
		await run.session.prompt("my team");
		expect(results[1].members?.map((member) => member.id).sort()).toEqual([id, "leaf-sibling"].sort());
		request = { person: "Leaf caller" };
		await run.session.prompt("my profile");
		expect(results[2]).toMatchObject({ kind: "person", id, manager: "leaf-boss", managerName: "Ada" });
	} finally {
		await close(run);
	}
}, 30000);

function member(id: string, reportsTo: string | null, overrides: Partial<Member> = {}): Member {
	return {
		id,
		name: id,
		role: "implementation-engineer",
		title: "Engineer",
		soul: "soul marker",
		reportsTo,
		status: "idle",
		cwd: "/project",
		tasks: [],
		focus: null,
		record: [],
		since: 1,
		retired: null,
		...overrides,
	};
}
function largeOrganization() {
	const workers = Array.from({ length: 120 }, (_, index) =>
		member(`worker-${String(index).padStart(3, "0")}`, index < 60 ? "manager" : "root", {
			name: `Worker ${index}`,
			role: index % 2 ? "reviewer" : "implementation-engineer",
			status: index % 3 ? "idle" : "waiting",
			record: Array.from({ length: 3 }, (_, done) => ({
				id: `task-${index}-${done}`,
				title: `Task ${done}`,
				bundle: `/project/task-${index}-${done}`,
				status: "done",
				ephemeral: true,
				thread: `task:task-${index}-${done}`,
				assignment: index * 3 + done,
				assignedBy: "root",
				assignedAt: 1,
				endedAt: 10 - done,
				endReason: "finished",
				outcome: `outcome marker ${index}-${done}`,
			})),
		}),
	);
	return {
		root: "root",
		members: [
			member("root", null, { name: "Root Caller", role: null }),
			member("manager", "root", { name: "Team Manager", role: "coordinator", status: "busy" }),
			...workers,
			member("departed", "root", { retired: { at: 10, reason: "left marker" } }),
		],
	};
}

test("100+ people stay compact across the entire payload even as outcomes and souls grow", () => {
	const organization = largeOrganization();
	const spy = vi.spyOn(organizations, "organizationOf").mockReturnValue(organization);
	try {
		const overview = directoryView("root", {});
		expect(overview.details).toMatchObject({
			kind: "overview",
			root: "root",
			total: 122,
			teams: expect.arrayContaining([
				{ manager: "manager", managerName: "Team Manager", count: 60 },
				{ manager: "root", managerName: "Root Caller", count: 61 },
				{ manager: null, managerName: "Operator", count: 1 },
			]),
			status: expect.arrayContaining([
				{ status: "asking the operator", count: 40 },
				{ status: "idle", count: 81 },
				{ status: "working", count: 1 },
			]),
		});
		expect(overview.details).not.toHaveProperty("members");
		expect(overview.details).not.toHaveProperty("backlog");
		const soul = "soul marker".repeat(10000);
		const outcome = "outcome marker".repeat(10000);
		for (const person of organization.members) {
			person.soul = soul;
			for (const record of person.record) record.outcome = outcome;
		}
		expect(directoryView("root", {})).toEqual(overview);
		for (const options of [{}, { team: "Team Manager" }, { person: "Worker 0" }]) {
			const serialized = JSON.stringify(directoryView("root", options));
			expect(serialized).not.toContain("outcome marker");
			expect(serialized).not.toContain("soul marker");
			expect(serialized).not.toContain("departed");
		}
		expect(() => directoryView("root", { person: "departed" })).toThrow(/Nobody/);
	} finally {
		spy.mockRestore();
	}
});

test("compact discovery intersects filters and pages deterministically without an implicit row cap", () => {
	const organization = largeOrganization();
	const spy = vi.spyOn(organizations, "organizationOf").mockReturnValue(organization);
	try {
		const team = directoryView("root", { team: "Team Manager" }).details;
		expect(team).toMatchObject({ kind: "people", total: 60, nextOffset: null });
		expect(team).toHaveProperty("members.length", 60);
		const first = directoryView("root", {
			subtree: "Team Manager",
			role: "reviewer",
			status: "idle",
			name: "Worker",
			limit: 3,
		}).details;
		expect(first).toMatchObject({
			total: 20,
			offset: 0,
			nextOffset: 3,
			members: [{ id: "worker-001" }, { id: "worker-005" }, { id: "worker-007" }],
		});
		const next = directoryView("root", {
			subtree: "manager",
			role: "reviewer",
			status: "idle",
			name: "worker",
			limit: 3,
			offset: 3,
		}).details;
		expect(next).toMatchObject({
			total: 20,
			offset: 3,
			nextOffset: 6,
			members: [{ id: "worker-011" }, { id: "worker-013" }, { id: "worker-017" }],
		});
		const wholeSubtree = directoryView("root", { subtree: "Root Caller", limit: 200 }).details;
		expect(wholeSubtree).toMatchObject({ total: 122, nextOffset: null });
		expect(wholeSubtree).toHaveProperty("members.length", 122);
		expect(directoryView("root", { role: null }).details).toMatchObject({ total: 1, members: [{ id: "root" }] });
		expect(directoryView("root", { name: "no such person" }).details).toMatchObject({
			total: 0,
			members: [],
			nextOffset: null,
		});
		expect(directoryView("root", { limit: 3, offset: 200 }).details).toMatchObject({
			total: 122,
			members: [],
			nextOffset: null,
		});
		organization.members.push(
			member("opaque-\u00e9", "root", { name: "Unicode" }),
			member("opaque-e\u0301", "root", { name: "Unicode" }),
		);
		const unicode = directoryView("root", { name: "Unicode", limit: 1 });
		expect(unicode.details).toMatchObject({ total: 2, nextOffset: 1, members: [{ id: "opaque-e\u0301" }] });
		organization.members.reverse();
		expect(directoryView("root", { name: "Unicode", limit: 1 })).toEqual(unicode);
		organization.members.push(member("legacy-child", "departed", { name: "Legacy descendant" }));
		expect(directoryView("root", { subtree: "root", name: "Legacy descendant" }).details).toMatchObject({
			total: 1,
			members: [{ id: "legacy-child" }],
		});
	} finally {
		spy.mockRestore();
	}
});

test("finished outcomes require a person and explicit valid page, while profiles retain only current task references", () => {
	const organization = largeOrganization();
	organization.members[2].tasks = [
		{
			...organization.members[2].record[0],
			id: "held-task",
			endedAt: null,
			endReason: null,
			outcome: "not a finished outcome",
		},
	];
	organization.members[2].focus = organization.members[2].tasks[0];
	const spy = vi.spyOn(organizations, "organizationOf").mockReturnValue(organization);
	try {
		const profile = directoryView("root", { person: "Worker 0" });
		expect(JSON.stringify(profile)).not.toContain('"outcome":');
		expect(JSON.stringify(profile)).not.toContain("outcome marker");
		expect(profile.details).not.toHaveProperty("soul");
		expect(profile.details).toMatchObject({
			kind: "person",
			held: 1,
			finished: 3,
			tasks: [{ id: "held-task" }],
			focus: { id: "held-task" },
		});
		const first = directoryView("root", { person: "Worker 0", history: { limit: 1 } });
		expect(first.details).toMatchObject({
			kind: "history",
			total: 3,
			offset: 0,
			nextOffset: 1,
			record: [{ assignment: 0, outcome: "outcome marker 0-0" }],
		});
		expect(JSON.stringify(first)).not.toContain("outcome marker 0-1");
		expect(JSON.stringify(first)).not.toContain("not a finished outcome");
		expect(directoryView("root", { person: "worker-000", history: { limit: 2, offset: 1 } }).details).toMatchObject({
			total: 3,
			nextOffset: null,
			record: [{ assignment: 1 }, { assignment: 2 }],
		});
		for (const options of [
			{ history: { limit: 1 } },
			{ limit: 0 },
			{ limit: 1.5 },
			{ limit: Infinity },
			{ limit: Number.MAX_SAFE_INTEGER + 1 },
			{ limit: 2, offset: -1 },
			{ offset: 1 },
			{ person: "root", limit: 1 },
			{ person: "root", name: "root" },
			{ team: " " },
			{ name: " " },
			{ person: "root", history: { limit: -1 } },
		])
			expect(() => directoryView("root", options)).toThrow();
	} finally {
		spy.mockRestore();
	}
});

test("single-person selectors include self, prefer IDs and reject duplicate names including caller collisions", () => {
	const organization = largeOrganization();
	organization.members[1].name = "Root Caller";
	organization.members[2].name = "Twin";
	organization.members[3].name = "Twin";
	const spy = vi.spyOn(organizations, "organizationOf").mockReturnValue(organization);
	try {
		for (const selector of ["person", "team", "subtree"] as const) {
			expect(() => directoryView("root", { [selector]: "Root Caller" })).toThrow(/More than one.*session id/);
			expect(() => directoryView("root", { [selector]: "Twin" })).toThrow(/More than one.*session id/);
			expect(() => directoryView("root", { [selector]: "unknown" })).toThrow(/Nobody/);
		}
		organization.members[2].name = "root";
		expect(directoryView("root", { person: "root" }).details).toMatchObject({ id: "root" });
		organization.members[1].name = "Team Manager";
		expect(directoryView("root", { person: "Root Caller" })).toEqual(directoryView("root", { person: "root" }));
		expect(directoryView("root", { team: "Root Caller" })).toEqual(directoryView("root", { team: "root" }));
		expect(directoryView("root", { subtree: "Root Caller" })).toEqual(directoryView("root", { subtree: "root" }));
	} finally {
		spy.mockRestore();
	}
});

test("the discovery surface teaches compact modes and drops former-member discovery", async () => {
	const run = await fauxSession([bridge], [], []);
	try {
		const tools = run.session.getAllTools();
		const description = (name: string) => tools.find((tool) => tool.name === name)?.description ?? "";
		expect(description("directory")).toMatch(/organization.*history.*send_mail/is);
		expect(description("directory")).not.toMatch(/former/);
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
