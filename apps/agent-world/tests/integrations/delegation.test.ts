import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import bridge from "../../../../components/session-state/src/index.js";
import {
	close,
	query,
	startRuntime,
	stopRuntime,
	tempStateDir,
} from "../../../../components/session-state/tests/helpers.js";
import { fauxSession, type Reply } from "../../../../tests/helpers/faux-session.js";
import { type Commands, openCommands } from "../../src/backend/commands.js";
import { delegationTarget, delegationText } from "../../src/backend/integrations/delegation.js";
import { openIntegrations } from "../../src/backend/integrations/index.js";
import { openWorldBackend, type WorldBackend } from "../../src/backend/world-backend.js";
import type { Receipt, WorldSnapshot } from "../../src/world.js";
import { type FakeServer, fakeGh, fakeServer } from "./fakes.js";

// Seam 1 for delegation: the backend API over a real session-state runtime with faux Pi sessions; GitHub, Jira, and
// Slack are fakes that must see nothing.
const state = tempStateDir();
const cwd = mkdtempSync(join(tmpdir(), "aw-delegate-"));
writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
const sessionDir = mkdtempSync(join(tmpdir(), "aw-delegate-sessions-"));
const integrationsDir = mkdtempSync(join(tmpdir(), "aw-delegate-state-"));
const gh = fakeGh();
let outside: FakeServer;
let world: WorldBackend;
let commands: Commands;
let api: ReturnType<typeof openIntegrations>;

beforeAll(async () => {
	await startRuntime(state.socketPath);
	world = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
	commands = openCommands(state.socketPath);
	outside = await fakeServer();
	api = openIntegrations({
		stateDir: integrationsDir,
		snapshot: () => world.snapshot(),
		commands,
		env: gh.env,
		slackApi: `${outside.url}/api/`,
	});
});
afterAll(async () => {
	api.close();
	world.close();
	commands.close();
	await outside.close();
	await stopRuntime(state);
	for (const dir of [cwd, sessionDir, integrationsDir, gh.dir]) rmSync(dir, { recursive: true, force: true });
});

const character = (id: string) => world.snapshot().characters.find((c) => c.id === id);
const PR = {
	kind: "pull-request",
	repo: "acme/app",
	number: 12,
	title: "Add the forge",
	url: "https://github.com/acme/app/pull/12",
} as const;

async function awake(replyTo: Parameters<typeof fauxSession>[1]) {
	const run = await fauxSession([bridge], replyTo, [], { cwd, sessionManager: SessionManager.create(cwd, sessionDir) });
	const id = run.session.sessionManager.getSessionId();
	await vi.waitFor(() => expect(character(id)).toBeDefined(), { timeout: 15000 });
	return { run, id };
}

const sentCommands = (id: string) =>
	query<{ kind: string; command: string }>(
		state.dbPath,
		"select kind, command from commands where session_id = ? order by rowid",
		id,
	).map((row) => ({ kind: row.kind, text: (JSON.parse(row.command) as { text?: string }).text }));

test("the instruction names the item and what is asked", () => {
	expect(delegationText({ to: "x", item: PR, ask: "address-review" })).toBe(
		'Please address the review on pull request acme/app#12 "Add the forge": https://github.com/acme/app/pull/12',
	);
	expect(
		delegationText({
			to: "coordinator",
			item: { kind: "issue", key: "APP-1", summary: "Build the forge", url: "https://acme.atlassian.net/browse/APP-1" },
			ask: "start-work",
			note: "Start with the CI rollup.",
		}),
	).toBe(
		'Please start work on Jira issue APP-1 "Build the forge": https://acme.atlassian.net/browse/APP-1\n\nStart with the CI rollup.',
	);
	expect(
		delegationText({
			to: "x",
			item: {
				kind: "thread",
				channel: "C9",
				channelName: "releases",
				ts: "1.2",
				url: "https://acme.slack.com/archives/C9/p12",
				preview: "Shipped",
			},
			ask: "look-into",
		}),
	).toBe(
		'Please look into this Slack thread in #releases ("Shipped"): https://acme.slack.com/archives/C9/p12\nReport back to me here; do not post in Slack.',
	);
});

test("`coordinator` is the coordinator the agent reports to, else the first awake one; none awake is refused", () => {
	const snapshot = {
		connected: true,
		headquarters: [
			{ id: "hq1", name: "One", wings: [] },
			{ id: "hq2", name: "Two", wings: [] },
		],
		characters: [
			{
				id: "hq1",
				name: "One",
				role: "coordinator",
				place: { kind: "headquarters", headquarters: "hq1" },
				startedAt: 1,
			},
			{
				id: "hq2",
				name: "Two",
				role: "coordinator",
				place: { kind: "headquarters", headquarters: "hq2" },
				startedAt: 2,
			},
			{
				id: "w",
				name: "W",
				role: "worker",
				place: { kind: "common-room", headquarters: "hq2" },
				startedAt: 3,
				facts: { reportsTo: "hq2" },
			},
		],
	} as WorldSnapshot;
	expect(delegationTarget(snapshot, "coordinator")?.id).toBe("hq1");
	expect(delegationTarget(snapshot, "coordinator", "w")?.id).toBe("hq2");
	expect(delegationTarget(snapshot, "w")?.id).toBe("w");
	expect(delegationTarget({ ...snapshot, characters: [] }, "coordinator")).toBeUndefined();
});

test("asking an idle builder sends talk naming the pull request, and writes nothing outside", async () => {
	const { run, id } = await awake([fauxAssistantMessage("On it.")]);
	try {
		const receipts: Receipt[] = [];
		const result = await api.delegate("aw-delegate-1", { to: id, item: PR, ask: "address-review" }, (receipt) =>
			receipts.push(receipt),
		);
		expect(result).toEqual({ ok: true, to: id, command: "talk" });
		expect(sentCommands(id)).toEqual([
			{
				kind: "talk",
				text: 'Please address the review on pull request acme/app#12 "Add the forge": https://github.com/acme/app/pull/12',
			},
		]);
		expect(receipts.map((receipt) => [receipt.commandId, receipt.characterId, receipt.stage])).toEqual([
			["aw-delegate-1", id, "accepted"],
			["aw-delegate-1", id, "delivered"],
			["aw-delegate-1", id, "applied"],
		]);
		expect(gh.calls()).toEqual([]);
		expect(outside.seen).toEqual([]);
		expect(await api.outsideWrites()).toEqual([]);
	} finally {
		await close(run);
	}
}, 40000);

test("asking a busy agent sends follow_up, so its turn is not interrupted", async () => {
	const holds: ((reply: Reply) => void)[] = [];
	const { run, id } = await awake((_context, signal) =>
		signal?.aborted ? fauxAssistantMessage("") : new Promise<Reply>((resolve) => holds.push(resolve)),
	);
	try {
		const turn = run.session.prompt("work");
		await vi.waitFor(() => expect(character(id)?.facts?.run).not.toBe("idle"), { timeout: 5000 });
		const thread = {
			kind: "thread",
			channel: "C9",
			channelName: "releases",
			ts: "1700000002.000000",
			url: "https://acme.slack.com/archives/C9/p1700000002000000",
		} as const;
		const result = await api.delegate("aw-delegate-2", { to: id, item: thread, ask: "look-into" });
		expect(result).toEqual({ ok: true, to: id, command: "follow_up" });
		expect(sentCommands(id).map((command) => command.kind)).toEqual(["follow_up"]);
		expect(outside.seen).toEqual([]);
		// The follow-up would start another held request; end the run here.
		await run.session.abort();
		await turn.catch(() => {});
	} finally {
		await close(run);
	}
}, 40000);

test("with no coordinator awake, asking the coordinator is refused and sends nothing", async () => {
	const receipts: Receipt[] = [];
	const result = await api.delegate("aw-delegate-3", { to: "coordinator", item: PR, ask: "get-reviewed" }, (receipt) =>
		receipts.push(receipt),
	);
	expect(result).toMatchObject({ ok: false, reason: "No coordinator is awake." });
	expect(receipts).toEqual([]);
	expect(gh.calls()).toEqual([]);
});
