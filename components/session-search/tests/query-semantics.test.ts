import type { Message } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { renderMessage } from "../src/render-entries.js";
import { searchEntries } from "../src/search-entries.js";

const run = (texts: string[], query: string) => {
	const messages = texts.map((content) => ({ role: "user", content }) as Message);
	return searchEntries(
		messages.map((message, i) => renderMessage(message, i)),
		messages,
		query,
	);
};

describe("predictable query semantics", () => {
	it("treats paths and metacharacters literally unless regex is explicit", () => {
		expect(run(["alpha.ts", "alphaXts"], "alpha.ts").map((hit) => hit.index)).toEqual([0]);
		expect(run(["foo|bar", "foo", "bar"], "foo|bar").map((hit) => hit.index)).toEqual([0]);
		expect(run(["alpha.ts", "alphaXts"], "regex:alpha.ts")).toHaveLength(2);
		expect(run(["foo", "bar"], "regex:foo|bar")).toHaveLength(2);
	});

	it("ranks all regex matches rather than stopping before recent strong evidence", () => {
		const texts = [...Array(75).fill("needle weak context"), "needle needle needle"];
		const hits = run(texts, "regex:needle");
		expect(hits).toHaveLength(76);
		expect(hits[0].index).toBe(75);
		expect(hits.map((hit) => hit.index)).toEqual(run(texts, "needle").map((hit) => hit.index));
	});

	it("reports malformed explicit regex and keeps unsafe regex bounded", () => {
		expect(() => run(["foo"], "regex:[")).toThrow(/Invalid regex/);
		expect(() => run(["foo"], "regex:(a+)+$")).toThrow(/Unsafe regex/);
		expect(run(["x".repeat(20_000)], "regex:x.*y")).toEqual([]);
	});

	it("preserves complete literal identifiers rather than truncating long terms", () => {
		const needle = `${"a".repeat(300)}z`;
		expect(run(["a".repeat(300), needle], needle).map((hit) => hit.index)).toEqual([1]);
	});
});
