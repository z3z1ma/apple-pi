import { describe, expect, it } from "vitest";

import { PAIR_SESSION_EXTENSION_PATHS } from "../components/pair-programmer/src/session.js";
import { childSessionExtensions } from "../components/subagents/src/agent-runner.js";
import { HOME_SEARCH_GUARD_EXTENSION_PATH } from "../extensions/home-search-guard.js";
import { buildAgentCliArgs } from "../extensions/runtime-agent.js";

describe("search root guard integration", () => {
	it("loads the guard in every child-agent session", () => {
		for (const extensions of [
			childSessionExtensions(),
			childSessionExtensions(false, true, true),
			childSessionExtensions(false, false),
		]) {
			expect(extensions.additionalExtensionPaths).toContain(HOME_SEARCH_GUARD_EXTENSION_PATH);
		}
		expect(PAIR_SESSION_EXTENSION_PATHS).toContain(HOME_SEARCH_GUARD_EXTENSION_PATH);
	});

	it("loads the guard in pi_exec workers", () => {
		const args = buildAgentCliArgs({ task: "Inspect the repository" }, { tools: ["read"], projectTrusted: false });
		expect(args.filter((_, index) => args[index - 1] === "--extension")).toContain(HOME_SEARCH_GUARD_EXTENSION_PATH);
	});
});
