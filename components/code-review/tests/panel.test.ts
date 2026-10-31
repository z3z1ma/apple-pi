import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { fakeTui, plainTheme } from "../../../tests/helpers/fake-tui.js";
import { ReviewPanel, type ReviewPanelSource } from "../src/panel.js";
import { summaryLines } from "../src/presentation.js";
import type { ReviewSummary } from "../src/results.js";

function review(id: string, state: ReviewSummary["state"]): ReviewSummary {
	return {
		id,
		state,
		owner: "owner",
		ownerName: "Review owner",
		summary: "Check the exported contract",
		phase: null,
		priority: 0,
		revision: 4,
		cwd: "/projects/example",
		target: { kind: "working-tree", base: "HEAD" },
		digest: "captured-digest",
		intent: "not-assessed",
		chunks: 1,
		passes: { completed: 1, required: 2 },
		coverage: { completedQuestions: 1, requiredQuestions: 2, unassignedRegions: 0, additionalRequests: 1 },
		findings: { reported: 2, confirmed: 1, unresolved: 1 },
		approval: null,
		reason: "A consumer check remains unverified",
		createdAt: 1,
		updatedAt: 2,
	};
}

function source(rows: () => ReviewSummary[]): ReviewPanelSource {
	return (options) => {
		const all = rows();
		const index = all.findIndex((row) => row.id === options.around);
		const offset = index >= 0 ? Math.floor(index / options.limit) * options.limit : options.offset;
		const page = all.slice(offset, offset + options.limit);
		const selected = page.find((row) => row.id === options.around) ?? page[0];
		return {
			queue: {
				total: all.length,
				states: {},
				page: { offset, nextOffset: offset + page.length < all.length ? offset + page.length : null, rows: page },
			},
			selected: selected?.id,
			detail: { lines: selected ? summaryLines(selected) : ["No review selected"], nextOffset: null, offset: 0 },
		};
	};
}

const actions = () => ({ close: vi.fn(), unfocus: vi.fn(), menu: vi.fn(), view: vi.fn() });

describe("review queue master-detail", () => {
	it("shows status, partial coverage and findings in the master list and preserves selection across reorder and resize", () => {
		const screen = fakeTui(180, 40);
		let rows = [review("first-review", "running"), review("second-review", "incomplete")];
		rows[1]!.ownerName = "Owner\nwith\tcontrols\x07";
		rows[1]!.reason = "Long evidence ".repeat(30) + "\nAnother line\rcarriage return\x07";
		const panel = new ReviewPanel(
			screen.tui,
			plainTheme,
			source(() => rows),
			actions(),
		);
		let lines = panel.render(160);
		expect(lines.join("\n")).toContain("running");
		expect(lines.join("\n")).toContain("1/2 passes");
		expect(lines.join("\n")).toContain("1 confirmed / 1 unresolved");
		panel.handleInput("\x1b[B");
		expect(panel.getSelectedId()).toBe("second-review");
		rows = [rows[1]!, rows[0]!];
		panel.refresh();
		for (const width of [160, 80, 35, 5]) {
			lines = panel.render(width);
			expect(lines.length).toBeLessThanOrEqual(32);
			for (const line of lines) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				expect(stripVTControlCharacters(line)).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
			}
			expect(panel.getSelectedId()).toBe("second-review");
		}
		expect(panel.render(160).join("\n")).toContain("Intent: not-assessed");
	});

	it("pages the queue using the viewport and keeps evidence and queue keyboard focus distinct", () => {
		const screen = fakeTui(180, 15);
		const rows = Array.from({ length: 12 }, (_, index) => review(`review-${index}`, "completed"));
		const events = actions();
		const panel = new ReviewPanel(
			screen.tui,
			plainTheme,
			source(() => rows),
			events,
		);
		panel.render(160);
		panel.handleInput("]");
		expect(panel.getSelectedId()).toBe("review-3");
		panel.handleInput("\t");
		panel.handleInput("\x1b[B");
		expect(panel.getSelectedId()).toBe("review-3");
		panel.handleInput("v");
		expect(events.view).toHaveBeenCalledWith(rows[3]);
		panel.handleInput("a");
		expect(events.menu).toHaveBeenCalledWith(rows[3]);
		panel.handleInput("\x1b");
		expect(events.unfocus).toHaveBeenCalledOnce();
		panel.handleInput("q");
		expect(events.close).toHaveBeenCalledOnce();
	});

	it("pages evidence separately, scrolls within a page and brings operation outcomes into view", () => {
		const screen = fakeTui(180, 15);
		const row = review("paged-review", "completed");
		const page = source(() => [row]);
		const panel = new ReviewPanel(
			screen.tui,
			plainTheme,
			(options) => ({
				...page(options),
				detail: {
					lines: Array.from(
						{ length: options.detailLimit * 3 },
						(_, index) => `Evidence ${options.detailOffset}: line ${index}`,
					),
					nextOffset: options.detailOffset === 0 ? options.detailLimit : null,
					offset: options.detailOffset,
				},
			}),
			actions(),
		);
		panel.render(160);
		panel.handleInput("\t");
		panel.handleInput("\x1b[6~");
		expect(panel.render(160).join("\n")).toContain("Evidence 0: line 10");
		panel.setNote("Request handle: outcome unknown");
		expect(panel.render(160).join("\n")).toContain("Request handle: outcome unknown");
		panel.setNote("");
		panel.handleInput("]");
		expect(panel.render(160).join("\n")).toContain("Evidence 10: line 0");
		panel.handleInput("]");
		expect(panel.render(160).join("\n")).toContain("Evidence 10: line 0");
		expect(panel.getSelectedId()).toBe(row.id);
	});

	it("does not report a missing store as an empty queue, and permits actions on a genuine empty queue", () => {
		const screen = fakeTui(120, 30);
		const events = actions();
		const missing = new ReviewPanel(
			screen.tui,
			plainTheme,
			() => {
				throw new Error("Review store unavailable");
			},
			events,
		);
		expect(missing.render(100).join("\n")).toContain("Review store unavailable");
		expect(missing.render(100).join("\n")).not.toContain("No recorded reviews");
		const empty = new ReviewPanel(
			screen.tui,
			plainTheme,
			source(() => []),
			events,
		);
		expect(empty.render(100).join("\n")).toContain("No recorded reviews");
		empty.handleInput("a");
		expect(events.menu).toHaveBeenCalledWith(undefined);
	});
});
