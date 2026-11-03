import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";

const EXCLUDED_TOOL_NAMES = new Set(["pi_exec", "monitor", "remind_me", "task", "search_branches"]);

export function callableTools(ctx: ExtensionToolContext): readonly AgentTool[] {
	return ctx.tools.filter((tool) => !EXCLUDED_TOOL_NAMES.has(tool.name) && !tool.name.startsWith("program_"));
}
