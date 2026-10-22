import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import bridge from "../../../components/session-state/src/index.js";
import {
	close,
	query,
	startRuntime,
	stopRuntime,
	tempStateDir,
} from "../../../components/session-state/tests/helpers.js";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { type Commands, openCommands } from "../src/backend/commands.js";
import { type Lifecycle, openLifecycle } from "../src/backend/lifecycle.js";
import { openWorldBackend, type WorldBackend } from "../src/backend/world-backend.js";
import type { CommandResult, FeedLine } from "../src/world.js";

// Seam 1 for renaming an agent (ticket 12): the backend API over a real session-state runtime, with a faux Pi session
// running the real bridge. Rename sends the runtime's `rename` command and resolves with its receipt; the new name is
// then the character's in the world snapshot (the figure, the side panel, and the conversation panel all read it).
const state = tempStateDir();
let world: WorldBackend;
let commands: Commands;
let lifecycle: Lifecycle;
const runs: Awaited<ReturnType<typeof fauxSession>>[] = [];
const lines: FeedLine[] = [];
beforeAll(async () => {
	await startRuntime(state.socketPath);
	world = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
	world.subscribeFeed((batch) => lines.push(...batch));
	commands = openCommands(state.socketPath);
	lifecycle = openLifecycle({ db: state.dbPath, agentDir: state.agentDir }, commands, () => world.snapshot());
});
afterAll(async () => {
	for (const run of runs) await close(run);
	world.close();
	commands.close();
	await stopRuntime(state);
});

const soon = (check: () => void, timeout = 8000) => vi.waitFor(check, { timeout });
const nameOf = (id: string) => world.snapshot().characters.find((c) => c.id === id)?.name;
const renames = (id: string) =>
	query<{ command: string }>(
		state.dbPath,
		"select command from commands where session_id = ? and kind = 'rename' order by rowid",
		id,
	).map((row) => JSON.parse(row.command) as { kind: string; name: string });

async function awake() {
	const run = await fauxSession([bridge], () => fauxAssistantMessage("noted"), []);
	runs.push(run);
	const id = run.session.sessionManager.getSessionId();
	await soon(() => expect(nameOf(id)).toBeDefined(), 15000);
	return { run, id };
}

test("Rename on an awake agent sends rename with the new name, resolves with its receipt, and the world shows the new name", async () => {
	const { run, id } = await awake();
	const receipt = await lifecycle.rename(id, "  Ada   the  builder ");
	expect(receipt).toEqual({ ok: true, stage: "applied" });
	// One line: the name is also the tmux window's.
	expect(renames(id)).toEqual([{ kind: "rename", name: "Ada the builder" }]);
	expect(run.session.sessionManager.getSessionName()).toBe("Ada the builder");
	await soon(() => expect(nameOf(id)).toBe("Ada the builder"));
	// The chatbox line, from the runtime's own record of the command.
	await soon(() => expect(lines.map((line) => line.text)).toContain("Rename for Ada the builder: Ada the builder"));
}, 40000);

test("retirement waits for its handover rather than returning accepted when the ordinary close wait expires", async () => {
	const { id } = await awake();
	let release = (_value: CommandResult) => {};
	const handover = new Promise<CommandResult>((resolve) => {
		release = resolve;
	});
	const controlled: Commands = {
		...commands,
		send: vi.fn<Commands["send"]>((_id, _command, options) => {
			options?.onReceipt?.("accepted", undefined);
			return handover;
		}),
	};
	const people = openLifecycle({ db: state.dbPath, agentDir: state.agentDir }, controlled, () => world.snapshot());
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	try {
		let settled = false;
		const pending = people.retire(id, "The work ended.").then((receipt) => {
			settled = true;
			return receipt;
		});
		await vi.advanceTimersByTimeAsync(10_001);
		expect(settled).toBe(false);
		expect(vi.mocked(controlled.send).mock.calls[0]?.slice(0, 2)).toEqual([
			id,
			{ kind: "retire", reason: "The work ended." },
		]);
		release({ ok: true });
		expect(await pending).toEqual({ ok: true, stage: "applied" });
	} finally {
		release({ ok: false, reason: "Test finished" });
		vi.useRealTimers();
	}
});

test("Renaming to a blank name, or a character that is not awake, is refused and sends nothing", async () => {
	const { id } = await awake();
	const before = nameOf(id);
	expect(await lifecycle.rename(id, "  \n ")).toEqual({ ok: false, reason: "Give it a name." });
	expect(await lifecycle.rename("nobody", "Ada")).toEqual({ ok: false, reason: "That session is not running." });
	expect(await lifecycle.rename(id, "x".repeat(61))).toEqual({
		ok: false,
		reason: "That name is too long: keep it to 60 characters.",
	});
	expect(renames(id)).toEqual([]);
	expect(renames("nobody")).toEqual([]);
	expect(nameOf(id)).toBe(before);
}, 40000);
