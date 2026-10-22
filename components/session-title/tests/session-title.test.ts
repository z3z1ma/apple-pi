import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { type ExtensionAPI, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { migrate } from "../../session-state/src/schema.js";
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

interface Options {
	tui?: boolean;
	factory?: (pi: ExtensionAPI) => void;
	cwd?: string;
	sessionManager?: SessionManager;
	beforeStart?: () => void;
}

async function harness(options: Options = {}) {
	const run = await fauxSession([options.factory ?? registerSessionTitle], () => fauxAssistantMessage("Done."), [], {
		cwd: options.cwd,
		sessionManager: options.sessionManager,
	});
	cleanup.push(run.dispose);
	const warnings: string[] = [];
	options.beforeStart?.();
	if (options.tui !== false)
		await run.session.bindExtensions({
			mode: "tui",
			uiContext: {
				notify: (message: string, level?: string) => {
					if (level === "warning") warnings.push(message);
				},
			} as never,
		});
	const name = () => run.session.sessionManager.getSessionName();
	const recorded = () =>
		run.session.sessionManager
			.getEntries()
			.flatMap((entry) => (entry.type === "custom" && entry.customType === SESSION_TITLE_ENTRY ? [entry.data] : []));
	return { ...run, warnings, name, recorded };
}

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
		// Only the operator's turn calls the model; neither the name nor the work is guessed.
		expect(run.requests).toHaveLength(1);
		expect(run.warnings).toEqual([]);
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
		const child = await harness({ factory: (pi) => runInChildSessionContext(() => registerSessionTitle(pi)) });
		await child.session.prompt("Fix the parser.");
		const print = await harness({ tui: false });
		await print.session.prompt("Fix the parser.");

		await settle();
		expect(child.requests).toHaveLength(1);
		expect(print.requests).toHaveLength(1);
		expect(child.name()).toBeUndefined();
		expect(print.name()).toBeUndefined();
	});
});
