import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	isRtkAvailable,
	RTK_SYSTEM_PROMPT,
	RTK_SYSTEM_PROMPT_TAG,
	rewriteCommand,
} from "../components/rtk/src/index.js";
import { setSystemPromptSection } from "../components/shared/src/system-prompt-section.js";

export const RTK_EXTENSION_PATH = fileURLToPath(import.meta.url);

export default async function installRtk(pi: ExtensionAPI): Promise<void> {
	const available = await isRtkAvailable();
	if (!available) {
		return;
	}

	pi.on("before_agent_start", (event) =>
		setSystemPromptSection(event.systemPromptOptions, RTK_SYSTEM_PROMPT_TAG, RTK_SYSTEM_PROMPT),
	);

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;
		const input = event.input as any;
		if (!input || typeof input.command !== "string") return undefined;
		if (input.verbatim === true) return undefined;
		if (input.command.startsWith("rtk ")) return undefined;

		const rewritten = await rewriteCommand(input.command, { signal: ctx.signal });
		if (rewritten && rewritten !== input.command) {
			input._rawCommand = input.command;
			input.command = rewritten;
			input._rtk = true;
		}

		return undefined;
	});
}
