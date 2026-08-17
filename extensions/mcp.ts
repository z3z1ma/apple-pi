import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import mcpAdapter from "pi-mcp-adapter";

export const MCP_EXTENSION_PATH = fileURLToPath(import.meta.url);

/**
 * Install the full MCP adapter while keeping pi_exec as apple-pi's only
 * programmable tool runtime. The adapter's `mcp` gateway remains available to
 * ordinary model turns and is captured by pi_exec's extension-tool bridge.
 */
export default function installMcp(pi: ExtensionAPI): void {
	const api = new Proxy(pi, {
		get(target, property) {
			if (property === "registerTool") {
				return (tool: { name?: string }) => {
					if (tool.name === "mcpScript") return;
					return target.registerTool(tool as never);
				};
			}

			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});

	mcpAdapter(api);
}
