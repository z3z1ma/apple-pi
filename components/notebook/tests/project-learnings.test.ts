import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { fauxSession } from "../../../tests/helpers/faux-session.js";
import {
	PROJECT_LEARNINGS_PATH,
	PROJECT_LEARNINGS_TAG,
	registerProjectLearnings,
} from "../src/hooks/project-learnings.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const dispose of cleanup.splice(0)) dispose();
});

async function project(learnings?: string) {
	const cwd = mkdtempSync(join(tmpdir(), "apple-pi-project-learnings-"));
	cleanup.push(() => rmSync(cwd, { recursive: true, force: true }));
	mkdirSync(join(cwd, ".pi"));
	const write = (text: string) => writeFileSync(join(cwd, PROJECT_LEARNINGS_PATH), text);
	if (learnings !== undefined) write(learnings);
	const run = await fauxSession([registerProjectLearnings], [], [], { cwd });
	cleanup.push(run.dispose);
	const sections = (request: number) =>
		(run.requests[request]?.messages ?? []).flatMap((message) =>
			message.role === "system" && message.sections?.[PROJECT_LEARNINGS_TAG]
				? [message.sections[PROJECT_LEARNINGS_TAG]]
				: [],
		);
	return { session: run.session, write, sections };
}

describe("project learnings", () => {
	it("adds the learnings file to the system prompt and appends a later change", async () => {
		const { session, write, sections } = await project("- Use perl -pi -e for in-place edits.\n");

		await session.prompt("First.");
		await session.prompt("Second.");
		write("- Changed during the session.\n");
		await session.prompt("Third.");

		expect(sections(0)).toHaveLength(1);
		expect(sections(0)[0]).toContain("- Use perl -pi -e for in-place edits.");
		expect(sections(1)).toEqual(sections(0));
		expect(sections(2)).toHaveLength(2);
		expect(sections(2)[0]).toBe(sections(0)[0]);
		expect(sections(2)[1]).toContain("- Changed during the session.");
	});

	it("adds nothing when the project has no learnings file", async () => {
		const { session, sections } = await project();

		await session.prompt("Hello.");

		expect(sections(0)).toEqual([]);
	});
});
