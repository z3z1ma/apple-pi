import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	ELECTRON_VERSION,
	InstallError,
	type InstallStep,
	installElectron,
	installedElectron,
	startAgentWorld,
} from "../apps/agent-world/src/launch.js";

const STATUS = "agent-world";

/** The status line for each install step. */
function stepText(step: InstallStep): string {
	if (step.stage === "installing") return `Agent World: installing Electron ${ELECTRON_VERSION} with npm...`;
	if (step.stage === "unpacking") return "Agent World: unpacking Electron...";
	return `Agent World: downloading Electron ${ELECTRON_VERSION}...${step.percent === null ? "" : ` ${step.percent}%`}`;
}

// `/world` opens Agent World (apps/agent-world/), installing Electron on first use. The install shows its steps in
// the status line; a failed one says why and leaves nothing behind, so `/world` again retries from the start.
export default function agentWorld(pi: ExtensionAPI) {
	let installing: Promise<string> | undefined;
	pi.registerCommand("world", {
		description: "Open Agent World, the world of your Pi sessions (installs Electron on first use)",
		handler: async (_args, ctx) => {
			let electron = installedElectron();
			try {
				if (!electron) {
					if (installing) {
						ctx.ui.notify("Agent World is still installing Electron; it opens when that is done.", "info");
						return;
					}
					ctx.ui.notify(
						`Installing Electron ${ELECTRON_VERSION} for Agent World (first use only, about a 100 MB download). ` +
							"Progress shows in the status line.",
						"info",
					);
					installing = installElectron(undefined, (step) => ctx.ui.setStatus(STATUS, stepText(step)));
					try {
						electron = await installing;
					} catch (error) {
						const reason = (error as Error).message;
						const network = error instanceof InstallError && error.network;
						ctx.ui.notify(
							`Agent World could not install Electron: ${reason}. Nothing was left half-installed; ` +
								`${network ? "check your connection, then " : ""}run /world again to retry.`,
							"error",
						);
						return;
					} finally {
						installing = undefined;
					}
					ctx.ui.notify("Electron is installed.", "info");
				}
				ctx.ui.setStatus(STATUS, "Agent World: opening...");
				const started = await startAgentWorld(electron);
				if (started.ok) ctx.ui.notify("Opening Agent World.", "info");
				else ctx.ui.notify(`Agent World did not open: ${started.reason}. Run /world again to retry.`, "error");
			} finally {
				ctx.ui.setStatus(STATUS, undefined);
			}
		},
	});
}
