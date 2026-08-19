import { describe, expect, it } from "bun:test";
import { estimateTextTokens } from "../src/core/content.js";
import { resolveMaxKeptTokens, resolveSummaryBudgetTokens } from "../src/core/own-cut.js";
import { packBriefSections, packCompiledArtifact, parseBrief } from "../src/core/pack-brief.js";

describe("resolveSummaryBudgetTokens", () => {
	it("is an order of magnitude smaller than keep and capped by leftover overhead", () => {
		const keep200k = resolveMaxKeptTokens({ contextWindow: 200_000 });
		const budget200k = resolveSummaryBudgetTokens({ maxKeptTokens: keep200k, contextWindow: 200_000 });
		expect(keep200k).toBe(67_232);
		expect(budget200k).toBe(6_723);

		const keep1m = resolveMaxKeptTokens({ contextWindow: 1_000_000 });
		const budget1m = resolveSummaryBudgetTokens({ maxKeptTokens: keep1m, contextWindow: 1_000_000 });
		expect(keep1m).toBe(467_232);
		// keep/10 would be 46k; leftover overhead (16k) wins so the summary fits the reserved slice
		expect(budget1m).toBe(16_384);
	});

	it("shrinks to the dropped prefix when that is smaller", () => {
		const budget = resolveSummaryBudgetTokens({
			maxKeptTokens: 67_232,
			contextWindow: 200_000,
			droppedTokens: 800,
		});
		expect(budget).toBe(512);
	});
});

describe("packBriefSections", () => {
	it("keeps everything when under budget", () => {
		const packed = packBriefSections(
			[
				{ header: "[user]", lines: ["do it"] },
				{ header: "[assistant]", lines: ["done"] },
			],
			10_000,
		);
		expect(packed.omitted).toBe(0);
		expect(packed.sections).toHaveLength(2);
	});

	it("pins the first user and drops an oversized result instead of prefix-clipping it", () => {
		const result = "x".repeat(4000);
		const packed = packBriefSections(
			[
				{ header: "[user]", lines: ["investigate auth"] },
				{ header: "[tool_result] Read", lines: [result] },
				{ header: "[assistant]", lines: ["The issue is the session cookie."] },
			],
			200,
		);
		const text = packed.sections.flatMap((s) => [s.header, ...s.lines]).join("\n");
		expect(text).toContain("investigate auth");
		expect(text).toContain("The issue is the session cookie.");
		expect(text).not.toContain("xxx");
		expect(packed.omitted).toBeGreaterThan(0);
	});

	it("fills recent result bodies when they fit", () => {
		const packed = packBriefSections(
			[
				{ header: "[user]", lines: ["go"] },
				{ header: "[tool_result] Read", lines: ["export function login() {}"] },
			],
			10_000,
		);
		expect(packed.sections.some((s) => s.header.startsWith("[tool_result]"))).toBe(true);
		expect(packed.sections.flatMap((s) => s.lines).join("\n")).toContain("export function login");
	});

	it("clips assistant prose as one tail, not per wrapped line", () => {
		const prose = Array.from({ length: 40 }, (_, i) => `Finding ${i} is important.`).join(" ");
		const packed = packBriefSections(
			[
				{ header: "[user]", lines: ["why"] },
				{ header: "[assistant]", lines: [prose] },
			],
			80,
		);
		const assistant = packed.sections.find((s) => s.header === "[assistant]");
		expect(assistant?.lines.join("\n")).toContain("Finding 39");
		expect(assistant?.lines.join("\n")).toContain("...(truncated)");
		expect(assistant?.lines.join("\n")).not.toContain("Finding 0 is important.");
	});
});

describe("packCompiledArtifact", () => {
	it("never exceeds the token budget, including merge-shaped input", () => {
		const users = Array.from({ length: 80 }, (_, i) => `[user]\nmessage ${i}`).join("\n\n");
		const prev = `[Session Goal]\n- goal\n\n---\n\n${users}`;
		const packed = packCompiledArtifact(prev, 200);
		expect(estimateTextTokens(packed)).toBeLessThanOrEqual(200);
		expect(packed).toContain("message 79");
		expect(packed).toContain("earlier entries omitted");
	});

	it("round-trips headers and a short brief", () => {
		const text = "[Session Goal]\n- goal\n\n---\n\n[user]\nhi\n\n[assistant]\nhello";
		expect(packCompiledArtifact(text, 10_000)).toBe(text);
	});

	it("parseBrief rejoins a multi-line user section", () => {
		const sections = parseBrief("[user]\nline one\nline two\n\n[assistant]\nok");
		expect(sections[0]).toEqual({ header: "[user]", lines: ["line one", "line two"] });
	});
});
