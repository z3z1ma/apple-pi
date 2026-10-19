import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { type ExtensionAPI, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import { migrate } from "../../session-state/src/schema.js";
import { SESSION_INTENT_CHANNEL, type SessionIntent } from "../../shared/src/session-intent-events.js";
import { runInChildSessionContext } from "../../subagents/src/child-context.js";
import registerSessionTitle, { SESSION_TITLE_ENTRY } from "../src/index.js";
import { FAMILY_NAMES, FIRST_NAMES, pickName } from "../src/names.js";

const cleanup: (() => void)[] = [];
let agentDir: string;
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;

beforeEach(() => {
	agentDir = mkdtempSync(join(tmpdir(), "apple-pi-session-title-"));
	process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
	vi.restoreAllMocks();
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

/** Live root sessions in the state database, as the runtime records them. */
function liveSessions(names: string[]): void {
	mkdirSync(join(agentDir, "state"), { recursive: true });
	const db = new DatabaseSync(join(agentDir, "state", "apple-pi.db"));
	try {
		migrate(db);
		names.forEach((name, index) => {
			db.prepare(
				`insert into sessions (id, kind, cwd, name, run_state, generation, source, updated_at)
				values (?, 'root', '/tmp', ?, 'idle', 1, 'bridge', 0)`,
			).run(`live-${index}`, name);
			db.prepare(
				`insert into incarnations (session_id, generation, pid, process_started_at, process_state, started_at, source, updated_at)
				values (?, 1, 1, 0, 'alive', 0, 'bridge', 0)`,
			).run(`live-${index}`);
		});
	} finally {
		db.close();
	}
}

/** True for a request that asks for the session's intent; every other request is a session turn. */
const isIntent = (context: Context) => {
	const first = context.messages[0];
	return typeof first?.content === "string" && first.content.includes("is working on now");
};

interface Options {
	tui?: boolean;
	factory?: (pi: ExtensionAPI) => void;
	/** Session turns in order; "Done." once exhausted. */
	turns?: Reply[];
	/** Answers to intent requests in order; "Fixing the parser" once exhausted. */
	intents?: (Reply | Promise<Reply>)[];
	cwd?: string;
	sessionManager?: SessionManager;
	/** Runs just before the session is bound to the TUI, which starts it. */
	beforeStart?: () => void;
}

/** A real session with the extension; intent requests are answered from `intents`. */
async function harness(options: Options = {}) {
	const requests: string[] = [];
	const turnRequests: Context[] = [];
	const turns = options.turns ?? [];
	const intents = options.intents ?? [];
	const announced: SessionIntent[] = [];
	const listen = (pi: ExtensionAPI) =>
		pi.events.on(SESSION_INTENT_CHANNEL, (data) => announced.push(data as SessionIntent));
	const run = await fauxSession(
		[options.factory ?? registerSessionTitle, listen],
		(context) => {
			if (!isIntent(context)) {
				turnRequests.push(context);
				return turns.shift() ?? fauxAssistantMessage("Done.");
			}
			requests.push(context.messages[0]?.content as string);
			return intents.shift() ?? fauxAssistantMessage("Fixing the parser");
		},
		[],
		{ cwd: options.cwd, sessionManager: options.sessionManager },
	);
	cleanup.push(run.dispose);
	const warnings: string[] = [];
	options.beforeStart?.();
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
			.flatMap((entry) => (entry.type === "custom" && entry.customType === SESSION_TITLE_ENTRY ? [entry.data] : []));
	return { ...run, requests, turnRequests, announced, warnings, name, recorded };
}

async function until(check: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200 && !check(); attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
	expect(check()).toBe(true);
}

/** Lets any request the extension would start run to completion. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

function parts(name: string | undefined): [string, string] {
	for (const first of FIRST_NAMES) {
		if (!name?.startsWith(`${first} `)) continue;
		const family = name.slice(first.length + 1);
		if (FAMILY_NAMES.includes(family)) return [first, family];
	}
	throw new Error(`not a listed name: ${name}`);
}

describe("session names", () => {
	it("draws several hundred distinct first and family names and avoids every taken name", () => {
		expect(FIRST_NAMES.length).toBeGreaterThanOrEqual(250);
		expect(FAMILY_NAMES.length).toBeGreaterThanOrEqual(250);
		expect(new Set(FIRST_NAMES).size).toBe(FIRST_NAMES.length);
		expect(new Set(FAMILY_NAMES).size).toBe(FAMILY_NAMES.length);
		const scripted = [0, 0, 0, 0, 0.5, 0.5];
		const name = pickName(["ada ashdown", `${FIRST_NAMES[0]} ${FAMILY_NAMES[0]}`], () => scripted.shift() ?? 0.9);
		expect(name).toBe(
			`${FIRST_NAMES[Math.floor(0.5 * FIRST_NAMES.length)]} ${FAMILY_NAMES[Math.floor(0.5 * FAMILY_NAMES.length)]}`,
		);
	});

	it("names a new unnamed root TUI session as it starts, unlike any live session, without a model request", async () => {
		quickProfile();
		const taken = `${FIRST_NAMES[0]} ${FAMILY_NAMES[0]}`;
		liveSessions([taken]);
		const scripted = [0, 0];
		const run = await harness({
			beforeStart: () => vi.spyOn(Math, "random").mockImplementation(() => scripted.shift() ?? 0.5),
		});
		vi.restoreAllMocks();
		const name = run.name();
		parts(name);
		expect(name).not.toBe(taken);
		expect(run.recorded()).toEqual([{ title: name, stage: "name" }]);

		await run.session.prompt("The CSV parser crashes on quoted commas.");
		await settle();
		// The only quick request is the intent; the name stays.
		expect(run.requests.every((prompt) => prompt.includes("is working on now"))).toBe(true);
		expect(run.name()).toBe(name);
	});

	it("keeps the name across a resume and never replaces one set by /name", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "apple-pi-session-title-cwd-"));
		cleanup.push(() => rmSync(cwd, { recursive: true, force: true }));

		const own = await harness({ cwd, sessionManager: SessionManager.create(cwd, join(cwd, "sessions")) });
		const name = own.name();
		parts(name);
		await own.session.prompt("Fix the parser.");
		const ownFile = own.session.sessionManager.getSessionFile()!;
		own.dispose();
		const resumed = await harness({ cwd, sessionManager: SessionManager.open(ownFile) });
		expect(resumed.name()).toBe(name);
		expect(resumed.recorded()).toHaveLength(1);

		const renamed = await harness({ cwd, sessionManager: SessionManager.create(cwd, join(cwd, "sessions")) });
		renamed.session.setSessionName("Operator name");
		await renamed.session.prompt("Fix the parser.");
		await renamed.session.bindExtensions({}); // a reload starts the session again
		expect(renamed.name()).toBe("Operator name");
		const renamedFile = renamed.session.sessionManager.getSessionFile()!;
		renamed.dispose();
		const reopened = await harness({ cwd, sessionManager: SessionManager.open(renamedFile) });
		expect(reopened.name()).toBe("Operator name");

		// A session started with a name (`pi --name`) keeps it.
		const manager = SessionManager.inMemory(cwd);
		manager.appendSessionInfo("Given name");
		const given = await harness({ cwd, sessionManager: manager });
		expect(given.name()).toBe("Given name");
		expect(given.recorded()).toEqual([{ stopped: true }]);
	});

	it("gives a session that still has an old topic title a human name on its next start", async () => {
		const manager = SessionManager.inMemory();
		manager.appendSessionInfo("Fix CSV parser crash");
		manager.appendCustomEntry(SESSION_TITLE_ENTRY, { title: "Fix CSV parser crash", stage: "refined" });
		const run = await harness({ sessionManager: manager });
		parts(run.name());
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
});

describe("session intent", () => {
	it("after each settled user turn, announces the quick model's sentence and keeps it when the work has not changed", async () => {
		quickProfile();
		const run = await harness({
			turns: [fauxAssistantMessage("Found the quoting bug."), fauxAssistantMessage("Added a test.")],
			intents: [
				fauxAssistantMessage('"Fixing the CSV parser crash on quoted commas."'),
				fauxAssistantMessage("KEEP"),
				fauxAssistantMessage("Writing the upload retry docs"),
			],
		});
		const id = run.session.sessionManager.getSessionId();
		await run.session.prompt("The CSV parser crashes on quoted commas.");
		await until(() => run.announced.length === 1);
		expect(run.announced).toEqual([{ sessionId: id, intent: "Fixing the CSV parser crash on quoted commas" }]);
		expect(run.requests[0]).toContain("The CSV parser crashes on quoted commas.");
		expect(run.requests[0]).toContain("Found the quoting bug.");

		await run.session.prompt("Add a test for it.");
		await until(() => run.requests.length === 2);
		await settle();
		// The model sees the previous sentence, so it can say the work is unchanged.
		expect(run.requests[1]).toContain("Fixing the CSV parser crash on quoted commas");
		expect(run.announced).toHaveLength(1);

		await run.session.prompt("Now document the upload retries.");
		await until(() => run.announced.length === 2);
		expect(run.announced[1]?.intent).toBe("Writing the upload retry docs");
		// No intent request ever reaches the session's own conversation.
		expect(run.turnRequests).toHaveLength(3);
		expect(run.warnings).toEqual([]);
	});

	it("warns once when the quick model fails, and announces nothing", async () => {
		const run = await harness();
		await run.session.prompt("Fix the parser.");
		await until(() => run.warnings.length === 1);
		expect(run.warnings[0]).toContain("model-profiles.json");
		await run.session.prompt("Now add a test.");
		await settle();
		expect(run.warnings).toHaveLength(1);
		expect(run.announced).toEqual([]);
		parts(run.name());
	});
});
