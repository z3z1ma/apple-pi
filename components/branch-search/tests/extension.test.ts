import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
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

	it("blocks root tools that change the workspace while it applies the winner", async () => {
		configure({ ...validConfig(), apply: "auto" });
		const edit = (id: string, value: number) =>
			fauxAssistantMessage(
				fauxToolCall("write", { path: "app.ts", content: `export const value = ${value};\n` }, { id }),
				{
					stopReason: "toolUse",
				},
			);
		let root: Promise<void> | undefined;
		let session: { prompt(text: string): Promise<void> } | undefined;
		const run = await harness(
			{ c1: [WRONG, finish("done", "three")], c2: [FIX, finish("done", "two")] },
			{
				other: (context) => {
					const last = context.messages.at(-1);
					if (text(last) === "Edit app now.") return edit("root-edit", 7);
					if (text(last) === "Edit app again.") return edit("root-again", 8);
					if (last?.role === "toolResult" && last.toolCallId.startsWith("root-"))
						return fauxAssistantMessage("root done");
					return undefined;
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
		const blocked = run.session.messages.find((m) => m.role === "toolResult" && m.toolCallId === "root-edit");
		expect(blocked).toMatchObject({ isError: true });
		expect(text(blocked as never)).toContain("Branch search is applying its winner");
		expect(readFileSync(join(run.cwd, "app.ts"), "utf8")).toBe("export const value = 2;\n");
		// The hold ends with the apply.
		await run.session.prompt("Edit app again.");
		expect(readFileSync(join(run.cwd, "app.ts"), "utf8")).toBe("export const value = 8;\n");
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
