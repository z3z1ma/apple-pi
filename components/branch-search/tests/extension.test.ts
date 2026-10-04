import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import { startFork } from "../../shared/src/forked-continuation.js";
import registerTasks from "../../tasks/src/index.js";
import registerBranchSearch from "../src/index.js";
import type { SearchRecord } from "../src/record.js";
import {
	type Behavior,
	DONE,
	FIX,
	GATE,
	gitOut,
	initFixtureRepo,
	JUDGE,
	scoreOf,
	scriptedModel,
	text,
	validConfig,
	WRONG,
	withOutput,
} from "./fixtures.js";

const cleanup: (() => void)[] = [];
let agentDir: string;
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;

beforeEach(() => {
	agentDir = mkdtempSync(join(tmpdir(), "apple-pi-branch-agent-"));
	process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
	for (const dispose of cleanup.splice(0)) dispose();
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(agentDir, { recursive: true, force: true });
});

const PASSING = [FIX, scoreOf("1", "s1"), DONE];
const FAILING = [WRONG, scoreOf("0", "s2"), DONE];

function configure(config: Record<string, unknown>): void {
	writeFileSync(join(agentDir, "branch-search.json"), JSON.stringify(config));
}

async function harness(
	behaviors: Record<string, Behavior>,
	options: { other?: (context: Context) => Reply | "until-aborted" | undefined } = {},
) {
	const model = scriptedModel(behaviors, undefined, options.other);
	const run = await fauxSession([registerTasks, registerBranchSearch], (context) => model(context), [
		"read",
		"write",
		"edit",
		"ls",
		"bash",
		"search_branches",
	]);
	cleanup.push(run.dispose);
	await run.session.bindExtensions({});
	const cwd = realpathSync(run.cwd);
	initFixtureRepo(cwd);
	await run.session.prompt("Make value equal 2.");
	return { ...run, cwd };
}

const SEARCH_CALL = "search-1";

const SIBLING_CALL = "sibling-1";

/**
 * The parent's scripted turns: "Search now." calls `search_branches` (with a sibling `read` when
 * asked); the call's own result ends the turn. Fork prompts start with "Branch search: ", which no
 * result the parent receives does.
 */
function searchingParent(
	withSibling = false,
	other?: (context: Context) => Reply | "until-aborted" | undefined,
): (context: Context) => Reply | "until-aborted" | undefined {
	return (context) => {
		const answer = other?.(context);
		if (answer !== undefined) return answer;
		const last = context.messages.at(-1);
		if (text(last) === "Search now.") {
			const calls = [
				fauxToolCall(
					"search_branches",
					{ goal: "Make value equal 2.", judges: [JUDGE], gates: [GATE] },
					{ id: SEARCH_CALL },
				),
			];
			if (withSibling) calls.push(fauxToolCall("read", { path: "app.ts" }, { id: SIBLING_CALL }));
			return fauxAssistantMessage(calls, { stopReason: "toolUse" });
		}
		if (last?.role !== "toolResult" || text(last).startsWith("Branch search: ")) return undefined;
		if (last.toolCallId === SEARCH_CALL || last.toolCallId === SIBLING_CALL) return fauxAssistantMessage("parent done");
		return undefined;
	};
}

/** The `search_branches` results in the parent session. */
function searchResults(messages: readonly object[]) {
	return messages.filter(
		(
			m,
		): m is { role: "toolResult"; toolCallId: string; content: { type: string; text?: string }[]; isError: boolean } =>
			(m as { role?: string }).role === "toolResult" && (m as { toolCallId?: string }).toolCallId === SEARCH_CALL,
	);
}

/** The text of each `search_branches` progress update, in order. */
function toolUpdates(session: AgentSession): string[] {
	const updates: string[] = [];
	session.subscribe((event) => {
		if (event.type !== "tool_execution_update" || event.toolName !== "search_branches") return;
		updates.push(text(event.partialResult as never));
	});
	return updates;
}

function recordOf(report: string): SearchRecord {
	const path = /^Record: (.+)$/m.exec(report)?.[1] as string;
	return JSON.parse(readFileSync(path, "utf8"));
}

function worktrees(cwd: string): string[] {
	return gitOut(cwd, "worktree", "list", "--porcelain")
		.split("\n")
		.filter((line) => line.startsWith("worktree "));
}

describe("search_branches", { timeout: 30_000 }, () => {
	it("returns the report as its result, adds no other message, forks from its own pending call, and streams progress", async () => {
		configure(validConfig());
		const run = await harness({ c1: FAILING, c2: PASSING }, { other: searchingParent() });
		const updates = toolUpdates(run.session);
		const before = run.session.messages.length;
		await run.session.prompt("Search now.");

		const [result] = searchResults(run.session.messages);
		const report = text(result as never);
		const record = recordOf(report);
		expect(report.split("\n")[0]).toBe(
			`Branch search ${record.id}: applied. 1 of 2 attempts passed every gate and judge.`,
		);
		expect(result?.isError).toBe(false);
		expect(record.goal).toBe("Make value equal 2.");
		expect(readFileSync(join(run.cwd, "app.ts"), "utf8")).toBe("export const value = 2;\n");
		// The parent gained its prompt, the call, its result, and its reply: no report message (I7).
		expect(run.session.messages.slice(before).map((m) => m.role)).toEqual([
			"user",
			"assistant",
			"toolResult",
			"assistant",
		]);
		expect(run.session.messages.filter((m) => m.role === "custom")).toEqual([]);

		// Every role fork and root starts with the parent's request through the call, then answers the call with its prompt (I4).
		const parentNext = run.requests.find((r) => text(r.messages.at(-1)) === report) as Context;
		const shared = parentNext.messages.length - 1;
		const opening = run.requests.filter((r) => {
			const last = r.messages.at(-1);
			return last?.role === "toolResult" && last.toolCallId === SEARCH_CALL && r !== parentNext;
		});
		expect(opening.map((r) => text(r.messages.at(-1)).split("\n")[0])).toEqual([
			"Branch search: approach list.",
			"Branch search: attempt a1.",
			"Branch search: attempt a2.",
		]);
		for (const request of opening) {
			expect(request.messages).toHaveLength(parentNext.messages.length);
			expect(request.messages.slice(0, shared)).toEqual(parentNext.messages.slice(0, shared));
			expect(request.systemPrompt).toEqual(parentNext.systemPrompt);
			expect(request.tools).toEqual(parentNext.tools);
		}
		// No fork request carries a custom prompt after the call.
		expect(run.requests.filter((r) => r.messages[shared]?.role === "user" && r.messages.length > shared)).toEqual([]);

		// Progress streams through tool updates in the status format; the UI status line stays untouched.
		expect(updates).toEqual(
			expect.arrayContaining(["branching enumerate", "branching run", "branching score", "branching apply"]),
		);
		for (const update of updates) expect(update).toMatch(/^branching \S+$/);
	});

	it("cancels the search and cleans up before the aborted call returns", async () => {
		configure(validConfig());
		const run = await harness({ c1: ["until-aborted"], c2: ["until-aborted"] }, { other: searchingParent() });
		const updates = toolUpdates(run.session);
		const parent = run.session.prompt("Search now.");
		await vi.waitFor(() => expect(updates).toContain("branching run"), { timeout: 20_000 });
		const [id] = readdirSync(join(run.cwd, ".git", "apple-pi", "branch-search"));

		await run.session.abort();
		await parent;
		expect(worktrees(run.cwd)).toEqual([`worktree ${run.cwd}`]);
		const stateDir = join(run.cwd, ".git", "apple-pi", "branch-search", id as string);
		expect(existsSync(join(stateDir, "wt"))).toBe(false);
		const record = JSON.parse(readFileSync(join(stateDir, "record.json"), "utf8")) as SearchRecord;
		expect(record.outcome).toBe("aborted: cancelled");
		expect(record.endedAt).not.toBeNull();
		const [result] = searchResults(run.session.messages);
		expect(text(result as never).split("\n")[0]).toMatch(new RegExp(`^Branch search ${id}: aborted: cancelled\\.`));
		expect(run.session.messages.filter((m) => m.role === "custom")).toEqual([]);
	});

	it("lets the judge model on judge.profile choose among the attempts that pass every gate", async () => {
		configure({ ...validConfig(), attempts: 3, judge: { profile: "deep" } });
		writeFileSync(
			join(agentDir, "model-profiles.json"),
			JSON.stringify({ profiles: { deep: { model: "faux-session-provider/faux-session-model", thinking: "off" } } }),
		);
		const choices: Context[] = [];
		const run = await harness(
			{ c1: FAILING, c2: PASSING, c3: [FIX, scoreOf("2", "s3"), DONE] },
			{
				other: searchingParent(false, (context) => {
					if (!text(context.messages.at(-1)).includes("Choose the attempt you would merge")) return undefined;
					choices.push(context);
					return withOutput(fauxAssistantMessage('{"winner":"a3","reason":"simpler"}'), 13);
				}),
			},
		);
		await run.session.prompt("Search now.");

		const record = recordOf(text(searchResults(run.session.messages)[0] as never));
		expect(record.judges).toEqual([JUDGE]);
		expect(record.gates).toEqual([GATE]);
		// One request without the parent's conversation; it chose a3 over a2's better number.
		expect(choices).toHaveLength(1);
		expect(choices[0]?.messages).toHaveLength(1);
		expect(record.winner).toBe("a3");
		expect(readFileSync(join(run.cwd, "score.txt"), "utf8")).toBe("2\n");
		expect(record.cost.outputTokens).toBeGreaterThanOrEqual(13);
	});

	it("finishes cleanup before a session shutdown handler returns", async () => {
		configure(validConfig());
		const run = await harness({ c1: ["until-aborted"], c2: ["until-aborted"] }, { other: searchingParent() });
		const updates = toolUpdates(run.session);
		const parent = run.session.prompt("Search now.");
		await vi.waitFor(() => expect(updates).toContain("branching run"), { timeout: 20_000 });
		const [id] = readdirSync(join(run.cwd, ".git", "apple-pi", "branch-search"));
		const stateDir = join(run.cwd, ".git", "apple-pi", "branch-search", id as string);

		await run.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });

		expect(worktrees(run.cwd)).toEqual([`worktree ${run.cwd}`]);
		const record = JSON.parse(readFileSync(join(stateDir, "record.json"), "utf8")) as SearchRecord;
		expect(record.outcome).toBe("aborted: cancelled");
		expect(record.endedAt).not.toBeNull();
		expect(existsSync(join(stateDir, "wt"))).toBe(false);
		await parent;
	});

	it("returns the missing configuration keys as an error and starts nothing", async () => {
		const config = validConfig();
		delete config.attempts;
		delete config.limits;
		configure(config);
		const run = await harness({ c1: PASSING }, { other: searchingParent() });
		await run.session.prompt("Search now.");

		const [result] = searchResults(run.session.messages);
		expect(result?.isError).toBe(true);
		expect(text(result as never)).toContain("attempts: missing");
		expect(text(result as never)).toContain("limits: missing");
		expect(existsSync(join(run.cwd, ".git", "apple-pi"))).toBe(false);
	});

	it("refuses a call that shares its message with other tool calls and starts nothing", async () => {
		configure(validConfig());
		const run = await harness({ c1: [FIX] }, { other: searchingParent(true) });
		const before = run.requests.length;
		await run.session.prompt("Search now.");

		const [result] = searchResults(run.session.messages);
		expect(result?.isError).toBe(true);
		expect(text(result as never)).toContain("Call search_branches on its own");
		// The sibling still ran, and only the parent's own two requests were sent.
		const sibling = run.session.messages.find((m) => m.role === "toolResult" && m.toolCallId === SIBLING_CALL);
		expect(sibling).toMatchObject({ isError: false });
		expect(run.requests).toHaveLength(before + 2);
		expect(existsSync(join(run.cwd, ".git", "apple-pi"))).toBe(false);
	});

	it("is blocked inside a branch search fork and inside any other forked continuation", async () => {
		configure(validConfig());
		const nested = fauxAssistantMessage(
			fauxToolCall("search_branches", { goal: "nested", judges: [JUDGE] }, { id: "nested-1" }),
			{
				stopReason: "toolUse",
			},
		);
		const run = await harness(
			{ c1: [nested, DONE], c2: PASSING },
			{
				other: searchingParent(false, (context) => {
					const last = context.messages.at(-1);
					if (text(last) === "Reflect.") return nested;
					if (
						last?.role === "toolResult" &&
						last.toolCallId === "nested-1" &&
						!context.messages.some((m) => text(m).startsWith("Branch search: "))
					)
						return fauxAssistantMessage("reflected");
					return undefined;
				}),
			},
		);
		await run.session.prompt("Search now.");
		expect(text(searchResults(run.session.messages)[0] as never)).toMatch(/: applied\./);
		const blocked = run.requests
			.flatMap((r) => r.messages)
			.find((m) => m.role === "toolResult" && m.toolCallId === "nested-1");
		expect(blocked).toMatchObject({ isError: true });
		expect(text(blocked)).toContain("not available");
		expect(readdirSync(join(run.cwd, ".git", "apple-pi", "branch-search"))).toHaveLength(1);

		// A fork outside branch search (a reflection) reaches the tool, which refuses it.
		const reflection = await startFork(run.session, {
			messages: run.session.sessionManager.buildSessionProjection().messages,
			append: { role: "custom", customType: "test", content: "Reflect.", display: false, timestamp: Date.now() },
			label: "test reflection",
		}).result;
		const refused = reflection.messages.find((m) => m.role === "toolResult" && m.toolCallId === "nested-1");
		expect(refused).toMatchObject({ isError: true });
		expect(text(refused as never)).toBe("search_branches is not available inside a forked continuation.");
		expect(readdirSync(join(run.cwd, ".git", "apple-pi", "branch-search"))).toHaveLength(1);
	});
});
