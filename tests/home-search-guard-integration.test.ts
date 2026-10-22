import { describe, expect, it } from "vitest";
import { buildInternCliArgs } from "../components/interns/src/runner.js";
import { PAIR_SESSION_EXTENSION_PATHS } from "../components/pair-programmer/src/session.js";
import { HOME_SEARCH_GUARD_EXTENSION_PATH } from "../extensions/home-search-guard.js";

describe("search root guard integration", () => {
	it("keeps the trajectory-only pair session free of repository extensions", () => {
		expect(PAIR_SESSION_EXTENSION_PATHS).toEqual([]);
	});

	it("loads the guard in one-shot interns", () => {
		const args = buildInternCliArgs("explore", "Inspect the repository", {
			projectTrusted: false,
			model: "provider/model",
			thinking: "off",
		});
		expect(args.filter((_, index) => args[index - 1] === "--extension")).toContain(HOME_SEARCH_GUARD_EXTENSION_PATH);
	});
});
