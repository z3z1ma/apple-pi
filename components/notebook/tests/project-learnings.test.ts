import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import {
	PROJECT_LEARNINGS_PATH,
	PROJECT_LEARNINGS_TAG,
	registerProjectLearnings,
} from "../src/hooks/project-learnings.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const dispose of cleanup.splice(0)) dispose();
});

function project(learnings?: string) {
	const cwd = mkdtempSync(join(tmpdir(), "apple-pi-project-learnings-"));
	cleanup.push(() => rmSync(cwd, { recursive: true, force: true }));
	if (learnings !== undefined) {
		mkdirSync(join(cwd, ".pi"));
		writeFileSync(join(cwd, PROJECT_LEARNINGS_PATH), learnings);
	}
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	registerProjectLearnings({
		on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => handlers.set(event, handler),
	} as unknown as ExtensionAPI);
	const startSession = () => handlers.get("session_start")?.({}, { cwd });
	const compact = () => handlers.get("session_compact")?.({}, { cwd });
	const prompt = () => {
		const systemPromptOptions = { sections: {} as Record<string, string> };
		handlers.get("before_agent_start")?.({ systemPromptOptions }, { cwd });
		return systemPromptOptions.sections[PROJECT_LEARNINGS_TAG];
	};
	const rewrite = (text: string) => writeFileSync(join(cwd, PROJECT_LEARNINGS_PATH), text);
	return { startSession, compact, prompt, rewrite };
}

describe("project learnings", () => {
	it("adds the learnings file as read at session start, and rereads it after compaction", () => {
		const { startSession, compact, prompt, rewrite } = project("- Use perl -pi -e for in-place edits.\n");

		startSession();
		const first = prompt();
		rewrite("- Changed during the session.\n");

		expect(first).toContain("- Use perl -pi -e for in-place edits.");
		expect(prompt()).toBe(first);
		compact();
		expect(prompt()).toContain("- Changed during the session.");
	});

	it("adds nothing when the project has no learnings file", () => {
		const { startSession, prompt } = project();

		startSession();

		expect(prompt()).toBeUndefined();
	});
});
