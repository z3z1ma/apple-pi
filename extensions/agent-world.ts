import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installElectron, installedElectron, startAgentWorld } from "../apps/agent-world/src/launch.js";

// `/world` opens Agent World (apps/agent-world/), installing Electron on first use.
export default function agentWorld(pi: ExtensionAPI) {
	pi.registerCommand("world", {
		description: "Open Agent World, the world of your Pi sessions (installs Electron on first use)",
		handler: async (_args, ctx) => {
			let electron = installedElectron();
			if (!electron) {
				ctx.ui.notify("Installing Electron for Agent World (first use only)...", "info");
				try {
					electron = await installElectron();
				} catch (error) {
					ctx.ui.notify(`Agent World could not install Electron: ${(error as Error).message}`, "error");
					return;
				}
			}
			startAgentWorld(electron);
			ctx.ui.notify("Opening Agent World.", "info");
		},
	});
}
