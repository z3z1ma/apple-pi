/**
 * Publish per-session Pi status to disk for the tmux session manager scripts.
 *
 * Pi has no `claude agents --json` equivalent, so this extension is the source
 * of truth the bash scripts read. For each root Pi session running inside tmux
 * it maintains one JSON record (see `state.ts`) with the pane, pid, and a
 * `busy` / `idle` / `waiting` status derived from agent lifecycle events:
 *
 * - `agent_start`                     -> busy
 * - `ui_prompt_start`                 -> waiting (needs the user)
 * - `ui_prompt_end`                   -> idle or busy (prompt resolved)
 * - `agent_settled`                   -> idle (settled, the user's turn)
 * - `session_shutdown`                -> record removed
 *
 * `agent_settled` fires on interrupt and error too, so the busy -> idle
 * transition is driven by settle unconditionally rather than by a successful
 * turn. On settle the extension also rings the pane's own bell (opt-out via
 * `PI_TMUX_SESSION_BELL`), which tmux's `alert-bell` hook forwards from a
 * dedicated session to the window that launched it.
 *
 * Only root interactive (`tui`) sessions publish. Subagent and pi_exec worker
 * sessions are excluded so the picker lists jump targets, not internal workers.
 *
 * Optional environment variables:
 * - `PI_TMUX_DISABLED=1`      disable publishing entirely.
 * - `PI_TMUX_SESSION_BELL=off` do not ring the pane bell on settle.
 * - `PI_TMUX_STATE_DIR=/path` override the record directory.
 */

import { appendFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { inChildSessionContext } from "../../subagents/src/child-context.js";
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

export default function piTmuxSessions(pi: ExtensionAPI): void {
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
		}
		if (!pane) {
			record = undefined;
			return;
		}
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
			startedAt: ts,
			updatedAt: ts,
		};
		await writeState(record);
	}

	function setStatus(status: AgentStatus): void {
		schedule(async () => {
			if (!record || record.status === status) return;
			record.status = status;
			record.updatedAt = nowSeconds();
			record.sessionName = pi.getSessionName() || record.sessionName;
			await writeState(record);
		});
	}

	async function ringPaneBell(): Promise<void> {
		if (bellDisabled() || !record?.paneTty) return;
		try {
			// Writing BEL to the pane's own pty makes tmux count a bell for that
			// pane; the alert-bell hook then forwards it from a dedicated session.
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
			record.sessionName = event.name || "";
			record.updatedAt = nowSeconds();
			await writeState(record);
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

	pi.on("session_shutdown", () => {
		schedule(async () => {
			if (record) await removeState(record.sessionId);
			record = undefined;
		});
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
