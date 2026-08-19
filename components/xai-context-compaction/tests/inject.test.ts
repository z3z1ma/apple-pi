import { describe, expect, it } from "vitest";

import { injectXaiCompaction, payloadHasXaiCompaction } from "../src/inject.js";
import type { XaiCompactionItem } from "../src/types.js";

const xaiResponsesModel = { provider: "xai", api: "openai-responses" };
const compactionItem: XaiCompactionItem = {
	type: "compaction",
	id: "cmp_abc",
	encrypted_content: "enc_xyz",
};

describe("injectXaiCompaction", () => {
	it("injects after a leading developer or system role", () => {
		const result = injectXaiCompaction(
			{
				model: "grok-4.6",
				input: [
					{ role: "developer", content: "You are helpful." },
					{ role: "user", content: "What is quantum mechanics?" },
				],
			},
			xaiResponsesModel,
			compactionItem,
		) as { input: unknown[] };

		expect(result.input).toEqual([
			{ role: "developer", content: "You are helpful." },
			compactionItem,
			{ role: "user", content: "What is quantum mechanics?" },
		]);
	});

	it("injects at index 0 when no developer or system role leads", () => {
		const result = injectXaiCompaction(
			{
				model: "grok-4.6",
				input: [{ role: "user", content: "What is quantum mechanics?" }],
			},
			xaiResponsesModel,
			compactionItem,
		) as { input: unknown[] };

		expect(result.input).toEqual([compactionItem, { role: "user", content: "What is quantum mechanics?" }]);
	});

	it("does not re-inject when the same item is already present", () => {
		const payload = {
			model: "grok-4.6",
			input: [compactionItem, { role: "user", content: "Follow-up" }],
		};
		expect(payloadHasXaiCompaction(payload, compactionItem)).toBe(true);
		expect(injectXaiCompaction(payload, xaiResponsesModel, compactionItem)).toBeUndefined();
	});

	it("does not inject for completions-routed xAI or other providers", () => {
		const payload = { model: "grok-4.6", input: [] };
		expect(
			injectXaiCompaction(payload, { provider: "openai", api: "openai-responses" }, compactionItem),
		).toBeUndefined();
		expect(
			injectXaiCompaction(payload, { provider: "xai", api: "openai-completions" }, compactionItem),
		).toBeUndefined();
	});
});
