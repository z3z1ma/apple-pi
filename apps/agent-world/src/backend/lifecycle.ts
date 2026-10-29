// What the operator does to a session from the inn, the rookery, and a character's actions: wake a dormant one
// (`start`), end an awake one (`close`, confirmed only while it is busy, decision 13), mail anyone as himself
// (threaded mail, owned by mail.ts), hire a new person (`start` for a new id, with a role from the catalog), rename an awake one (`rename`),
// and request permanent departure (`retire`: accepted handoff and cleanup continue in the runtime). Commands go through the
// command client (`commands.ts`); each resolves with the receipt stage that answers the operator's question (is it
// awake, is it ended, did the letter arrive or does it wait), not necessarily the last.
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Command } from "../../../../components/session-state/src/protocol.js";
import {
	type CommandReceipt,
	NAME_MAX,
	type ReceiptStage,
	type RecruitReceipt,
	type RecruitRequest,
	type RoleChoice,
	type WorldSnapshot,
} from "../world.js";
import type { Commands } from "./commands.js";
import { operatorPane } from "./inn.js";
import { type Mailbox, openMailbox } from "./mail.js";
import { loadRoleChoices } from "./roles.js";

/** A woken session joins once Pi has started in its window; a slow start still says the window opened. */
const WAKE_MS = 30_000;
const CLOSE_MS = 10_000;
/** A rename is applied as soon as the bridge has it. */
const RENAME_MS = 8000;

export interface Lifecycle extends Mailbox {
	wake(characterId: string): Promise<CommandReceipt>;
	endSession(characterId: string, confirmed?: boolean): Promise<CommandReceipt>;
	recruit(request: RecruitRequest): Promise<RecruitReceipt>;
	rename(characterId: string, name: string): Promise<CommandReceipt>;
	roles(): RoleChoice[];
	retire(characterId: string, reason: string): Promise<CommandReceipt>;
}

/** A directory as the operator typed it: `~` is his home. */
const expandHome = (path: string) =>
	path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;

const isDirectory = (path: string) => {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
};

/** Send `command` and resolve at the first stage `enough` accepts, or with the last stage reached after `ms`. */
function follow(
	commands: Commands,
	sessionId: string,
	command: Command,
	ms: number,
	enough: (stage: ReceiptStage, reason: string | undefined) => boolean,
	late: (stage: ReceiptStage) => string,
): Promise<CommandReceipt> {
	return new Promise((resolve) => {
		let last: { stage: ReceiptStage; reason?: string } | undefined;
		let done = false;
		const settle = (receipt: CommandReceipt) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			resolve(receipt);
		};
		const timer = setTimeout(() => {
			if (!last || last.stage === "failed") return; // the send itself settles these
			settle({ ok: true, stage: last.stage, note: late(last.stage) });
		}, ms);
		void commands
			.send(sessionId, command, {
				onReceipt(stage, reason) {
					last = { stage, reason };
					if (stage !== "failed" && enough(stage, reason))
						settle({ ok: true, stage, ...(reason ? { note: reason } : {}) });
				},
			})
			.then((result) => settle(result.ok ? { ok: true, stage: "applied" } : { ok: false, reason: result.reason }));
	});
}

export function openLifecycle(
	paths: { db: string; agentDir: string },
	commands: Commands,
	snapshot: () => WorldSnapshot,
): Lifecycle {
	return {
		async wake(characterId) {
			const world = snapshot();
			const sleeper = world.dormant?.find((agent) => agent.id === characterId);
			if (!sleeper) {
				const awake = world.characters.find((character) => character.id === characterId);
				return { ok: false, reason: awake ? `${awake.name} is already awake.` : "No stopped session has that id." };
			}
			if (sleeper.retiredAt != null) return { ok: false, reason: "Former members cannot be reopened." };
			const pane = await operatorPane(paths.db);
			if (!pane)
				return {
					ok: false,
					reason: `No terminal is attached to tmux, so there is nowhere to open ${sleeper.name}'s window.`,
				};
			const command: Command = {
				kind: "start",
				tmux: pane,
				// Pi gets its coordinator only from the command line, so a worker wakes still reporting to it.
				...(sleeper.reportsTo ? { reportsTo: sleeper.reportsTo } : {}),
			};
			return follow(
				commands,
				characterId,
				command,
				WAKE_MS,
				(stage) => stage === "applied",
				() => `Its window opened, but ${sleeper.name} has not joined yet.`,
			);
		},

		async endSession(characterId, confirmed = false) {
			const character = snapshot().characters.find((c) => c.id === characterId);
			if (!character) return { ok: false, reason: "That session is not running." };
			const busy = character.facts !== undefined && character.facts.run !== "idle";
			if (busy && !confirmed)
				return {
					ok: false,
					confirm: true,
					reason: `${character.name} is in the middle of a turn. Ending its session stops that turn.`,
				};
			return follow(
				commands,
				characterId,
				{ kind: "close" },
				CLOSE_MS,
				(stage) => stage === "applied",
				() => `${character.name} has not answered yet.`,
			);
		},

		async recruit(request) {
			// One line: it is also the tmux window's name.
			const name = request.name.replace(/\s+/g, " ").trim();
			const cwd = expandHome(request.cwd.trim());
			const brief = request.brief.trim();
			const role = request.role?.trim();
			if (!name && !role) return { ok: false, reason: "Give the new agent a name." };
			if (!cwd) return { ok: false, reason: "Choose the directory it works in." };
			if (!isAbsolute(cwd)) return { ok: false, reason: `${cwd} is not a full path to a directory.` };
			if (!isDirectory(cwd)) return { ok: false, reason: `${cwd} is not a directory.` };
			if (role && !brief) return { ok: false, reason: "A role hire needs a written goal." };
			if (role && !loadRoleChoices(paths.agentDir).some((choice) => choice.name === role))
				return { ok: false, reason: `No role in the catalog is named ${role}.` };
			let pane: { socket: string; pane: string } | undefined;
			if (request.reportsTo) {
				// A new person's window opens beside its manager's, where the manager's own new sessions open.
				const coordinator = snapshot().characters.find((character) => character.id === request.reportsTo);
				if (!coordinator) return { ok: false, reason: "That manager is not running." };
				const db = new DatabaseSync(paths.db);
				try {
					db.exec("pragma query_only = 1");
					const manager = db
						.prepare(`select role, manages, reports_to, retired_at from sessions where id = ? and kind = 'root'
						and not exists (select 1 from program_peers p where p.session_id = sessions.id)
						and not exists (select 1 from events e where e.session_id = sessions.id and e.type in ('program_peer_created', 'program_peer_observed', 'person_discarded'))`)
						.get(request.reportsTo) as
						| { role: string | null; manages: number | null; reports_to: string | null; retired_at: number | null }
						| undefined;
					if (
						!manager ||
						manager.retired_at !== null ||
						(manager.manages !== 1 && !(manager.role === null && manager.reports_to === null))
					)
						return { ok: false, reason: "That person cannot manage new reports." };
				} finally {
					db.close();
				}
				const tmux = coordinator.facts?.tmux;
				if (!tmux)
					return {
						ok: false,
						reason: `${coordinator.name} is not running in tmux, so there is nowhere to open ${name || "the new person"}'s window beside it.`,
					};
				pane = { socket: tmux.socket, pane: tmux.pane };
			} else {
				pane = await operatorPane(paths.db);
				if (!pane)
					return {
						ok: false,
						reason: `No terminal is attached to tmux, so there is nowhere to open ${name || "the new person"}'s window.`,
					};
			}
			const sessionId = randomUUID();
			const command: Command = {
				kind: "start",
				tmux: pane,
				cwd,
				...(name ? { name } : {}),
				...(request.reportsTo ? { reportsTo: request.reportsTo } : {}),
				...(role ? { role } : {}),
				...(brief ? { goal: { text: brief, by: "operator" } } : {}),
			};
			const receipt = await follow(
				commands,
				sessionId,
				command,
				WAKE_MS,
				(stage) => stage === "applied",
				() => `Its window opened, but ${name || "the new person"} has not joined yet.`,
			);
			return { ...receipt, sessionId };
		},

		async rename(characterId, given) {
			// One line, as the recruit form names a new agent.
			const name = given.replace(/\s+/g, " ").trim();
			if (!name) return { ok: false, reason: "Give it a name." };
			if (name.length > NAME_MAX)
				return { ok: false, reason: `That name is too long: keep it to ${NAME_MAX} characters.` };
			if (!snapshot().characters.some((character) => character.id === characterId))
				return { ok: false, reason: "That session is not running." };
			return follow(
				commands,
				characterId,
				{ kind: "rename", name },
				RENAME_MS,
				(stage) => stage === "applied",
				() => "Sent; it has not taken the name yet.",
			);
		},

		roles: () => loadRoleChoices(paths.agentDir),

		async retire(characterId, given) {
			const reason = given.trim();
			if (!reason) return { ok: false, reason: "Say why it leaves." };
			const world = snapshot();
			const person =
				world.characters.find((character) => character.id === characterId) ??
				world.dormant?.find((agent) => agent.id === characterId);
			if (!person) return { ok: false, reason: "No session has that id." };
			const receipt = await follow(
				commands,
				characterId,
				{ kind: "retire", reason, by: "operator" },
				CLOSE_MS,
				(stage) => stage === "accepted",
				() => "The departure request is accepted; handoff and cleanup continue in the runtime.",
			);
			return receipt.ok
				? { ...receipt, note: "Departure accepted; the runtime will report handoff and cleanup progress." }
				: receipt;
		},

		...openMailbox(paths.db, commands),
	};
}
