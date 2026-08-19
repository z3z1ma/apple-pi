import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerStatusCommand } from "../components/memory/src/commands/status.js";
import { registerViewCommand } from "../components/memory/src/commands/view.js";
import { registerCompactionTrigger } from "../components/memory/src/hooks/compaction-trigger.js";
import { registerConsolidationTrigger } from "../components/memory/src/hooks/consolidation-trigger.js";
import { registerMemoryContextPacket } from "../components/memory/src/hooks/context-packet.js";
import { Runtime } from "../components/memory/src/runtime.js";
import { registerRecallTool as registerMemoryRecallTool } from "../components/memory/src/tools/recall-observation.js";
import { inChildSessionContext } from "../components/subagents/src/child-context.js";
import { installSessionSearch } from "./session-search.js";

/**
 * Root context: observational memory plus session_search. Compaction itself is
 * owned by xAI server-side compaction on Responses-routed Grok, otherwise Pi's
 * default summarizer. Memory appends its packet to the conversation tail after
 * any compaction entry.
 *
 * Observational memory is root-session only. Child sessions (subagents, workers)
 * still get `session_search`, but never the curator pipeline, packet,
 * commands, or `memory_source`.
 */
export default function context(pi: ExtensionAPI): void {
	installSessionSearch(pi);
	if (inChildSessionContext()) return;

	const memory = new Runtime();
	registerConsolidationTrigger(pi, memory);
	registerCompactionTrigger(pi, memory);
	registerMemoryContextPacket(pi, memory);
	registerStatusCommand(pi, memory);
	registerViewCommand(pi, memory);
	registerMemoryRecallTool(pi);
}
