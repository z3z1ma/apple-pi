import { describe, expect, it } from "vitest";

import { renderSummary } from "../src/session-ledger/index.js";
import { observation, reflection } from "./fixtures/session.js";

describe("notebook summary rendering", () => {
	it("renders an empty notebook as an empty summary", () => {
		expect(renderSummary([], [])).toBe("");
	});

	it("keeps notebook usage instructions after compaction", () => {
		const ref = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"], { content: "User prefers source-backed notes." });

		const summary = renderSummary([ref], []);

		expect(summary).toContain("Your pair programming partner keeps this sourced notebook");
		expect(summary).toContain("current shared understanding");
		expect(summary).toContain("rather than replaying the notebook as a historical stack");
		expect(summary).toContain("use revisit_note");
		expect(summary).toContain("search_session");
	});

	it("renders reflections with ids", () => {
		const ref = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"], { content: "User prefers source-backed notes." });

		const summary = renderSummary([ref], []);

		expect(summary).toContain("## Reflections\n[eeeeeeeeeeee] User prefers source-backed notes.");
	});

	it("renders observations with ids, timestamps, relevance, and content", () => {
		const obs = observation("aaaaaaaaaaaa", {
			content: "User confirmed recall should use exact source entry ids.",
			timestamp: "2026-05-02 10:30",
			relevance: "high",
		});

		const summary = renderSummary([], [obs]);

		expect(summary).toContain(
			"## Observations\n[aaaaaaaaaaaa] 2026-05-02 10:30 [high] User confirmed recall should use exact source entry ids.",
		);
	});

	it("keeps raw provenance metadata out of the compact summary", () => {
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["entry-user", "entry-tool"] });
		const ref = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"]);

		const summary = renderSummary([ref], [obs]);

		expect(summary).not.toContain("sourceEntryIds");
		expect(summary).not.toContain("supportingObservationIds");
		expect(summary).not.toContain("entry-user");
		expect(summary).not.toContain("entry-tool");
		expect(summary).not.toContain("[object Object]");
	});
});
