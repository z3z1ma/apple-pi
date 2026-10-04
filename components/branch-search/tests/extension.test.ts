import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import type { AgentSession, ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import { startFork } from "../../shared/src/forked-continuation.js";
import registerTasks from "../../tasks/src/index.js";
import registerBranchSearch from "../src/index.js";
import type { SearchRecord } from "../src/record.js";
import type { ScorerSpec } from "../src/scorer.js";
import {
	type Behavior,
	FIX,
	finish,
	gitOut,
	initFixtureRepo,
	scriptedModel,
	text,
	validConfig,
	WRONG,
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

const SCORER: ScorerSpec = {
	version: 1,
	goal: "value is 2",
	files: [{ path: "hidden/gate.sh", content: "bash check.sh\n" }],
	protect: ["check.sh"],
	gates: [{ id: "value", run: "bash hidden/gate.sh", onBase: "fail", timeoutSec: 30 }],
	objectives: [],
};
const AUTHOR = fauxAssistantMessage(JSON.stringify(SCORER));

function configure(config: Record<string, unknown>): void {
	writeFileSync(join(agentDir, "branch-search.json"), JSON.stringify(config));
}

/** A UI that records what the extension shows. */
function recordingUi(onStatus?: (status: string | undefined) => void) {
	const notes: string[] = [];
	const statuses: (string | undefined)[] = [];
	const ui = new Proxy(
		{
			notify: (message: string) => notes.push(message),
			setStatus: (key: string, value: string | undefined) => {
				if (key !== "branch-search") return;
				statuses.push(value);
				onStatus?.(value);
			},
		} as Record<string, unknown>,
		{ get: (target, key) => target[key as string] ?? (() => undefined) },
	) as unknown as ExtensionUIContext;
	return { ui, notes, statuses };
}

async function harness(
	behaviors: Record<string, Behavior>,
	options: {
		other?: (context: Context) => Reply | "until-aborted" | undefined;
		settle?: boolean;
		onStatus?: (status: string | undefined) => void;
	} = {},
) {
	const model = scriptedModel(behaviors, undefined, [AUTHOR], options.other);
	const run = await fauxSession([registerTasks, registerBranchSearch], (context) => model(context), [
		"read",
		"write",
		"edit",
		"ls",
		"bash",
		"search_branches",
	]);
	cleanup.push(run.dispose);
	const recorded = recordingUi(options.onStatus);
	await run.session.bindExtensions({ uiContext: recorded.ui });
	const cwd = realpathSync(run.cwd);
	initFixtureRepo(cwd);
	if (options.settle !== false) await run.session.prompt("Make value equal 2.");
	const reports = () => run.customMessages("branch-search");
	const authorRequests = () =>
		run.requests.filter((request) =>
			request.messages.some((m) => text(m).includes("Branch search: acceptance checks.")),
		);
	return { ...run, ...recorded, cwd, reports, authorRequests };
}

const SEARCH_CALL = "search-1";

const SIBLING_CALL = "sibling-1";

/**
 * The parent's scripted turns: "Search now." calls `search_branches` (with a sibling `read` when
 * asked); the call's own result ends the turn. Fork prompts start with "Branch search: ", which no
 * result the parent receives does.
 */
function searchingParent(withSibling = false): (context: Context) => Reply | "until-aborted" | undefined {
	return (context) => {
		const last = context.messages.at(-1);
		if (text(last) === "Search now.") {
			const calls = [fauxToolCall("search_branches", { goal: "Make value equal 2." }, { id: SEARCH_CALL })];
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

function reportText(message: object | undefined): string {
	const content = (message as { content?: unknown } | undefined)?.content;
	return typeof content === "string" ? content : "";
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

describe("/branch-search", { timeout: 30_000 }, () => {
	it("authors a scorer, applies the passing approach the model did not prefer, and adds one passive message", async () => {
		configure({ ...validConfig(), apply: "auto", scorer: { validationRetries: 1, reviewProfile: "deep" } });
		writeFileSync(
			join(agentDir, "model-profiles.json"),
			JSON.stringify({ profiles: { deep: { model: "faux-session-provider/faux-session-model", thinking: "off" } } }),
		);
		const reviews: Context[] = [];
		const run = await harness(
			{ c1: [WRONG, finish("done", "three")], c2: [FIX, finish("done", "two")] },
			{
				other: (context) => {
					if (!text(context.messages.at(-1)).includes("Review an acceptance spec")) return undefined;
					reviews.push(context);
					return fauxAssistantMessage('{"verdict":"confirm"}');
				},
			},
		);
		await run.session.prompt("/branch-search Make value equal 2.");
		await vi.waitFor(() => expect(run.reports()).toHaveLength(1), { timeout: 20_000 });

		const report = reportText(run.reports()[0]);
		const record = recordOf(report);
		expect(report.split("\n")[0]).toBe(
			`Branch search ${record.id}: applied. 1 of 2 branches survived over 1 generations.`,
		);
		expect(readFileSync(join(run.cwd, "app.ts"), "utf8")).toBe("export const value = 2;\n");
		// The enumerator preferred c1, which failed; the passing c2 was applied (A6).
		expect(record.enumerations[0]?.preferred).toBe("c1");
		expect(record.branches.find((branch) => branch.key === record.winner)?.candidate).toBe("c2");
		expect(record.mode).toBe("human");
		expect(record.goal).toBe("Make value equal 2.");
		expect(run.authorRequests()).toHaveLength(1);
		// The review went to the profile's model as one request, without the parent's conversation.
		expect(reviews).toHaveLength(1);
		expect(reviews[0]?.messages).toHaveLength(1);
		expect(record.spec?.review).toEqual(expect.objectContaining({ profile: "deep", verdict: "confirm" }));
		// Exactly one message joins the parent, and it started no turn.
		expect(run.session.messages.filter((message) => message.role === "custom")).toHaveLength(1);
		expect(run.session.messages.at(-1)).toBe(run.reports()[0]);
		expect(run.session.isStreaming).toBe(false);
		expect(run.statuses).toContain("branching author 0/0");
		expect(run.statuses.at(-1)).toBeUndefined();
	});

	it("prints status, refuses a second search, and cancels with cleanup", async () => {
		configure(validConfig());
		const run = await harness({ c1: ["until-aborted"], c2: ["until-aborted"] });
		await run.session.prompt("/branch-search Make value equal 2.");
		await vi.waitFor(() => expect(run.statuses).toContain("branching run g0 2/2"), { timeout: 20_000 });

		await run.session.prompt("/branch-search status");
		const status = run.notes.at(-1) as string;
		const id = /Branch search (bs-\S+)/.exec(status)?.[1] as string;
		expect(id).toMatch(/^bs-\d{8}-\d{6}-[0-9a-f]{4}$/);
		expect(status).toContain("phase: run g0");
		expect(status).toContain("branches: 2 running, 0 stopped, 0 survived, 0 dead");
		expect(status).toMatch(/elapsed: \d+s/);

		await run.session.prompt("/branch-search something else");
		expect(run.notes.at(-1)).toBe(`Branch search ${id} is already running.`);
		expect(run.authorRequests()).toHaveLength(1);

		await run.session.prompt("/branch-search cancel");
		await vi.waitFor(() => expect(run.reports()).toHaveLength(1), { timeout: 20_000 });
		const report = reportText(run.reports()[0]);
		expect(report.split("\n")[0]).toMatch(new RegExp(`^Branch search ${id}: aborted: cancelled\\.`));
		expect(worktrees(run.cwd)).toEqual([`worktree ${run.cwd}`]);
		expect(gitOut(run.cwd, "for-each-ref", "--format=%(refname)", "refs/apple-pi/")).toBe(
			`refs/apple-pi/branch-search/${id}/base`,
		);
		expect(run.statuses.at(-1)).toBeUndefined();

		await run.session.prompt("/branch-search status");
		expect(run.notes.at(-1)).toBe("No branch search is running.");
	});

	it("queues a search issued while the root run streams and starts it at the next settle", async () => {
		configure(validConfig());
		const sleeping = fauxAssistantMessage(
			fauxToolCall("bash", { command: "sleep 1", verbatim: true }, { id: "parent-sleep" }),
			{ stopReason: "toolUse" },
		);
		const run = await harness(
			{ c1: [FIX, finish("done", "two")], c2: [WRONG, finish("done", "three")] },
			{
				settle: false,
				other: (context) => {
					const last = context.messages.at(-1);
					if (text(last) === "Start the work.") return sleeping;
					if (last?.role === "toolResult" && last.toolCallId === "parent-sleep")
						return fauxAssistantMessage("parent finished");
					return undefined;
				},
			},
		);
		const parent = run.session.prompt("Start the work.");
		await vi.waitFor(() => expect(run.session.isStreaming).toBe(true));
		await run.session.prompt("/branch-search Make value equal 2.");

		expect(run.notes.at(-1)).toBe("branch search queued");
		expect(run.statuses.at(-1)).toBe("branch search queued");
		expect(run.authorRequests()).toHaveLength(0);
		await parent;
		await vi.waitFor(() => expect(run.reports()).toHaveLength(1), { timeout: 20_000 });

		// The fork point is the settled conversation, so the author sees the parent's last reply.
		const [author] = run.authorRequests();
		expect(author?.messages.some((message) => text(message) === "parent finished")).toBe(true);
		expect(reportText(run.reports()[0])).toMatch(/: ready\./);
	});

	it("blocks root tools that change the workspace while it applies the winner, and a retried edit survives", async () => {
		configure({ ...validConfig(), apply: "auto" });
		const edit = (id: string) =>
			fauxAssistantMessage(fauxToolCall("write", { path: "app.ts", content: "export const value = 7;\n" }, { id }), {
				stopReason: "toolUse",
			});
		let root: Promise<void> | undefined;
		let session: { prompt(text: string): Promise<void> } | undefined;
		let attempts = 0;
		const run = await harness(
			{ c1: [WRONG, finish("done", "three")], c2: [FIX, finish("done", "two")] },
			{
				other: (context) => {
					const last = context.messages.at(-1);
					if (text(last) === "Edit app now.") return edit(`root-${attempts++}`);
					if (last?.role !== "toolResult") return undefined;
					// The same root turn retries its edit after each refusal, as the reason asks, reading
					// the file in between (a real wait; the scripted model itself never yields).
					if (last.toolCallId.startsWith("look-")) return edit(`root-${attempts++}`);
					if (!last.toolCallId.startsWith("root-")) return undefined;
					if (last.isError && attempts < 500)
						return fauxAssistantMessage(fauxToolCall("read", { path: "app.ts" }, { id: `look-${attempts}` }), {
							stopReason: "toolUse",
						});
					return fauxAssistantMessage("root done");
				},
				onStatus: (status) => {
					// A root turn that starts once the apply holds the session.
					if (status?.startsWith("branching apply")) setTimeout(() => (root = session?.prompt("Edit app now.")), 0);
				},
			},
		);
		session = run.session;
		await run.session.prompt("/branch-search Make value equal 2.");
		await vi.waitFor(() => expect(run.reports()).toHaveLength(1), { timeout: 20_000 });
		await vi.waitFor(() => expect(root).toBeDefined());
		await root;

		expect(reportText(run.reports()[0])).toMatch(/: applied\./);
		const results = run.session.messages.filter((m) => m.role === "toolResult" && m.toolCallId.startsWith("root-"));
		const blocked = results.filter((m) => m.role === "toolResult" && m.isError);
		expect(blocked.length).toBeGreaterThan(0);
		for (const result of blocked) expect(text(result as never)).toContain("Branch search is applying its winner");
		expect(results.at(-1)).toMatchObject({ isError: false });
		// The edit retried after the hold ended lands over the applied winner, and nothing undoes it.
		expect(readFileSync(join(run.cwd, "app.ts"), "utf8")).toBe("export const value = 7;\n");
		const record = recordOf(reportText(run.reports()[0]));
		expect(record.apply).toEqual(expect.objectContaining({ applied: true }));
	});

	it("finishes cleanup before a session shutdown handler returns", async () => {
		configure(validConfig());
		const run = await harness({ c1: ["until-aborted"], c2: ["until-aborted"] });
		await run.session.prompt("/branch-search Make value equal 2.");
		await vi.waitFor(() => expect(run.statuses).toContain("branching run g0 2/2"), { timeout: 20_000 });
		const [id] = readdirSync(join(run.cwd, ".git", "apple-pi", "branch-search"));
		const stateDir = join(run.cwd, ".git", "apple-pi", "branch-search", id as string);

		await run.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });

		expect(worktrees(run.cwd)).toEqual([`worktree ${run.cwd}`]);
		const record = JSON.parse(readFileSync(join(stateDir, "record.json"), "utf8")) as SearchRecord;
		expect(record.outcome).toBe("aborted: cancelled");
		expect(record.endedAt).not.toBeNull();
		expect(existsSync(join(stateDir, "wt"))).toBe(false);
		expect(run.reports()).toHaveLength(0);
	});

	it("prints the missing configuration keys and starts nothing", async () => {
		const config = validConfig();
		delete config.apply;
		delete config.constraints;
		configure(config);
		const run = await harness({ c1: [FIX] });
		const before = run.requests.length;
		await run.session.prompt("/branch-search Make value equal 2.");

		expect(run.notes.at(-1)).toContain("apply: missing");
		expect(run.notes.at(-1)).toContain("constraints: missing");
		expect(run.requests).toHaveLength(before);
		expect(existsSync(join(run.cwd, ".git", "apple-pi"))).toBe(false);
		expect(run.reports()).toHaveLength(0);
	});

	it("renders the report's summary line collapsed and its body expanded", () => {
		const renderers = new Map<string, (...args: any[]) => { render(width: number): string[] }>();
		const pi = {
			on: () => {},
			registerCommand: () => {},
			registerTool: () => {},
			registerMessageRenderer: (type: string, renderer: (...args: any[]) => any) => renderers.set(type, renderer),
		} as unknown as ExtensionAPI;
		registerBranchSearch(pi);
		const render = renderers.get("branch-search") as (...args: any[]) => { render(width: number): string[] };
		const theme = { fg: (_color: string, value: string) => value };
		const message = { content: "Branch search bs-1: applied. 1 of 2 branches survived.\nWinner: r1\nRecord: x" };

		expect(render(message, { expanded: false }, theme).render(200)).toEqual([
			"↳ Branch search bs-1: applied. 1 of 2 branches survived.",
		]);
		expect(render(message, { expanded: true }, theme).render(200).join("\n")).toContain("Winner: r1\nRecord: x");
	});
});

const FAILING = 'echo "Error: value is 1 at app.ts:$RANDOM"; exit 1';

/** The parent's scripted turns: `prompt` runs FAILING `times` times in one run, then ends it. */
function failingParent(prompt: string, times: number): (context: Context) => Reply | "until-aborted" | undefined {
	return (context) => {
		const last = context.messages.at(-1);
		const ran = (id: string) => last?.role === "toolResult" && last.toolCallId === id;
		const call = (n: number) =>
			fauxAssistantMessage(fauxToolCall("bash", { command: FAILING, verbatim: true }, { id: `${prompt}-${n}` }), {
				stopReason: "toolUse",
			});
		if (text(last) === prompt) return call(1);
		for (let n = 1; n < times; n++) if (ran(`${prompt}-${n}`)) return call(n + 1);
		if (ran(`${prompt}-${times}`)) return fauxAssistantMessage(`${prompt} done`);
		return undefined;
	};
}

function searchDirs(cwd: string): string[] {
	const dir = join(cwd, ".git", "apple-pi", "branch-search");
	return existsSync(dir) ? readdirSync(dir) : [];
}

/** A passive search starts inside the settle handler, so right after a run no search may be active. */
async function expectNoSearch(run: Awaited<ReturnType<typeof harness>>) {
	await run.session.prompt("/branch-search status");
	expect(run.notes.at(-1)).toBe("No branch search is running.");
}

describe("passive activation", { timeout: 30_000 }, () => {
	it("starts one passive search at the next settle after a failure repeats to the threshold, with that command as seed gate", async () => {
		configure({ ...validConfig(), passive: { enabled: true, repeatThreshold: 3 } });
		const first = failingParent("Fail thrice.", 3);
		const again = failingParent("Fail again.", 2);
		const run = await harness(
			{ c1: [FIX, finish("done", "two")], c2: [WRONG, finish("done", "three")] },
			{ other: (context) => first(context) ?? again(context) },
		);
		await run.session.prompt("Fail thrice.");
		await vi.waitFor(() => expect(run.reports()).toHaveLength(1), { timeout: 20_000 });

		const record = recordOf(reportText(run.reports()[0]));
		expect(record.mode).toBe("passive");
		expect(record.seedGate).toBe(FAILING);
		expect(record.goal).toBeNull();
		// The report records the signature the search spent, which a later session start reads back.
		expect((run.reports()[0] as { details?: { consumedSignatures?: unknown } }).details?.consumedSignatures).toEqual([
			expect.stringMatching(/^[0-9a-f]{64}$/),
		]);
		const [author] = run.authorRequests();
		expect(text(author?.messages.at(-1))).toContain(
			`The command \`${FAILING}\` failed repeatedly. Use it as a gate with onBase "fail" if it expresses the goal.`,
		);
		// The fork point is the settled conversation, and the report is the one message the search adds.
		expect(author?.messages.some((message) => text(message) === "Fail thrice. done")).toBe(true);
		expect(run.session.messages.filter((message) => message.role === "custom")).toHaveLength(1);

		// The same signature, repeated further, never starts a second search.
		await run.session.prompt("Fail again.");
		await expectNoSearch(run);
		await run.session.prompt("Fail again.");
		await expectNoSearch(run);
		expect(run.notes.filter((note) => note.startsWith("Branch search started"))).toEqual([
			`Branch search started: \`${FAILING}\` failed 3 times.`,
		]);
		expect(searchDirs(run.cwd)).toEqual([record.id]);
		expect(run.authorRequests()).toHaveLength(1);
		expect(run.reports()).toHaveLength(1);
	});

	it("never starts a passive search for a signature that was due when an operator-cancelled search_branches started", async () => {
		configure({ ...validConfig(), passive: { enabled: true, repeatThreshold: 2 } });
		const twice = failingParent("Fail twice.", 2);
		const once = failingParent("Fail once.", 1);
		const search = searchingParent();
		const run = await harness(
			{ c1: ["until-aborted"], c2: ["until-aborted"] },
			{
				other: (context) => {
					// The run that crosses the threshold then calls search_branches.
					const last = context.messages.at(-1);
					if (last?.role === "toolResult" && last.toolCallId === "Fail twice.-2")
						return fauxAssistantMessage(
							fauxToolCall("search_branches", { goal: "Make value equal 2." }, { id: SEARCH_CALL }),
							{ stopReason: "toolUse" },
						);
					return twice(context) ?? once(context) ?? search(context);
				},
			},
		);
		const updates = toolUpdates(run.session);
		const parent = run.session.prompt("Fail twice.");
		await vi.waitFor(() => expect(updates).toContain("branching run g0 2/2"), { timeout: 20_000 });
		await run.session.abort();
		await parent;
		expect(searchResults(run.session.messages)).toHaveLength(1);

		// The settle after the abort, and later failures of the same signature, start nothing.
		await expectNoSearch(run);
		await run.session.prompt("Fail once.");
		await expectNoSearch(run);
		// The tool result carries the spent signature, so a reload keeps it spent.
		await run.session.reload();
		await run.session.prompt("Fail once.");
		await expectNoSearch(run);
		expect(searchDirs(run.cwd)).toHaveLength(1);
		expect(run.notes.filter((note) => note.startsWith("Branch search started"))).toEqual([]);
	});

	it("never starts a passive search for a signature that was due when a cancelled /branch-search started", async () => {
		configure({ ...validConfig(), passive: { enabled: false, repeatThreshold: 2 } });
		const twice = failingParent("Fail twice.", 2);
		const once = failingParent("Fail once.", 1);
		const run = await harness(
			{ c1: ["until-aborted"], c2: ["until-aborted"] },
			{ other: (context) => twice(context) ?? once(context) },
		);
		await run.session.prompt("Fail twice.");
		await run.session.prompt("/branch-search Make value equal 2.");
		await vi.waitFor(() => expect(run.statuses).toContain("branching run g0 2/2"), { timeout: 20_000 });
		await run.session.prompt("/branch-search cancel");
		await vi.waitFor(() => expect(run.reports()).toHaveLength(1), { timeout: 20_000 });

		// Passive activation turned on afterwards still finds the signature spent.
		configure({ ...validConfig(), passive: { enabled: true, repeatThreshold: 2 } });
		await run.session.prompt("Fail once.");
		await expectNoSearch(run);
		expect(searchDirs(run.cwd)).toHaveLength(1);
	});

	it("keeps counts and spent signatures across a reload of the same session", async () => {
		configure({ ...validConfig(), passive: { enabled: true, repeatThreshold: 3 } });
		const twice = failingParent("Fail twice.", 2);
		const once = failingParent("Fail once.", 1);
		const run = await harness(
			{ c1: [FIX, finish("done", "two")], c2: [WRONG, finish("done", "three")] },
			{ other: (context) => twice(context) ?? once(context) },
		);
		const reload = () => run.session.reload();
		await run.session.prompt("Fail twice.");
		await expectNoSearch(run);
		// Two failures before the reload and one after reach the threshold.
		await reload();
		await run.session.prompt("Fail once.");
		await vi.waitFor(() => expect(run.reports()).toHaveLength(1), { timeout: 20_000 });

		// After another reload, the signature that already started a search starts none.
		await reload();
		await run.session.prompt("Fail once.");
		await expectNoSearch(run);
		expect(searchDirs(run.cwd)).toHaveLength(1);
	});

	it("starts nothing with passive mode off, however often a failure repeats", async () => {
		configure({ ...validConfig(), passive: { enabled: false, repeatThreshold: 2 } });
		const run = await harness({ c1: [FIX] }, { other: failingParent("Fail often.", 5) });
		await run.session.prompt("Fail often.");
		await expectNoSearch(run);
		await run.session.prompt("Hello.");
		await expectNoSearch(run);

		expect(searchDirs(run.cwd)).toEqual([]);
		expect(run.authorRequests()).toHaveLength(0);
		expect(run.statuses).toEqual([]);
	});

	it("does not count tool results produced inside forks", async () => {
		configure({ ...validConfig(), passive: { enabled: true, repeatThreshold: 3 } });
		const failing = (id: string) =>
			fauxAssistantMessage(fauxToolCall("bash", { command: FAILING, verbatim: true }, { id }), {
				stopReason: "toolUse",
			});
		const run = await harness(
			{
				c1: [FIX, failing("c1-1"), failing("c1-2"), finish("done", "two")],
				c2: [WRONG, failing("c2-1"), failing("c2-2"), finish("done", "three")],
			},
			{ other: failingParent("Fail once.", 1) },
		);
		await run.session.prompt("/branch-search Make value equal 2.");
		await vi.waitFor(() => expect(run.reports()).toHaveLength(1), { timeout: 20_000 });
		const branchRuns = run.requests.flatMap((r) => r.messages).filter((m) => m.role === "toolResult");
		expect(branchRuns.some((m) => m.role === "toolResult" && m.toolCallId === "c2-2")).toBe(true);

		// Four failures in forks and one in the root: below the root threshold, so nothing starts.
		await run.session.prompt("Fail once.");
		await expectNoSearch(run);
		expect(searchDirs(run.cwd)).toHaveLength(1);
		expect(run.authorRequests()).toHaveLength(1);
		expect(run.reports()).toHaveLength(1);
	});
});

describe("search_branches", { timeout: 30_000 }, () => {
	it("returns the report as its result, adds no other message, forks from its own pending call, and streams progress", async () => {
		configure({ ...validConfig(), apply: "auto" });
		const run = await harness(
			{ c1: [WRONG, finish("done", "three")], c2: [FIX, finish("done", "two")] },
			{ other: searchingParent() },
		);
		const updates = toolUpdates(run.session);
		const before = run.session.messages.length;
		await run.session.prompt("Search now.");

		const [result] = searchResults(run.session.messages);
		const report = text(result as never);
		const record = recordOf(report);
		expect(report.split("\n")[0]).toBe(
			`Branch search ${record.id}: applied. 1 of 2 branches survived over 1 generations.`,
		);
		expect(result?.isError).toBe(false);
		expect(record.mode).toBe("agent");
		expect(record.goal).toBe("Make value equal 2.");
		expect(readFileSync(join(run.cwd, "app.ts"), "utf8")).toBe("export const value = 2;\n");
		// The parent gained its prompt, the call, its result, and its reply: no report message (I7).
		expect(run.session.messages.slice(before).map((m) => m.role)).toEqual([
			"user",
			"assistant",
			"toolResult",
			"assistant",
		]);
		expect(run.reports()).toHaveLength(0);

		// Every role fork and root starts with the parent's request through the call, then answers the call with its prompt (I4).
		const parentNext = run.requests.find((r) => text(r.messages.at(-1)) === report) as Context;
		const shared = parentNext.messages.length - 1;
		const opening = run.requests.filter((r) => {
			const last = r.messages.at(-1);
			return last?.role === "toolResult" && last.toolCallId === SEARCH_CALL && r !== parentNext;
		});
		expect(opening.map((r) => text(r.messages.at(-1)).split("\n")[0])).toEqual([
			"Branch search: acceptance checks.",
			"Branch search: approach list.",
			expect.stringMatching(/^Branch search: attempt r0\./),
			expect.stringMatching(/^Branch search: attempt r1\./),
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
			expect.arrayContaining(["branching author 0/0", "branching run g0 2/2", "branching apply 1/2"]),
		);
		for (const update of updates) expect(update).toMatch(/^branching \S+( g\d+)? \d+\/\d+$/);
		expect(run.statuses).toEqual([]);
	});

	it("cancels the search and cleans up before the aborted call returns", async () => {
		configure(validConfig());
		const run = await harness({ c1: ["until-aborted"], c2: ["until-aborted"] }, { other: searchingParent() });
		const updates = toolUpdates(run.session);
		const parent = run.session.prompt("Search now.");
		await vi.waitFor(() => expect(updates).toContain("branching run g0 2/2"), { timeout: 20_000 });
		const [id] = readdirSync(join(run.cwd, ".git", "apple-pi", "branch-search"));

		// A command while the tool's search runs names it and starts nothing.
		await run.session.prompt("/branch-search something else");
		expect(run.notes.at(-1)).toBe(`Branch search ${id} is already running.`);

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
		expect(run.reports()).toHaveLength(0);

		await run.session.prompt("/branch-search status");
		expect(run.notes.at(-1)).toBe("No branch search is running.");
	});

	it("returns at once while another search runs", async () => {
		configure(validConfig());
		const run = await harness({ c1: ["until-aborted"], c2: ["until-aborted"] }, { other: searchingParent() });
		await run.session.prompt("/branch-search Make value equal 2.");
		await vi.waitFor(() => expect(run.statuses).toContain("branching run g0 2/2"), { timeout: 20_000 });
		const [id] = readdirSync(join(run.cwd, ".git", "apple-pi", "branch-search"));

		await run.session.prompt("Search now.");
		const [result] = searchResults(run.session.messages);
		expect(result?.isError).toBe(true);
		expect(text(result as never)).toBe(`Branch search ${id} is already running.`);
		expect(readdirSync(join(run.cwd, ".git", "apple-pi", "branch-search"))).toEqual([id]);
		expect(run.authorRequests()).toHaveLength(1);

		await run.session.prompt("/branch-search cancel");
		await vi.waitFor(() => expect(run.reports()).toHaveLength(1), { timeout: 20_000 });
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
		const nested = fauxAssistantMessage(fauxToolCall("search_branches", { goal: "nested" }, { id: "nested-1" }), {
			stopReason: "toolUse",
		});
		const run = await harness(
			{ c1: [nested, finish("done", "tried")], c2: [FIX, finish("done", "two")] },
			{
				other: (context) => {
					const last = context.messages.at(-1);
					if (text(last) === "Reflect.") return nested;
					if (
						last?.role === "toolResult" &&
						last.toolCallId === "nested-1" &&
						!context.messages.some((m) => text(m).startsWith("Branch search: "))
					)
						return fauxAssistantMessage("reflected");
					return undefined;
				},
			},
		);
		await run.session.prompt("/branch-search Make value equal 2.");
		await vi.waitFor(() => expect(run.reports()).toHaveLength(1), { timeout: 20_000 });
		const blocked = run.requests
			.flatMap((r) => r.messages)
			.find((m) => m.role === "toolResult" && m.toolCallId === "nested-1");
		expect(blocked).toMatchObject({ isError: true });
		expect(text(blocked)).toBe("This tool is not available inside a branch search attempt.");
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
