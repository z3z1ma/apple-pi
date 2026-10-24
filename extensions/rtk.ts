import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isRtkAvailable, RTK_SYSTEM_PROMPT, RTK_SYSTEM_PROMPT_TAG } from "../components/rtk/src/index.js";
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
}
