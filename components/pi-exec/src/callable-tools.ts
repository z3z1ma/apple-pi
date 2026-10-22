import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";

/** Root-only orchestration tools a program must not reach, even when Pi lists them as callable. */
const EXCLUDED_TOOL_NAMES = new Set(["pi_exec", "monitor", "remind_me", "task", "search_branches"]);

/** Tools a program may call: Pi's callable set for the running call, minus root-only orchestration. */
export function callableTools(ctx: ExtensionToolContext): readonly AgentTool[] {
	return ctx.tools.filter((tool) => !EXCLUDED_TOOL_NAMES.has(tool.name) && !tool.name.startsWith("program_"));
}
