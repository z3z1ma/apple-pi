import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { setSystemPromptSection } from "../../../shared/src/system-prompt-section.js";

export const PROJECT_LEARNINGS_PATH = ".pi/LEARNINGS.md";
export const PROJECT_LEARNINGS_TAG = "project-learnings";

/**
 * Adds `.pi/LEARNINGS.md` to the system prompt at each run. Pi appends a changed
 * section as a system message, so the cached prefix stays intact.
 */
export function registerProjectLearnings(pi: ExtensionAPI): void {
	pi.on("before_agent_start", (event, ctx) => {
		const path = join(ctx.cwd, PROJECT_LEARNINGS_PATH);
		const learnings = existsSync(path) ? readFileSync(path, "utf8").trim() : "";
		if (!learnings) return;
		setSystemPromptSection(
			event.systemPromptOptions,
			PROJECT_LEARNINGS_TAG,
			`Learnings from earlier sessions in this project, kept in \`${PROJECT_LEARNINGS_PATH}\`. Apply them; the user's instructions and AGENTS.md take precedence.\n\n${learnings}`,
		);
	});
}
