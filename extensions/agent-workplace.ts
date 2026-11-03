import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	ELECTRON_VERSION,
	InstallError,
	type InstallStep,
	installElectron,
	installedElectron,
	startAgentWorkplace,
} from "../apps/agent-workplace/src/launch.js";

const STATUS = "agent-workplace";

function stepText(step: InstallStep): string {
	if (step.stage === "installing") return `Agent Workplace: installing Electron ${ELECTRON_VERSION} with npm...`;
	if (step.stage === "unpacking") return "Agent Workplace: unpacking Electron...";
	return `Agent Workplace: downloading Electron ${ELECTRON_VERSION}...${step.percent === null ? "" : ` ${step.percent}%`}`;
}

export default function agentWorkplace(pi: ExtensionAPI) {
	let installing: Promise<string> | undefined;
	pi.registerCommand("workplace", {
		description:
			"Open Agent Workplace: chat with your organization, its work and its World (installs Electron on first use)",
		handler: async (_args, ctx) => {
			let electron = installedElectron();
			try {
				if (!electron) {
					if (installing) {
						ctx.ui.notify("Agent Workplace is still installing Electron; it opens when that is done.", "info");
						return;
					}
					ctx.ui.notify(
						`Installing Electron ${ELECTRON_VERSION} for Agent Workplace (first use only, about a 100 MB download). ` +
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
							`Agent Workplace could not install Electron: ${reason}. Nothing was left half-installed; ` +
								`${network ? "check your connection, then " : ""}run /workplace again to retry.`,
							"error",
						);
						return;
					} finally {
						installing = undefined;
					}
					ctx.ui.notify("Electron is installed.", "info");
				}
				ctx.ui.setStatus(STATUS, "Agent Workplace: opening...");
				const started = await startAgentWorkplace(electron);
				if (started.ok) ctx.ui.notify("Opening Agent Workplace.", "info");
				else ctx.ui.notify(`Agent Workplace did not open: ${started.reason}. Run /workplace again to retry.`, "error");
			} finally {
				ctx.ui.setStatus(STATUS, undefined);
			}
		},
	});
}
