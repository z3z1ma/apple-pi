import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerOverflowGuard } from "../components/memory/src/hooks/overflow-guard.js";
import { Runtime } from "../components/memory/src/runtime.js";

export const AUTO_COMPACT_EXTENSION_PATH = fileURLToPath(import.meta.url);

export default function autoCompact(pi: ExtensionAPI): void {
	registerOverflowGuard(pi, new Runtime());
}
