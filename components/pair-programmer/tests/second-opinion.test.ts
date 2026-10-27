import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import bridge from "../../session-state/src/index.js";
import { MAIL_CUSTOM_TYPE } from "../../session-state/src/mail.js";
import { type DirectoryOptions, directoryParameters } from "../../session-state/src/peers.js";
import { close, query, sendCommand, stopRuntime, tempStateDir } from "../../session-state/tests/helpers.js";
import pair, { livePairUserMessages } from "../src/extension.js";
import { formatTurnDelta } from "../src/formatting.js";
import { createSecondOpinionTools } from "../src/second-opinion.js";
import { buildPairSeed } from "../src/seed.js";

const state = tempStateDir();
vi.stubEnv("PAIR_NO_REVIEW", "");
writeFileSync(
	join(state.agentDir, "model-profiles.json"),
	JSON.stringify({ profiles: { pair: { model: "faux-session-provider/faux-session-model", thinking: "off" } } }),
);
const runs: Awaited<ReturnType<typeof fauxSession>>[] = [];
afterEach(async () => {
	for (const run of runs.splice(0).reverse()) {
		await run.session.abort();
		await close(run);
	}
});
afterAll(() => stopRuntime(state));

function person(manager?: string): ExtensionFactory {
	return (pi) => {
		const flag = pi.getFlag.bind(pi);
		pi.getFlag = (name) => (name === "reports-to" ? manager : flag(name));
		bridge(pi);
	};
}
async function colleague(name: string, manager?: string) {
	const run = await fauxSession([person(manager)], [], []);
	runs.push(run);
	run.session.setSessionName(name);
	await vi.waitFor(
		() =>
			expect(
				query(state.dbPath, "select name from sessions where id = ?", run.session.sessionManager.getSessionId())[0]
					?.name,
			).toBe(name),
		{ timeout: 10000 },
	);
	await run.session.prompt("ready");
	return run;
}
const isPair = (context: Context) => JSON.stringify(context.messages[0]).includes("pair-routing");
async function paired(manager?: string, to?: string) {
	let asked = false;
	const run = await fauxSession(
		[person(manager), pair],
		(context) => {
			if (isPair(context) && !asked) {
				asked = true;
				return fauxAssistantMessage(
					[
						fauxToolCall("directory", {}),
						fauxToolCall("ask_for_second_opinion", {
							question: "Who owns the queue after cancellation?",
							...(to !== undefined ? { to } : {}),
						}),
					],
					{ stopReason: "toolUse" },
				);
			}
			return fauxAssistantMessage("Checked the queue.");
		},
		[],
	);
	runs.push(run);
	const id = run.session.sessionManager.getSessionId();
	await vi.waitFor(() => expect(query(state.dbPath, "select id from sessions where id = ?", id)).toHaveLength(1), {
		timeout: 10000,
	});
	await run.session.prompt("Investigate queue ownership.");
	return run;
}
const opinions = (id: string) =>
	query<{ thread_id: string; sender: string; body: string }>(
		state.dbPath,
		"select thread_id, sender, body from thread_messages where sender = ? and body like 'From the pair programmer%'",
		id,
	);

test("the pair asks the main session's manager; the reply reaches the main and its pair's trajectory", async () => {
	const manager = await colleague("Mara");
	const managerId = manager.session.sessionManager.getSessionId();
	const main = await paired(managerId);
	const self = main.session.sessionManager.getSessionId();
	await vi.waitFor(() => expect(opinions(self)).toHaveLength(1), { timeout: 15000 });
	const request = opinions(self)[0];
	expect(request.body).toContain("Who owns the queue after cancellation?");
	expect(
		query(
			state.dbPath,
			"select participant from thread_participants where thread_id = ? order by participant",
			request.thread_id,
		)
			.map((p) => p.participant)
			.sort(),
	).toEqual([managerId, self].sort());
	await vi.waitFor(
		() =>
			expect(manager.customMessages(MAIL_CUSTOM_TYPE).some((m) => JSON.stringify(m).includes(request.thread_id))).toBe(
				true,
			),
		{ timeout: 10000 },
	);
	const receipts = await sendCommand(state.socketPath, managerId, {
		kind: "thread_post",
		thread: request.thread_id,
		body: "The caller owns cancellation; the runtime owns delivery.",
	});
	expect(receipts.at(-1)?.stage).toBe("applied");
	await vi.waitFor(
		() =>
			expect(
				main.customMessages(MAIL_CUSTOM_TYPE).some((m) => JSON.stringify(m).includes("runtime owns delivery")),
			).toBe(true),
		{ timeout: 10000 },
	);
	await vi.waitFor(
		() =>
			expect(
				main.requests
					.filter(isPair)
					.some(
						(r) =>
							JSON.stringify(r.messages).includes("Mail received by your partner") &&
							JSON.stringify(r.messages).includes("runtime owns delivery"),
					),
			).toBe(true),
		{ timeout: 15000 },
	);
	const entries = main.session.sessionManager.getBranch();
	expect(formatTurnDelta({ userMessages: livePairUserMessages(entries) })).toContain("Mail received by your partner");
	expect(buildPairSeed({ entries })).toContain("runtime owns delivery");
	expect(buildPairSeed({ entries })).toContain("Mail received by your partner");
}, 30000);

test("naming a colleague asks that person instead of the manager", async () => {
	const manager = await colleague("Mara");
	const managerId = manager.session.sessionManager.getSessionId();
	const other = await colleague("Ivo", managerId);
	const main = await paired(managerId, "Ivo");
	const self = main.session.sessionManager.getSessionId();
	await vi.waitFor(() => expect(opinions(self)).toHaveLength(1), { timeout: 15000 });
	const recipients = query(
		state.dbPath,
		"select participant from thread_participants where thread_id = ?",
		opinions(self)[0].thread_id,
	).map((p) => p.participant);
	expect(recipients).toEqual(expect.arrayContaining([self, other.session.sessionManager.getSessionId()]));
	expect(recipients).not.toContain(managerId);
}, 25000);

test.each([undefined, " "])(
	"an unmanaged pair with to=%s cannot implicitly contact the operator",
	async (to) => {
		const main = await paired(undefined, to);
		await vi.waitFor(() => expect(main.requests.filter(isPair).length).toBeGreaterThanOrEqual(2), { timeout: 15000 });
		const text = JSON.stringify(main.requests.filter(isPair).at(-1));
		expect(text).toMatch(/Name someone|Name operator explicitly/);
		expect(opinions(main.session.sessionManager.getSessionId())).toHaveLength(0);
	},
	25000,
);

test("native and pair directory share compact schema and results for the main identity", async () => {
	const requests: Parameters<typeof fauxToolCall>[1][] = [];
	const pairedResults: unknown[] = [];
	let currentParams: DirectoryOptions = {};
	let pairTool: ReturnType<typeof createSecondOpinionTools>["directory"] | undefined;
	const main = await fauxSession(
		[person()],
		async (context) => {
			const last = context.messages.at(-1);
			if (last?.role === "user" && requests.length)
				return fauxAssistantMessage([fauxToolCall("directory", requests.shift()!)], { stopReason: "toolUse" });
			if (last?.role === "toolResult" && last.toolName === "directory" && !last.isError && pairTool)
				pairedResults.push(
					await pairTool.execute("pair-directory", currentParams, new AbortController().signal, undefined, {} as never),
				);
			return fauxAssistantMessage("done");
		},
		[],
	);
	runs.push(main);
	const self = main.session.sessionManager.getSessionId();
	main.session.setSessionName("Directory owner");
	await vi.waitFor(
		() =>
			expect(query(state.dbPath, "select name from sessions where id = ?", self)).toEqual([
				{ name: "Directory owner" },
			]),
		{ timeout: 10000 },
	);
	await colleague("Directory specialist", self);
	pairTool = createSecondOpinionTools(self, () => true).directory;
	expect(pairTool.parameters).toEqual(directoryParameters);
	expect(directoryParameters.properties).not.toHaveProperty("former");
	const cases: (DirectoryOptions & Parameters<typeof fauxToolCall>[1])[] = [
		{},
		{ team: "Directory owner" },
		{ subtree: self, limit: 1 },
		{ name: "specialist" },
		{ person: "Directory owner" },
		{ person: self, history: { limit: 1 } },
	];
	for (const [index, params] of cases.entries()) {
		currentParams = params;
		requests.push(params);
		await main.session.prompt("inspect directory");
		const native = main.session.messages.filter((message) => message.role === "toolResult").at(-1)!;
		expect(native.isError).toBe(false);
		expect(pairedResults).toHaveLength(index + 1);
		const paired = pairedResults.at(-1);
		expect(paired).toEqual({ content: native.content, details: native.details });
		expect(JSON.stringify(paired)).not.toContain('"soul":');
		if (!("history" in params)) expect(JSON.stringify(paired)).not.toContain('"record":');
	}
	const invalid: Parameters<typeof fauxToolCall>[1][] = [{ former: true }, { limit: 0 }, { history: { limit: 1 } }];
	for (const params of invalid) {
		requests.push(params);
		await main.session.prompt("invalid directory request");
		expect(main.session.messages.filter((message) => message.role === "toolResult").at(-1)?.isError).toBe(true);
	}
	await expect(
		pairTool.execute(
			"invalid-pair-directory",
			{ history: { limit: 1 } },
			new AbortController().signal,
			undefined,
			{} as never,
		),
	).rejects.toThrow(/with one person/);
}, 30000);

test("the pair can deliberately name the operator", async () => {
	const main = await paired(undefined, "operator");
	const self = main.session.sessionManager.getSessionId();
	await vi.waitFor(() => expect(opinions(self)).toHaveLength(1), { timeout: 15000 });
	expect(
		query(state.dbPath, "select participant from thread_participants where thread_id = ?", opinions(self)[0].thread_id),
	).toContainEqual({ participant: "operator" });
}, 25000);
