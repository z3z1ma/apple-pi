import { createCodingTools, createPowerShellTool, createReadOnlyTools } from "@earendil-works/pi-coding-agent";

/** Tool names are derived from Pi so added or renamed built-ins stay discoverable. */
export const BUILTIN_TOOL_NAMES: string[] = [
	...new Set(
		[...createCodingTools("."), ...createReadOnlyTools("."), createPowerShellTool(".")].map((tool) => tool.name),
	),
];
