import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { setSystemPromptSection } from "../../../shared/src/system-prompt-section.js";

export const PROJECT_LEARNINGS_PATH = ".pi/LEARNINGS.md";
export const PROJECT_LEARNINGS_TAG = "project-learnings";

/**
 * Adds `.pi/LEARNINGS.md` to the system prompt as read at session start, so
 * placements during a session apply from the next one and the prompt prefix stays cached.
 */
export function registerProjectLearnings(pi: ExtensionAPI): void {
	let learnings: string | undefined;

	pi.on("session_start", (_event, ctx) => {
		const path = join(ctx.cwd, PROJECT_LEARNINGS_PATH);
		learnings = existsSync(path) ? readFileSync(path, "utf8").trim() || undefined : undefined;
	});

	pi.on("before_agent_start", (event) => {
		if (!learnings) return;
		setSystemPromptSection(
			event.systemPromptOptions,
			PROJECT_LEARNINGS_TAG,
			`Learnings from earlier sessions in this project, kept in \`${PROJECT_LEARNINGS_PATH}\`. Apply them; the user's instructions and AGENTS.md take precedence.\n\n${learnings}`,
		);
	});
}
