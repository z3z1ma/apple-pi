/**
 * Publish per-session Pi status to disk for the tmux agent sidebar, and load
 * the sidebar's tmux plugin once per tmux server.
 *
 * Pi has no `claude agents --json` equivalent, so this extension is the source
 * of truth the sidebar reads. For each root Pi session running inside tmux
 * it maintains one JSON record (see `state.ts`) with the pane, pid, and a
 * `busy` / `idle` / `waiting` status derived from agent lifecycle events:
 *
 * - `agent_start`                     -> busy
 * - `ui_prompt_start`                 -> waiting (needs the user)
 * - `ui_prompt_end`                   -> idle or busy (prompt resolved)
 * - `agent_settled`                   -> idle (settled, the user's turn)
 * - `session_shutdown`                -> record removed
 *
 * A session started with `--reports-to <id>` publishes that id in its record
 * and mails it when the session closes, so a supervising session (an Orchard)
 * learns that its worker stopped.
 *
 * `agent_settled` fires on interrupt and error too, so the busy -> idle
 * transition is driven by settle unconditionally rather than by a successful
 * turn. On settle the extension also rings the pane's own bell (opt-out via
 * `PI_TMUX_SESSION_BELL`), so tmux marks the window in its status line.
 *
 * Only root interactive (`tui`) sessions publish. Subagent and pi_exec worker
 * sessions are excluded so the sidebar lists jump targets, not internal workers.
 *
 * Optional environment variables:
 * - `PI_TMUX_DISABLED=1`      disable publishing entirely.
 * - `PI_TMUX_SESSION_BELL=off` do not ring the pane bell on settle.
 * - `PI_TMUX_STATE_DIR=/path` override the record directory.
 */

import { appendFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { inChildSessionContext } from "../../subagents/src/child-context.js";
import { appendMailboxMessage } from "../../tasks/src/mailbox.js";
import {
	type AgentStateRecord,
	type AgentStatus,
	readAllStates,
	removeState,
	STATE_DIR,
	STATE_SCHEMA,
	writeState,
} from "./state.js";

function isDisabled(): boolean {
	return /^(?:1|true|yes|on)$/iu.test(process.env.PI_TMUX_DISABLED || "");
}

function bellDisabled(): boolean {
	return /^(?:0|false|no|off)$/iu.test(process.env.PI_TMUX_SESSION_BELL || "");
}

function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

interface TmuxPane {
	paneId: string;
	windowId: string;
	paneTty: string;
}

async function resolveTmuxBin(pi: ExtensionAPI): Promise<string> {
	try {
		const result = await pi.exec("/bin/sh", ["-c", "command -v tmux"], { timeout: 2_000 });
		const resolved = result.stdout.trim();
		if (result.code === 0 && resolved) return resolved;
	} catch {
		// Fall through to the PATH-resolved name.
	}
	return "tmux";
}

async function readTmuxPane(pi: ExtensionAPI, tmuxBin: string): Promise<TmuxPane | undefined> {
	const pane = process.env.TMUX_PANE;
	if (!pane) return undefined;
	try {
		const result = await pi.exec(
			tmuxBin,
			["display-message", "-p", "-t", pane, "#{pane_id}\t#{window_id}\t#{pane_tty}"],
			{ timeout: 2_000 },
		);
		if (result.code !== 0) return undefined;
		const [paneId, windowId, paneTty] = result.stdout.trimEnd().split("\t");
		if (!paneId) return undefined;
		return { paneId, windowId: windowId || "", paneTty: paneTty || "" };
	} catch {
		return undefined;
	}
}

const PLUGIN = fileURLToPath(new URL("../pi_session_manager.tmux", import.meta.url));
const SIDEBAR = fileURLToPath(new URL("../scripts/sidebar.sh", import.meta.url));
const NOTCH = fileURLToPath(new URL("../scripts/notch.sh", import.meta.url));

/**
 * Load the tmux plugin unless this server already loaded this exact file. The stamp holds the path and
 * modification time, so an updated package reloads its bindings and hooks on the next Pi start.
 */
async function ensurePlugin(pi: ExtensionAPI, tmuxBin: string): Promise<void> {
	const stamp = `${PLUGIN}:${(await stat(PLUGIN)).mtimeMs}`;
	const loaded = await pi.exec(tmuxBin, ["show-option", "-gqv", "@pi_sessions_plugin"], { timeout: 2_000 });
	if (loaded.stdout.trim() === stamp) return;
	await pi.exec(tmuxBin, ["set-option", "-g", "@pi_state_dir", STATE_DIR], { timeout: 2_000 });
	const run = await pi.exec(tmuxBin, ["run-shell", PLUGIN], { timeout: 10_000 });
	if (run.code !== 0) return;
	await pi.exec(tmuxBin, ["set-option", "-g", "@pi_sessions_plugin", stamp], { timeout: 2_000 });
}

/** Mail the supervisor that its worker closed. Shutdown must go on, so a failed send is dropped. */
function reportClose(record: AgentStateRecord, reason: string): void {
	const name = record.sessionName ? ` "${record.sessionName}"` : "";
	try {
		appendMailboxMessage(
			record.reportsTo,
			record.sessionId,
			`Session${name} closed (${reason}) while ${record.status}. Directory: ${record.cwd}`,
		);
	} catch {
		// An invalid --reports-to id has no mailbox to write to.
	}
}

export default function piTmuxSessions(pi: ExtensionAPI): void {
	pi.registerFlag("reports-to", {
		type: "string",
		description: "Session id to mail when this session closes; published in its tmux state record",
	});
	// Subagents and pi_exec workers are not user-facing jump targets.
	if (inChildSessionContext() || isDisabled()) return;

	let record: AgentStateRecord | undefined;
	let tmuxBin = "tmux";
	// The pane the Pi TUI runs in is stable for the process lifetime, so resolve
	// it once and reuse across session switches within the same pane.
	let pane: TmuxPane | undefined;
	let paneResolved = false;
	// Serialize writes so rapid lifecycle events cannot interleave.
	let queue: Promise<void> = Promise.resolve();

	function schedule(task: () => Promise<void>): void {
		queue = queue.then(task).catch(() => {
			// State publishing must never disrupt the session.
		});
	}

	/** Write the record, then let the tmux status-line summary recount; the script runs in the background. */
	async function publish(next: AgentStateRecord): Promise<void> {
		await writeState(next);
		await refreshStatus();
	}

	async function refreshStatus(): Promise<void> {
		await pi.exec(tmuxBin, ["run-shell", "-b", `'${SIDEBAR}' status`], { timeout: 2_000 });
	}

	async function init(ctx: ExtensionContext, reason: string): Promise<void> {
		// Only a real interactive session inside tmux is a jump target.
		if (ctx.mode !== "tui" || !process.env.TMUX_PANE) return;
		// A reload keeps the same session; nothing to rebuild.
		if (record && reason === "reload") return;
		const sessionId = ctx.sessionManager.getSessionId();
		if (!sessionId) return;
		if (record && record.sessionId === sessionId) return;
		// A same-pane switch/resume/fork replaces the tracked session: drop the
		// old record so it does not linger with a stale id, cwd, and name.
		if (record && record.sessionId !== sessionId) await removeState(record.sessionId);
		if (!paneResolved) {
			tmuxBin = await resolveTmuxBin(pi);
			pane = await readTmuxPane(pi, tmuxBin);
			paneResolved = true;
			if (pane) schedule(() => ensurePlugin(pi, tmuxBin));
		}
		if (!pane) {
			record = undefined;
			return;
		}
		// Every new root session, so `/new` after a crash or a package update brings the right panel back. Outside the
		// status queue: a first build of the panel takes seconds, and status updates must not wait for it.
		if (process.platform === "darwin") pi.exec(NOTCH, ["start"]).catch(() => {});
		const ts = nowSeconds();
		record = {
			schema: STATE_SCHEMA,
			sessionId,
			pid: process.pid,
			status: "idle",
			cwd: ctx.cwd,
			sessionName: pi.getSessionName() || "",
			paneId: pane.paneId,
			windowId: pane.windowId,
			paneTty: pane.paneTty,
			// $TMUX is "socket,server-pid,session".
			tmuxSocket: (process.env.TMUX ?? "").split(",")[0] ?? "",
			reportsTo: String(pi.getFlag("reports-to") ?? ""),
			startedAt: ts,
			updatedAt: ts,
		};
		await publish(record);
	}

	function setStatus(status: AgentStatus): void {
		schedule(async () => {
			if (!record || record.status === status) return;
			record.status = status;
			record.updatedAt = nowSeconds();
			record.sessionName = pi.getSessionName() || record.sessionName;
			await publish(record);
		});
	}

	async function ringPaneBell(): Promise<void> {
		if (bellDisabled() || !record?.paneTty) return;
		try {
			// Writing BEL to the pane's own pty makes tmux count a bell for that
			// pane, which marks its window in the status line.
			await appendFile(record.paneTty, "\x07");
		} catch {
			// A bell that cannot be delivered must not fail anything.
		}
	}

	pi.on("session_start", (event, ctx) => {
		schedule(() => init(ctx, event.reason));
	});

	pi.on("session_info_changed", (event) => {
		schedule(async () => {
			if (!record) return;
			// updatedAt stays the time of the last status change: the sidebar counts an idle agent updated after
			// you last looked as unseen, and an automatic title arriving after you looked must not reopen it.
			record.sessionName = event.name || "";
			await publish(record);
		});
	});

	pi.on("agent_start", () => setStatus("busy"));

	// Covers every blocking extension prompt, including ask_user_question's
	// custom questionnaire UI.
	pi.on("ui_prompt_start", () => setStatus("waiting"));

	pi.on("ui_prompt_end", (_event, ctx) => {
		setStatus(ctx.isIdle() ? "idle" : "busy");
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (!ctx.isIdle()) return;
		setStatus("idle");
		schedule(ringPaneBell);
	});

	pi.on("session_shutdown", (event) => {
		if (record?.reportsTo && event.reason !== "reload") reportClose(record, event.reason);
		schedule(async () => {
			if (!record) return;
			await removeState(record.sessionId);
			record = undefined;
			await refreshStatus();
		});
		// Pi awaits this before a SIGHUP exit; without it a killed window left its record behind.
		return queue;
	});

	pi.registerCommand("pi-sessions", {
		description: "List Pi sessions published to the tmux session manager",
		handler: async (_args, ctx) => {
			const records = await readAllStates();
			if (records.length === 0) {
				ctx.ui.notify(`No published Pi sessions. State dir: ${STATE_DIR}`, "info");
				return;
			}
			const live = records.filter((entry) => {
				try {
					process.kill(entry.pid, 0);
					return true;
				} catch {
					return false;
				}
			});
			const lines = live
				.map((entry) => `${entry.status.padEnd(7)} ${entry.paneId}  ${entry.sessionName || entry.cwd}`)
				.join("\n");
			ctx.ui.notify(`Published Pi sessions (${live.length}):\n${lines || "(none live)"}`, "info");
		},
	});
}
