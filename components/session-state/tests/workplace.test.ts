import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import { sendCommand } from "../src/client.js";
import bridge from "../src/index.js";
import { close, query, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
const bin = join(state.agentDir, "bin");
mkdirSync(bin);
// The onboarding test supplies the launched person's real faux session below; this stands in for its process.
writeFileSync(join(bin, "pi"), `#!${process.execPath}\nsetInterval(() => {}, 1000);\n`);
chmodSync(join(bin, "pi"), 0o755);
vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
beforeAll(() => startRuntime(state.socketPath));
afterAll(() => stopRuntime(state));

async function team(replies: Parameters<typeof fauxSession>[1]) {
	let person = "";
	const manager = await fauxSession(
		[bridge],
		(context) => {
			const last = context.messages.at(-1);
			return last?.role === "user" && JSON.stringify(last.content).includes("retire colleague")
				? fauxAssistantMessage([fauxToolCall("let_go", { person, reason: "The launch is complete." })], {
						stopReason: "toolUse",
					})
				: fauxAssistantMessage("Noted.");
		},
		[],
	);
	const managerId = manager.session.sessionManager.getSessionId();
	const peer = await fauxSession(
		[
			(pi) => {
				const getFlag = pi.getFlag.bind(pi);
				pi.getFlag = (name) => (name === "reports-to" ? managerId : getFlag(name));
				bridge(pi);
			},
		],
		replies,
		[],
	);
	person = peer.session.sessionManager.getSessionId();
	await vi.waitFor(
		() =>
			expect(query(state.dbPath, "select reports_to from sessions where id = ?", person)).toEqual([
				{ reports_to: managerId },
			]),
		{ timeout: 15000 },
	);
	return { manager, managerId, peer, person };
}

const left = (person: string) =>
	query(state.dbPath, "select retired_at from sessions where id = ?", person)[0]?.retired_at;
const handovers = (person: string, manager: string) =>
	query<{ body: string; at: number }>(
		state.dbPath,
		"select body, at from thread_messages where sender = ? and thread_id = ?",
		person,
		`team:${manager}`,
	);

const releaseTeam = async (members: Awaited<ReturnType<typeof team>>) => {
	await members.peer.session.abort();
	await members.manager.session.abort();
	await close(members.peer);
	await close(members.manager);
};

test("a hire's first model request includes its team's channel history and assigned goal", async () => {
	const members = await team([fauxAssistantMessage("Ready.")]);
	const id = "onboarding-person";
	const controller = new AbortController();
	await sendCommand(members.managerId, {
		kind: "thread_post",
		thread: `team:${members.managerId}`,
		body: "The retry investigation lives in docs/retry.md; the queue boundary is still unverified.",
	});
	const starting = sendCommand(
		id,
		{
			kind: "start",
			cwd: state.agentDir,
			reportsTo: members.managerId,
			role: "repository-archaeologist",
			goal: { by: members.managerId, text: "Investigate the retry boundary." },
		},
		{ signal: controller.signal },
	);
	let hired: Awaited<ReturnType<typeof fauxSession>> | undefined;
	try {
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select 1 from work_focus where person = ?", id)).toHaveLength(1),
		);
		hired = await fauxSession(
			[
				(pi) => {
					const getFlag = pi.getFlag.bind(pi);
					pi.getFlag = (name) => (name === "reports-to" ? members.managerId : getFlag(name));
					bridge(pi);
				},
			],
			[fauxAssistantMessage("I have the team's context.")],
			[],
			{
				cwd: state.agentDir,
				sessionManager: SessionManager.inMemory(state.agentDir, { id }),
			},
		);
		expect((await starting).stage).toBe("applied");
		await vi.waitFor(() => expect(hired!.requests.length).toBeGreaterThan(0));
		const first = JSON.stringify(hired.requests[0]!.messages.filter((message) => message.role === "user"));
		expect(first).toContain("docs/retry.md");
		expect(first).toContain("queue boundary is still unverified");
		expect(first).toContain("Investigate the retry boundary.");
	} finally {
		controller.abort();
		await starting.catch(() => undefined);
		if (hired) {
			await hired.session.abort();
			await close(hired);
		}
		await releaseTeam(members);
	}
}, 15000);

test("let_go waits for the person's own handover, posts it to the team, then retires it", async () => {
	let release = (_reply: Reply) => {};
	const answer = new Promise<Reply>((resolve) => {
		release = resolve;
	});
	const members = await team(() => answer);
	const pending = members.manager.session.prompt("retire colleague");
	const body = "Verified: launch checks passed. Open: watch retries. Context: docs/launch.md.";
	try {
		await vi.waitFor(() => expect(members.peer.requests).toHaveLength(1));
		expect(JSON.stringify(members.peer.requests[0]?.messages)).toContain("handover");
		expect(left(members.person)).toBeNull();
		expect(handovers(members.person, members.managerId)).toEqual([]);
		release(fauxAssistantMessage(body));
		await pending;
		const posts = handovers(members.person, members.managerId);
		expect(posts).toEqual([{ body, at: expect.any(Number) }]);
		expect(left(members.person)).toBeGreaterThanOrEqual(posts[0]!.at);
		expect(members.manager.session.messages.filter((message) => message.role === "toolResult").at(-1)).toMatchObject({
			isError: false,
		});
	} finally {
		release(fauxAssistantMessage(body));
		await members.manager.session.abort();
		await pending;
		await releaseTeam(members);
	}
}, 15000);

test("letting a busy person go preserves its current turn and uses the subsequent handover", async () => {
	let release = (_reply: Reply) => {};
	const busy = new Promise<Reply>((resolve) => {
		release = resolve;
	});
	const body = "The existing work is done; its evidence is in docs/result.md.";
	let turn = 0;
	const members = await team(() => (turn++ === 0 ? busy : fauxAssistantMessage(body)));
	const working = members.peer.session.prompt("Finish the existing work first.");
	await vi.waitFor(() => expect(members.peer.requests).toHaveLength(1));
	const retiring = members.manager.session.prompt("retire colleague");
	try {
		await vi.waitFor(() =>
			expect(
				query(
					state.dbPath,
					"select 1 from commands where session_id = ? and kind = 'run_turn' and stage = 'delivered'",
					members.person,
				),
			).toHaveLength(1),
		);
		expect(members.peer.requests).toHaveLength(1);
		expect(members.peer.session.isStreaming).toBe(true);
		expect(left(members.person)).toBeNull();
		release(fauxAssistantMessage("Existing turn completed normally."));
		await working;
		await retiring;
		expect(members.peer.requests).toHaveLength(2);
		expect(handovers(members.person, members.managerId)).toEqual([{ body, at: expect.any(Number) }]);
	} finally {
		release(fauxAssistantMessage("Existing turn completed normally."));
		await members.manager.session.abort();
		await retiring;
		await members.peer.session.abort();
		await working;
		await releaseTeam(members);
	}
}, 15000);

test("an empty handover fails visibly and leaves the person in the team", async () => {
	const members = await team([fauxAssistantMessage(" ")]);
	try {
		await members.manager.session.prompt("retire colleague");
		expect(left(members.person)).toBeNull();
		expect(handovers(members.person, members.managerId)).toEqual([]);
		expect(members.manager.session.messages.filter((message) => message.role === "toolResult").at(-1)).toMatchObject({
			isError: true,
		});
	} finally {
		await releaseTeam(members);
	}
}, 15000);

test("cancelling let_go stops only its handover and leaves the person in the team", async () => {
	const members = await team(() => "until-aborted");
	const pending = members.manager.session.prompt("retire colleague");
	try {
		await vi.waitFor(() => expect(members.peer.requests).toHaveLength(1));
		await members.manager.session.abort();
		await pending;
		await vi.waitFor(() => expect(members.peer.session.isStreaming).toBe(false));
		expect(left(members.person)).toBeNull();
		expect(handovers(members.person, members.managerId)).toEqual([]);
		expect(
			query(
				state.dbPath,
				"select 1 as present from thread_participants where thread_id = ? and participant = ?",
				`team:${members.managerId}`,
				members.person,
			),
		).toEqual([{ present: 1 }]);
	} finally {
		await members.manager.session.abort();
		await pending;
		await releaseTeam(members);
	}
}, 15000);
