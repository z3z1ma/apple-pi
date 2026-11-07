import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { namesTaken } from "../../session-state/src/peers.js";
import { migrate } from "../../session-state/src/schema.js";
import type { Culture } from "../src/culture.js";
import registerSessionTitle, { SESSION_TITLE_ENTRY, sessionOrigin } from "../src/index.js";
import { CULTURES, pickIdentity } from "../src/names.js";

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
	mode?: "tui" | "rpc";
	cwd?: string;
	sessionManager?: SessionManager;
	beforeStart?: () => void;
}

async function harness(options: Options = {}) {
	const run = await fauxSession([registerSessionTitle], () => fauxAssistantMessage("Done."), [], {
		cwd: options.cwd,
		sessionManager: options.sessionManager,
	});
	cleanup.push(run.dispose);
	const warnings: string[] = [];
	options.beforeStart?.();
	if (options.tui !== false)
		await run.session.bindExtensions({
			mode: options.mode ?? "tui",
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

function parts(name: string | undefined, people?: string): Culture {
	for (const culture of CULTURES.filter((each) => people === undefined || each.people === people)) {
		const given = Object.values(culture.given).flat();
		for (const first of given) {
			if (!name?.startsWith(`${first} `)) continue;
			const family = name.slice(first.length + 1);
			const families =
				"fathers" in culture.family
					? culture.family.fathers.flatMap((father) =>
							Object.values((culture.family as { suffix: Record<string, string> }).suffix).map(
								(suffix) => `${father}${suffix}`,
							),
						)
					: culture.family;
			if (families.includes(family)) return culture;
		}
	}
	throw new Error(`not a name from one culture: ${name}`);
}

describe("session names", () => {
	it("draws first and family name from one of many real naming cultures, with distinct, disjoint lists", () => {
		expect(CULTURES.length).toBeGreaterThanOrEqual(40);
		expect(new Set(CULTURES.map((culture) => culture.people)).size).toBe(CULTURES.length);
		for (const culture of CULTURES) {
			const { she, he, they } = culture.given;
			expect(she.length, culture.people).toBeGreaterThanOrEqual(70);
			expect(he.length, culture.people).toBeGreaterThanOrEqual(70);
			const given = [...she, ...he, ...they];
			expect(new Set(given).size, culture.people).toBe(given.length);
			const family = "fathers" in culture.family ? culture.family.fathers : culture.family;
			expect(family.length, culture.people).toBeGreaterThanOrEqual(70);
			expect(new Set(family).size, culture.people).toBe(family.length);
			expect(culture.places.length, culture.people).toBeGreaterThanOrEqual(12);
			for (const text of [...given, ...family, ...culture.places]) expect(text, culture.people).toBe(text.trim());
		}
		for (let draw = 0; draw < 200; draw++) {
			const identity = pickIdentity({ names: [], firstNames: [] });
			const culture = parts(identity.name, identity.people);
			expect(culture.places).toContain(identity.place);
			expect(
				culture.given[identity.pronouns].some((given) => identity.name.startsWith(`${given} `)),
				identity.name,
			).toBe(true);
		}
	});

	it("avoids every taken full name and every first name in the organization, and gives way only on the first name", () => {
		const first = pickIdentity({ names: [], firstNames: [] }, () => 0);
		const again = pickIdentity({ names: [first.name], firstNames: [] }, () => 0);
		expect(again.name).toBe(first.name);
		const scripted = [0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5];
		const avoided = pickIdentity({ names: [first.name], firstNames: [] }, () => scripted.shift() ?? 0.5);
		expect(avoided.name).not.toBe(first.name);
		const firstName = first.name.split(" ")[0]!;
		const sameFirst = Array.from({ length: 40 }, () => 0);
		const relaxed = pickIdentity({ names: [], firstNames: [firstName] }, () => sameFirst.shift() ?? 0);
		expect(relaxed.name.split(" ")[0]).toBe(firstName);
		const varied = pickIdentity({ names: [], firstNames: [firstName] });
		expect(varied.name.split(" ")[0]).not.toBe(firstName);
	});

	it("treats every recorded name as taken, and the first names of the new person's current organization", () => {
		mkdirSync(join(agentDir, "state"), { recursive: true });
		const db = new DatabaseSync(join(agentDir, "state", "apple-pi.db"));
		try {
			migrate(db);
			for (const [id, name, reportsTo, retired] of [
				["boss", "Aoife Murphy", null, null],
				["ada", "Kenji Sato", "boss", null],
				["gone", "Lucía García", "boss", 1],
				["other", "Ama Mensah", null, null],
			] as const)
				db.prepare(
					`insert into sessions (id, kind, cwd, name, run_state, generation, source, updated_at, reports_to, retired_at)
					values (?, 'root', '/tmp', ?, 'idle', 1, 'bridge', 0, ?, ?)`,
				).run(id, name, reportsTo, retired);
		} finally {
			db.close();
		}
		const taken = namesTaken("new", "ada");
		expect(taken.names.sort()).toEqual(["Ama Mensah", "Aoife Murphy", "Kenji Sato", "Lucía García"]);
		expect(taken.firstNames.sort()).toEqual(["Aoife", "Kenji"]);
		expect(namesTaken("new", undefined).firstNames).toEqual([]);
	});

	it("names a new unnamed root TUI session as it starts, unlike any live session, without a model request", async () => {
		const taken = pickIdentity({ names: [], firstNames: [] }, () => 0).name;
		liveSessions([taken]);
		const scripted = [0, 0, 0, 0];
		const run = await harness({
			beforeStart: () => vi.spyOn(Math, "random").mockImplementation(() => scripted.shift() ?? 0.5),
		});
		vi.restoreAllMocks();
		const name = run.name();
		const [entry] = run.recorded() as { people: string }[];
		const culture = parts(name, entry?.people);
		expect(name).not.toBe(taken);
		expect(run.recorded()).toEqual([
			{
				title: name,
				stage: "name",
				people: culture.people,
				place: expect.any(String),
				pronouns: expect.stringMatching(/^(she|he|they)$/),
			},
		]);
		const origin = () => sessionOrigin({ sessionManager: run.session.sessionManager } as never);
		expect(origin()).toEqual({ people: culture.people, place: expect.any(String), pronouns: expect.any(String) });

		await run.session.prompt("The CSV parser crashes on quoted commas.");
		await settle();
		expect(run.requests).toHaveLength(1);
		expect(run.warnings).toEqual([]);
		expect(run.name()).toBe(name);
	});

	it("gives a headless RPC peer a human name and respects its operator rename", async () => {
		const run = await harness({ mode: "rpc" });
		parts(run.name());
		expect(run.recorded()).toEqual([expect.objectContaining({ title: run.name(), stage: "name" })]);
		run.session.setSessionName("Named colleague");
		await run.session.bindExtensions({ mode: "rpc" });
		expect(run.name()).toBe("Named colleague");
		expect(sessionOrigin({ sessionManager: run.session.sessionManager } as never)).toBeUndefined();
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
		await renamed.session.bindExtensions({});
		expect(renamed.name()).toBe("Operator name");
		const renamedFile = renamed.session.sessionManager.getSessionFile()!;
		renamed.dispose();
		const reopened = await harness({ cwd, sessionManager: SessionManager.open(renamedFile) });
		expect(reopened.name()).toBe("Operator name");

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

	it("does nothing in print mode", async () => {
		const print = await harness({ tui: false });
		await print.session.prompt("Fix the parser.");

		await settle();
		expect(print.requests).toHaveLength(1);
		expect(print.name()).toBeUndefined();
	});
});
