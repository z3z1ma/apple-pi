import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { setSystemPromptSection } from "../../../shared/src/system-prompt-section.js";

export const PROJECT_LEARNINGS_PATH = ".pi/LEARNINGS.md";
export const PROJECT_LEARNINGS_TAG = "project-learnings";

/**
 * Adds `.pi/LEARNINGS.md` to the system prompt as read at session start or the last
 * compaction, so the prompt prefix stays cached between compactions.
 */
export function registerProjectLearnings(pi: ExtensionAPI): void {
	let learnings: string | undefined;
	const read = (_event: unknown, ctx: { cwd: string }) => {
		const path = join(ctx.cwd, PROJECT_LEARNINGS_PATH);
		learnings = existsSync(path) ? readFileSync(path, "utf8").trim() || undefined : undefined;
	};

	pi.on("session_start", read);
	pi.on("session_compact", read);

	pi.on("before_agent_start", (event) => {
		if (!learnings) return;
		setSystemPromptSection(
			event.systemPromptOptions,
			PROJECT_LEARNINGS_TAG,
			`Learnings from earlier sessions in this project, kept in \`${PROJECT_LEARNINGS_PATH}\`. Apply them; the user's instructions and AGENTS.md take precedence.\n\n${learnings}`,
		);
	});
}
