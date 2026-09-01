import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerOverflowGuard } from "../components/notebook/src/hooks/overflow-guard.js";
import installCompactionSafety from "./compaction-safety.js";
import { Runtime } from "../components/notebook/src/runtime.js";

export const AUTO_COMPACT_EXTENSION_PATH = fileURLToPath(import.meta.url);

export default function autoCompact(pi: ExtensionAPI): void {
	installCompactionSafety(pi);
	registerOverflowGuard(pi, new Runtime());
}
