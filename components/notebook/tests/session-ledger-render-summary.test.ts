import { describe, expect, it } from "vitest";

import { renderSummary } from "../src/session-ledger/index.js";
import { observation, reflection } from "./fixtures/session.js";

describe("notebook summary rendering", () => {
	it("renders an empty notebook as an empty summary", () => {
		expect(renderSummary([])).toBe("");
	});

	it("keeps notebook usage instructions after compaction", () => {
		const ref = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"], { content: "User prefers source-backed notes." });

		const summary = renderSummary([ref]);

		expect(summary).toContain("User direction and current evidence take precedence");
		expect(summary).toContain("revisable, scoped understandings");
		expect(summary).toContain("use revisit_note");
		expect(summary).toContain("search_session");
		expect(summary).not.toContain("Current law");
	});

	it("renders working conclusions with ids and omits observations", () => {
		const ref = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"], { content: "User prefers source-backed notes." });
		const obs = observation("aaaaaaaaaaaa", {
			content: "User confirmed recall should use exact source entry ids.",
			timestamp: "2026-05-02 10:30",
			relevance: "high",
		});

		const summary = renderSummary([ref]);

		expect(summary).toContain("## Working conclusions\n[eeeeeeeeeeee] User prefers source-backed notes.");
		expect(summary).not.toContain(obs.content);
		expect(summary).not.toContain("## Observations");
	});

	it("keeps raw provenance metadata out of the compact summary", () => {
		const ref = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"], { sourceEntryIds: ["entry-user", "entry-tool"] });

		const summary = renderSummary([ref]);

		expect(summary).not.toContain("sourceEntryIds");
		expect(summary).not.toContain("supportingObservationIds");
		expect(summary).not.toContain("entry-user");
		expect(summary).not.toContain("entry-tool");
		expect(summary).not.toContain("[object Object]");
	});
});
