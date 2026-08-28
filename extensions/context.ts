import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { installSessionSearch } from "./session-search.js";

/**
 * Transcript search is available in root sessions, child sessions, and workers.
 * Pair Programmer owns the root-only memory ledger, packet, recall, and compaction
 * integration so there is one model-facing companion rather than a second persistent memory actor.
 */
export default function context(pi: ExtensionAPI): void {
	installSessionSearch(pi);
}
