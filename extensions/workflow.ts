import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendLedgerWorkflowSystemPrompt } from "../components/shared/src/workflow-system-prompt.js";

export const WORKFLOW_EXTENSION_PATH = fileURLToPath(import.meta.url);

export default function installWorkflow(pi: ExtensionAPI): void {
	pi.on("before_agent_start", (event) => ({
		systemPrompt: appendLedgerWorkflowSystemPrompt(event.systemPrompt ?? ""),
	}));
}
