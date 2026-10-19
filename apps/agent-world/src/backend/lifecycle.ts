// What the operator does to a session from the inn, the rookery, and a character's actions: wake a dormant one
// (`start`), end an awake one (`close`, confirmed only while it is busy, decision 13), mail anyone as himself
// (`mail`), recruit a new agent (`start` for a new id, ticket 10), and rename an awake one (`rename`, ticket 12). Commands go through the command client (`commands.ts`); each resolves with the receipt stage that answers
// the operator's question (is it awake, is it ended, did the letter arrive or does it wait), not necessarily the last.
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Command } from "../../../../components/session-state/src/protocol.js";
import {
	type CommandReceipt,
	NAME_MAX,
	OPERATOR,
	type ReceiptStage,
	type RecruitReceipt,
	type RecruitRequest,
	type WorldSnapshot,
} from "../world.js";
import type { Commands } from "./commands.js";
import { operatorPane } from "./inn.js";

/** A woken session joins once Pi has started in its window; a slow start still says the window opened. */
const WAKE_MS = 30_000;
/** Mail to an awake session is delivered once its transcript records it, usually within a second or two. */
const MAIL_MS = 8000;
const CLOSE_MS = 10_000;
/** A rename is applied as soon as the bridge has it. */
const RENAME_MS = 8000;

export interface Lifecycle {
	wake(characterId: string): Promise<CommandReceipt>;
	endSession(characterId: string, confirmed?: boolean): Promise<CommandReceipt>;
	sendMail(characterId: string, body: string): Promise<CommandReceipt>;
	recruit(request: RecruitRequest): Promise<RecruitReceipt>;
	rename(characterId: string, name: string): Promise<CommandReceipt>;
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

export function openLifecycle(paths: { db: string }, commands: Commands, snapshot: () => WorldSnapshot): Lifecycle {
	/** The tmux servers the runtime knows, read from its database. */
	const servers = (): string[] => {
		if (!existsSync(paths.db)) return [];
		const db = new DatabaseSync(paths.db);
		try {
			db.exec("pragma query_only = 1");
			return (db.prepare("select socket from tmux_servers order by updated_at desc").all() as { socket: string }[]).map(
				(row) => row.socket,
			);
		} catch {
			return [];
		} finally {
			db.close();
		}
	};

	return {
		async wake(characterId) {
			const world = snapshot();
			const sleeper = world.dormant?.find((agent) => agent.id === characterId);
			if (!sleeper) {
				const awake = world.characters.find((character) => character.id === characterId);
				return { ok: false, reason: awake ? `${awake.name} is already awake.` : "No stopped session has that id." };
			}
			const pane = await operatorPane(servers());
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
			if (!name) return { ok: false, reason: "Give the new agent a name." };
			if (!cwd) return { ok: false, reason: "Choose the directory it works in." };
			if (!isAbsolute(cwd)) return { ok: false, reason: `${cwd} is not a full path to a directory.` };
			if (!isDirectory(cwd)) return { ok: false, reason: `${cwd} is not a directory.` };
			// The runtime puts the brief on Pi's command line as its first prompt, where a leading dash reads as an option.
			if (brief.startsWith("-"))
				return { ok: false, reason: "The brief cannot start with a dash: Pi would read it as an option." };
			let pane: { socket: string; pane: string } | undefined;
			if (request.reportsTo) {
				// A worker's window opens beside its coordinator's, where the coordinator's own new sessions open.
				const coordinator = snapshot().characters.find(
					(character) => character.id === request.reportsTo && character.role === "coordinator",
				);
				if (!coordinator) return { ok: false, reason: "That coordinator is not running." };
				const tmux = coordinator.facts?.tmux;
				if (!tmux)
					return {
						ok: false,
						reason: `${coordinator.name} is not running in tmux, so there is nowhere to open ${name}'s window beside it.`,
					};
				pane = { socket: tmux.socket, pane: tmux.pane };
			} else {
				pane = await operatorPane(servers());
				if (!pane)
					return {
						ok: false,
						reason: `No terminal is attached to tmux, so there is nowhere to open ${name}'s window.`,
					};
			}
			const sessionId = randomUUID();
			const command: Command = {
				kind: "start",
				tmux: pane,
				cwd,
				name,
				...(request.reportsTo ? { reportsTo: request.reportsTo } : {}),
				...(brief ? { prompt: brief } : {}),
			};
			const receipt = await follow(
				commands,
				sessionId,
				command,
				WAKE_MS,
				(stage) => stage === "applied",
				() => `Its window opened, but ${name} has not joined yet.`,
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

		async sendMail(characterId, body) {
			const text = body.trim();
			if (!text) return { ok: false, reason: "The message is empty." };
			const command: Command = { kind: "mail", from: OPERATOR, body: text, sentAt: new Date().toISOString() };
			return follow(
				commands,
				characterId,
				command,
				MAIL_MS,
				// Accepted with a reason means it waits for the session to open; applied means its transcript holds it.
				(stage, reason) => stage === "applied" || (stage === "accepted" && reason !== undefined),
				(stage) => (stage === "delivered" ? "Handed over; not in its transcript yet." : "Sent; not delivered yet."),
			);
		},
	};
}
