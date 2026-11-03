import { appendFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { agentDir } from "../../session-state/src/paths.js";
import { PROGRAM_ID_ENV } from "../../session-state/src/protocol.js";

const PLUGIN = fileURLToPath(new URL("../pi_session_manager.tmux", import.meta.url));
const NOTCH = fileURLToPath(new URL("../scripts/notch.sh", import.meta.url));

const isDisabled = () => /^(?:1|true|yes|on)$/iu.test(process.env.PI_TMUX_DISABLED || "");
const bellDisabled = () => /^(?:0|false|no|off)$/iu.test(process.env.PI_TMUX_SESSION_BELL || "");

async function paneTty(pi: ExtensionAPI): Promise<string | undefined> {
	const pane = process.env.TMUX_PANE;
	if (!pane) return undefined;
	const result = await pi.exec("tmux", ["display-message", "-p", "-t", pane, "#{pane_tty}"], { timeout: 2_000 });
	return result.code === 0 ? result.stdout.trim() || undefined : undefined;
}

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
	if (isDisabled()) return;
	let tty: Promise<string | undefined> | undefined;

	pi.on("session_start", (event, ctx) => {
		if (ctx.mode !== "tui" || !process.env.TMUX_PANE || event.reason === "reload") return;
		if (!tty) {
			tty = paneTty(pi).catch(() => undefined);
			ensurePlugin(pi).catch(() => {});
		}
		if (process.platform === "darwin") pi.exec(NOTCH, ["start"]).catch(() => {});
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (process.env[PROGRAM_ID_ENV] || !ctx.isIdle() || bellDisabled() || !tty) return;
		const path = await tty;
		if (path) await appendFile(path, "\x07").catch(() => {});
	});
}
