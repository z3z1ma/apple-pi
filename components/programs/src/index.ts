import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installPeerTools } from "./peers.js";
import { installPrograms } from "./programs.js";

export function activateCodemode(pi: ExtensionAPI): void {
	const active = pi.getActiveTools();
	if (!active.includes("codemode") && pi.getAllTools().some((tool) => tool.name === "codemode"))
		pi.setActiveTools([...active, "codemode"]);
}

export default function installProgramsExtension(pi: ExtensionAPI): void {
	pi.on("session_start", () => activateCodemode(pi));
	pi.on("before_agent_start", () => activateCodemode(pi));
	installPrograms(pi);
	installPeerTools(pi);
}
