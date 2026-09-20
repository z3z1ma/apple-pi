import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import installCompactionSafety from "./compaction-safety.js";

export const AUTO_COMPACT_EXTENSION_PATH = fileURLToPath(import.meta.url);

export default function autoCompact(pi: ExtensionAPI): void {
	installCompactionSafety(pi);
}
