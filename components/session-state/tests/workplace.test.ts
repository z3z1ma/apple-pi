import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
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
	manager.session.extensionRunner.setFlagValue("role", "coordinator");
	await manager.session.bindExtensions({});
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
