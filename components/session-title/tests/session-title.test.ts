import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { type ExtensionAPI, type ExtensionFactory, SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import { runInChildSessionContext } from "../../subagents/src/child-context.js";
import registerSessionTitle, { SESSION_TITLE_ENTRY } from "../src/index.js";

const cleanup: (() => void)[] = [];
let agentDir: string;
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;

beforeEach(() => {
	agentDir = mkdtempSync(join(tmpdir(), "apple-pi-session-title-"));
	process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
	for (const dispose of cleanup.splice(0)) dispose();
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(agentDir, { recursive: true, force: true });
});

function quickProfile(): void {
	writeFileSync(
		join(agentDir, "model-profiles.json"),
		JSON.stringify({ profiles: { quick: { model: "faux-session-provider/faux-session-model", thinking: "off" } } }),
	);
}

type Stage = "provisional" | "refined" | "ledger";

/** The stage of a title request, or undefined for a session turn. */
function stageOf(context: Context): Stage | undefined {
	const first = context.messages[0];
	if (typeof first?.content !== "string" || !first.content.includes("word title")) return undefined;
	if (first.content.includes("<task>")) return "ledger";
	return first.content.includes("<assistant>") ? "refined" : "provisional";
}

const TITLES: Record<Stage, string> = {
	provisional: '"Parser crash."',
	refined: "Fix CSV parser crash\nextra line",
	ledger: "Upload retry work",
};

/** Stand-ins for the ledger tools: they return the result details the real tools do. */
const fakeLedger: ExtensionFactory = (pi) => {
	pi.registerTool({
		name: "ledger_add",
		label: "Add",
		description: "Add a task",
		parameters: Type.Object({ title: Type.String(), description: Type.String() }),
		async execute() {
			return {
				content: [{ type: "text" as const, text: "Added" }],
				details: { taskId: "t1", taskPath: ".ledger/t1/task.md", status: "planning" },
			};
		},
	});
	pi.registerTool({
		name: "ledger_status",
		label: "Status",
		description: "Move a task",
		parameters: Type.Object({ task: Type.String(), status: Type.String() }),
		async execute(_id, params) {
			return {
				content: [{ type: "text" as const, text: "Moved" }],
				details: { taskId: params.task, taskPath: `.ledger/${params.task}/task.md`, status: params.status },
			};
		},
	});
};

function toolTurn(name: string, args: Record<string, string>, id: string): Reply {
	return fauxAssistantMessage(fauxToolCall(name, args, { id }), { stopReason: "toolUse" });
}

interface Options {
	tui?: boolean;
	factory?: (pi: ExtensionAPI) => void;
	/** Session turns in order; "Done." once exhausted. */
	turns?: (Reply | Promise<Reply>)[];
	title?: (stage: Stage) => Reply | Promise<Reply>;
	cwd?: string;
	sessionManager?: SessionManager;
}

/** A real session with the extension and fake ledger tools; title requests are answered by stage. */
async function harness(options: Options = {}) {
	const requests: { stage: Stage; prompt: string }[] = [];
	const turns = options.turns ?? [];
	const run = await fauxSession(
		[options.factory ?? registerSessionTitle, fakeLedger],
		(context) => {
			const stage = stageOf(context);
			if (!stage) return turns.shift() ?? fauxAssistantMessage("Done.");
			requests.push({ stage, prompt: context.messages[0]?.content as string });
			return options.title?.(stage) ?? fauxAssistantMessage(TITLES[stage]);
		},
		["ledger_add", "ledger_status"],
		{ cwd: options.cwd, sessionManager: options.sessionManager },
	);
	cleanup.push(run.dispose);
	const warnings: string[] = [];
	if (options.tui !== false) {
		await run.session.bindExtensions({
			mode: "tui",
			uiContext: {
				notify: (message: string, level?: string) => {
					if (level === "warning") warnings.push(message);
				},
			} as never,
		});
	}
	const name = () => run.session.sessionManager.getSessionName();
	const recorded = () =>
		run.session.sessionManager
			.getEntries()
			.flatMap((entry) =>
				entry.type === "custom" && entry.customType === SESSION_TITLE_ENTRY ? [entry.data as { title?: string }] : [],
			)
			.flatMap((data) => (data.title === undefined ? [] : [data.title]));
	return { ...run, requests, warnings, name, recorded, stages: () => requests.map((request) => request.stage) };
}

async function until(check: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200 && !check(); attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
	expect(check()).toBe(true);
}

/** Lets any title request the extension would start run to completion. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

function held(): { reply: Promise<Reply>; release: (reply: Reply) => void } {
	let release: (reply: Reply) => void = () => {};
	const reply = new Promise<Reply>((resolve) => (release = resolve));
	return { reply, release };
}

describe("session titles", () => {
	it("sets a provisional title when the first turn starts, then refines it after the turn", async () => {
		quickProfile();
		const turn = held();
		const run = await harness({ turns: [turn.reply] });
		const prompted = run.session.prompt("The CSV parser crashes on quoted commas.");
		await until(() => run.name() === "Parser crash");
		expect(run.requests[0]?.prompt).toContain("The CSV parser crashes on quoted commas.");

		turn.release(fauxAssistantMessage("Fixed the parser."));
		await prompted;
		await until(() => run.name() === "Fix CSV parser crash");
		const refined = run.requests.find((request) => request.stage === "refined")?.prompt;
		expect(refined).toContain("The CSV parser crashes on quoted commas.");
		expect(refined).toContain("Fixed the parser.");
		expect(run.recorded()).toEqual(["Parser crash", "Fix CSV parser crash"]);

		await run.session.prompt("Now add a test.");
		await settle();
		expect(run.stages()).toEqual(["provisional", "refined"]);
	});

	it("applies the provisional title before the refined one even when the first turn ends first", async () => {
		quickProfile();
		const provisional = held();
		const run = await harness({
			title: (stage) => (stage === "provisional" ? provisional.reply : fauxAssistantMessage(TITLES[stage])),
		});
		await run.session.prompt("The CSV parser crashes on quoted commas.");
		await settle();
		expect(run.name()).toBeUndefined();

		provisional.release(fauxAssistantMessage(TITLES.provisional));
		await until(() => run.name() === "Fix CSV parser crash");
		expect(run.recorded()).toEqual(["Parser crash", "Fix CSV parser crash"]);
	});

	it("retitles from the ledger task when the session adds one or starts one", async () => {
		quickProfile();
		const run = await harness({
			turns: [
				toolTurn("ledger_add", { title: "Retry flaky uploads", description: "d" }, "add-1"),
				fauxAssistantMessage("Added."),
				toolTurn("ledger_status", { task: "t2", status: "in-progress" }, "status-1"),
				fauxAssistantMessage("Started."),
			],
			title: (stage) => fauxAssistantMessage(stage === "ledger" ? "Upload retry work" : TITLES[stage]),
		});
		await run.session.prompt("Track the upload retries.");
		await until(() => run.name() === "Upload retry work");
		const ledger = run.requests.filter((request) => request.stage === "ledger");
		expect(ledger[0]?.prompt).toContain("Retry flaky uploads");
		expect(ledger[0]?.prompt).toContain("Track the upload retries.");
		// The ledger title is more specific; the first settled turn does not replace it.
		await settle();
		expect(run.stages()).not.toContain("refined");

		mkdirSync(join(run.cwd, ".ledger", "t2"), { recursive: true });
		writeFileSync(join(run.cwd, ".ledger", "t2", "task.md"), "Status: in-progress\n\n# Cache warm tracking\n");
		await run.session.prompt("Pick up the cache task.");
		await until(() => run.requests.filter((request) => request.stage === "ledger").length === 2);
		const started = run.requests.filter((request) => request.stage === "ledger")[1]?.prompt;
		expect(started).toContain("Cache warm tracking");
		expect(started).toContain("Pick up the cache task.");
	});

	it("stops all later stages once the operator names the session, including while a request is in flight", async () => {
		quickProfile();
		const before = await harness();
		before.session.setSessionName("Operator name");
		await before.session.prompt("Fix the parser.");
		await settle();
		expect(before.requests).toHaveLength(0);
		expect(before.name()).toBe("Operator name");

		const provisional = held();
		const turn = held();
		const during = await harness({
			turns: [turn.reply, toolTurn("ledger_add", { title: "T", description: "d" }, "add-1")],
			title: (stage) => (stage === "provisional" ? provisional.reply : fauxAssistantMessage(TITLES[stage])),
		});
		const prompted = during.session.prompt("Fix the parser.");
		await until(() => during.requests.length === 1);
		during.session.setSessionName("Operator name");
		provisional.release(fauxAssistantMessage("Model title"));
		await settle();
		turn.release(fauxAssistantMessage("Fixed."));
		await prompted;
		await during.session.prompt("Track it.");
		await settle();
		expect(during.stages()).toEqual(["provisional"]);
		expect(during.name()).toBe("Operator name");
		expect(during.recorded()).toEqual([]);

		// A rename stops for good, even when the operator later restores the auto title.
		const restored = await harness({
			turns: [fauxAssistantMessage("Fixed."), toolTurn("ledger_add", { title: "T", description: "d" }, "add-2")],
		});
		await restored.session.prompt("Fix the parser.");
		await until(() => restored.name() === "Fix CSV parser crash");
		restored.session.setSessionName("Operator name");
		restored.session.setSessionName("Fix CSV parser crash");
		await restored.session.prompt("Track it.");
		await settle();
		expect(restored.stages()).toEqual(["provisional", "refined"]);
		expect(restored.name()).toBe("Fix CSV parser crash");
	});

	it("after a resume, keeps titling its own name but never one the operator set", async () => {
		quickProfile();
		const cwd = mkdtempSync(join(tmpdir(), "apple-pi-session-title-cwd-"));
		cleanup.push(() => rmSync(cwd, { recursive: true, force: true }));
		const add = (id: string) => [toolTurn("ledger_add", { title: "Retry uploads", description: "d" }, id)];

		const own = await harness({ cwd, sessionManager: SessionManager.create(cwd, join(cwd, "sessions")) });
		await own.session.prompt("Fix the parser.");
		await until(() => own.name() === "Fix CSV parser crash");
		const ownFile = own.session.sessionManager.getSessionFile()!;
		own.dispose();
		const ownResumed = await harness({ cwd, sessionManager: SessionManager.open(ownFile), turns: add("add-1") });
		await ownResumed.session.prompt("Track the retries.");
		await until(() => ownResumed.name() === "Upload retry work");

		const renamed = await harness({ cwd, sessionManager: SessionManager.create(cwd, join(cwd, "sessions")) });
		await renamed.session.prompt("Fix the parser.");
		await until(() => renamed.name() === "Fix CSV parser crash");
		renamed.session.setSessionName("Operator name");
		const renamedFile = renamed.session.sessionManager.getSessionFile()!;
		renamed.dispose();
		const resumed = await harness({ cwd, sessionManager: SessionManager.open(renamedFile), turns: add("add-2") });
		await resumed.session.prompt("Track the retries.");
		await settle();
		expect(resumed.requests).toHaveLength(0);
		expect(resumed.name()).toBe("Operator name");
	});

	it("does not title a session whose first prompt has no text", async () => {
		quickProfile();
		const run = await harness();
		await run.session.prompt("", {
			images: [
				{
					type: "image",
					data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
					mimeType: "image/png",
				},
			],
		});
		await run.session.prompt("Now fix the parser.");
		await settle();
		expect(run.requests).toHaveLength(0);
		expect(run.name()).toBeUndefined();
	});

	it("does nothing in a child session or outside the TUI", async () => {
		quickProfile();
		const child = await harness({ factory: (pi) => runInChildSessionContext(() => registerSessionTitle(pi)) });
		await child.session.prompt("Fix the parser.");
		const print = await harness({ tui: false });
		await print.session.prompt("Fix the parser.");

		await settle();
		expect(child.requests).toHaveLength(0);
		expect(print.requests).toHaveLength(0);
		expect(child.name()).toBeUndefined();
		expect(print.name()).toBeUndefined();
	});

	it("warns once per failed stage, never retries it, and leaves the session unnamed", async () => {
		const run = await harness();
		await run.session.prompt("Fix the parser.");
		await until(() => run.warnings.length === 2);
		expect(run.warnings[0]).toContain("provisional");
		expect(run.warnings[1]).toContain("refined");
		expect(run.warnings[1]).toContain("model-profiles.json");

		await run.session.prompt("Now add a test.");
		await settle();
		expect(run.warnings).toHaveLength(2);
		expect(run.name()).toBeUndefined();
	});
});
