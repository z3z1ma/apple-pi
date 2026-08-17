import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { inChildSessionContext } from "../../subagents/src/child-context.js";
import { createLedgerTool, resolveLedgerRoot } from "./ledger-tool.js";
import { getOperationsRuntime, installOperationsRuntime, OperationsRuntime } from "./runtime.js";

export { ProgressChannel, SnapshotProjection } from "./progress-channel.js";
export { getOperationsRuntime, isTuiContext, OperationsRuntime } from "./runtime.js";
export {
	ACTIVE_TASK_ENTRY,
	ACTIVE_TASK_TOMBSTONE,
	foldActiveTaskPointer,
	foldOperationPointers,
	projectOperationsSession,
} from "./session-state.js";
export { CompactOperationsWidget, renderCompactLines } from "./ui/compact-widget.js";
export { createHubModel, handleHubInput, renderHub } from "./ui/hub.js";
export { filterLedgerTasks, renderLedgerView } from "./ui/ledger-view.js";
export { throttleUpdates } from "./ui/tool-renderers.js";

export default function installHarness(pi: ExtensionAPI): void {
	if (inChildSessionContext()) return;
	const runtime = new OperationsRuntime(pi);
	installOperationsRuntime(runtime, pi.events);
	pi.registerTool(
		createLedgerTool({
			appendEntry: (type, data) => pi.appendEntry(type, data),
			resolveLedgerRoot,
		}),
	);
	pi.registerCommand("harness", {
		description: "Open the ledger operations hub",
		handler: async (_input, ctx) => {
			await runtime.openHub(ctx);
		},
	});
	pi.registerCommand("ledger", {
		description: "Open the ledger task picker or inspect the session working-set task",
		handler: async (input, ctx) => {
			const trimmed = input.trim();
			if (!trimmed || trimmed === "open") {
				await runtime.openHub(ctx);
				return;
			}
			ctx.ui.notify("Usage: /ledger", "info");
		},
	});
	pi.on("session_start", (_event, ctx) => {
		runtime.reconstruct(ctx);
	});
	pi.on("session_tree", (_event, ctx) => {
		runtime.reconstruct(ctx);
	});
	pi.on("session_before_switch", async () => {
		await runtime.dispose();
	});
	pi.on("session_shutdown", async () => {
		await runtime.dispose();
	});
}

export function requireOperationsRuntime(events?: ExtensionAPI["events"]): OperationsRuntime {
	const runtime = getOperationsRuntime(events);
	if (!runtime) throw new Error("Harness operations runtime is not installed");
	return runtime;
}
