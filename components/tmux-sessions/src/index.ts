/**
 * tmux glue for root interactive Pi sessions: load the sidebar's tmux plugin once per tmux server, ring the
 * pane's bell when a run settles, and start the notch panel on macOS. What each session is doing lives in the
 * session-state model, which the sidebar, the dashboard, and the notch read.
 *
 * Optional environment variables:
 * - `PI_TMUX_DISABLED=1`       turn this extension off.
 * - `PI_TMUX_SESSION_BELL=off` do not ring the pane bell on settle.
 */

import { appendFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { agentDir } from "../../session-state/src/paths.js";
import { PROGRAM_ID_ENV } from "../../session-state/src/protocol.js";
import { inChildSessionContext } from "../../subagents/src/child-context.js";

const PLUGIN = fileURLToPath(new URL("../pi_session_manager.tmux", import.meta.url));
const NOTCH = fileURLToPath(new URL("../scripts/notch.sh", import.meta.url));

const isDisabled = () => /^(?:1|true|yes|on)$/iu.test(process.env.PI_TMUX_DISABLED || "");
const bellDisabled = () => /^(?:0|false|no|off)$/iu.test(process.env.PI_TMUX_SESSION_BELL || "");

/** The tty of the pane this Pi runs in, or nothing outside tmux. */
async function paneTty(pi: ExtensionAPI): Promise<string | undefined> {
	const pane = process.env.TMUX_PANE;
	if (!pane) return undefined;
	const result = await pi.exec("tmux", ["display-message", "-p", "-t", pane, "#{pane_tty}"], { timeout: 2_000 });
	return result.code === 0 ? result.stdout.trim() || undefined : undefined;
}

/**
 * Load the tmux plugin unless this server already loaded this exact file. The stamp holds the path and
 * modification time, so an updated package reloads its bindings and hooks on the next Pi start.
 */
async function ensurePlugin(pi: ExtensionAPI): Promise<void> {
	const stamp = `${PLUGIN}:${(await stat(PLUGIN)).mtimeMs}`;
	const loaded = await pi.exec("tmux", ["show-option", "-gqv", "@pi_sessions_plugin"], { timeout: 2_000 });
	if (loaded.stdout.trim() === stamp) return;
	await pi.exec("tmux", ["set-option", "-g", "@pi_agent_dir", agentDir()], { timeout: 2_000 });
	const run = await pi.exec("tmux", ["run-shell", PLUGIN], { timeout: 10_000 });
	if (run.code !== 0) return;
	await pi.exec("tmux", ["set-option", "-g", "@pi_sessions_plugin", stamp], { timeout: 2_000 });
}

export default function piTmuxSessions(pi: ExtensionAPI): void {
	// In-process children have no pane of their own.
	if (inChildSessionContext() || isDisabled()) return;
	let tty: Promise<string | undefined> | undefined;

	pi.on("session_start", (event, ctx) => {
		if (ctx.mode !== "tui" || !process.env.TMUX_PANE || event.reason === "reload") return;
		if (!tty) {
			tty = paneTty(pi).catch(() => undefined);
			ensurePlugin(pi).catch(() => {});
		}
		// Every new root session, so `/new` after a crash or a package update brings the right panel back.
		if (process.platform === "darwin") pi.exec(NOTCH, ["start"]).catch(() => {});
	});

	// Writing BEL to the pane's own pty makes tmux count a bell for that pane, which marks its window.
	pi.on("agent_settled", async (_event, ctx) => {
		if (process.env[PROGRAM_ID_ENV] || !ctx.isIdle() || bellDisabled() || !tty) return;
		const path = await tty;
		if (path) await appendFile(path, "\x07").catch(() => {});
	});
}
