import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerRecallTool } from "../components/session-search/src/index.js";

export const SESSION_SEARCH_EXTENSION_PATH = fileURLToPath(import.meta.url);

export function installSessionSearch(pi: ExtensionAPI): void {
	registerRecallTool(pi);
}

export default function sessionSearch(pi: ExtensionAPI): void {
	installSessionSearch(pi);
}
