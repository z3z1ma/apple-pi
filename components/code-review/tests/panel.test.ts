import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { fakeTui, plainTheme } from "../../../tests/helpers/fake-tui.js";
import { CaptureConfirmation, ReviewPanel, type ReviewPanelSource } from "../src/panel.js";
import { costLabel, findingLines, summaryLines } from "../src/presentation.js";
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
		cost: { reportedDollars: 1.2, reportedAttempts: 4, totalAttempts: 5 },
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
			detail: {
				title: "Summary",
				lines: selected ? summaryLines(selected) : ["No review selected"],
				nextOffset: null,
				offset: 0,
			},
		};
	};
}

const actions = () => ({ close: vi.fn(), unfocus: vi.fn(), menu: vi.fn(), view: vi.fn() });

it("labels reported cost without hiding missing attempts or rounding small positive cost to zero", () => {
	expect(costLabel({ reportedDollars: 0, reportedAttempts: 0, totalAttempts: 0 })).toBe("no attempts");
	expect(costLabel({ reportedDollars: null, reportedAttempts: 0, totalAttempts: 2 })).toBe(
		"unavailable (0/2 reported)",
	);
	expect(costLabel({ reportedDollars: 0.001, reportedAttempts: 1, totalAttempts: 2 })).toBe("<$0.01 (1/2 reported)");
	const item = review("cost-review", "completed");
	expect(summaryLines(item)).toContain("Primary-turn cost: $1.20 (4/5 reported)");
	const panel = new ReviewPanel(
		fakeTui(180, 40).tui,
		plainTheme,
		source(() => [item]),
		actions(),
	);
	expect(panel.render(160).join("\n")).toContain("$1.20 (4/5 reported)");
});

it("leads finding evidence with the allegation and keeps validation and later claims distinct", () => {
	const lines = findingLines({
		id: "attempt:finding",
		attempt: "attempt",
		pass: "correctness",
		finding: {
			id: "finding",
			title: "Recorded policy differs",
			path: "worker.ts",
			line: 20,
			side: "after",
			severity: "medium",
			certainty: "probable",
			trigger: "Change policy between turns",
			invariant: "Selected policies agree",
			impact: "Incorrect coverage",
			cause: "No cross-pass comparison",
			correction: "Bind the recorded policies",
			evidence: [{ kind: "source", detail: "The policies differ", provenance: "captured worker.ts:20" }],
			counterevidence: "Within-turn checks work",
		},
		validation: null,
		decision: {
			id: "response",
			kind: "finding",
			finding: "attempt:finding",
			review: "review",
			digest: "digest",
			revision: 2,
			actor: "owner",
			createdAt: 1,
			data: {
				disposition: "fixed-claimed",
				reason: "Later source changed",
				evidence: ["A local regression passes"],
				verifiedAgainst: null,
			},
		},
	});
	expect(lines[0]).toBe("[medium] Recorded policy differs");
	expect(lines).toContain("Validation: not yet validated");
	expect(lines).toContain("Owner response: fixed-claimed");
	for (const text of [
		"Incorrect coverage",
		"No cross-pass comparison",
		"Within-turn checks work",
		"captured worker.ts:20",
		"A local regression passes",
		"attempt:finding",
	])
		expect(lines.join("\n")).toContain(text);
});

it("keeps capture consent visible while long evidence scrolls, and refuses unreadable tiny layouts", () => {
	const screen = fakeTui(80, 24);
	const done = vi.fn();
	const confirmation = new CaptureConfirmation(
		screen.tui,
		plainTheme,
		[
			`Source path\x07 ${"long path ".repeat(50)}`,
			`Exact digest: ${"a".repeat(64)}`,
			"Final cost and identity warning",
		],
		done,
	);
	for (const width of [80, 35, 24]) {
		const lines = confirmation.render(width);
		expect(lines.length).toBeLessThanOrEqual(Math.floor(screen.tui.terminal.rows * 0.8));
		expect(lines[0]).toContain("Capture preview");
		expect(lines.at(-2)).toContain("y queue  Esc cancel");
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			expect(stripVTControlCharacters(line)).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
		}
	}
	confirmation.handleInput("\x1b[F");
	expect(confirmation.render(80).join("\n")).toContain("Final cost and identity warning");
	confirmation.render(5);
	confirmation.handleInput("y");
	expect(done).not.toHaveBeenCalled();
	confirmation.render(80);
	confirmation.handleInput("y");
	expect(done).toHaveBeenCalledWith(true);
	confirmation.handleInput("\x1b");
	expect(done).toHaveBeenCalledWith(false);
});

describe("review queue master-detail", () => {
	it("frames both panes, exposes focus and actions, and colors status without treating completion as approval", () => {
		const screen = fakeTui(180, 40);
		const rows = [
			review("completed-review", "completed"),
			review("failed-review", "failed"),
			review("running-review", "running"),
		];
		const theme = {
			fg: vi.fn((_color: string, text: string) => `\x1b[36m${text}\x1b[39m`),
			bg: (_color: string, text: string) => `\x1b[48;5;235m${text}\x1b[49m`,
			bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
		};
		const panel = new ReviewPanel(
			screen.tui,
			theme,
			source(() => rows),
			actions(),
		);
		panel.focused = true;
		let lines = panel.render(160);
		expect(lines.map(stripVTControlCharacters).join("\n")).toContain("> Queue");
		expect(theme.fg).toHaveBeenCalledWith("error", expect.stringContaining("failed"));
		expect(theme.fg).toHaveBeenCalledWith("warning", expect.stringContaining("1 confirmed"));
		expect(theme.fg).not.toHaveBeenCalledWith("success", expect.stringContaining("completed"));
		panel.handleInput("\t");
		expect(panel.render(160).map(stripVTControlCharacters).join("\n")).toContain("> Summary");
		const click = (y: number) =>
			panel.handleMouse({
				type: "press",
				button: "left",
				x: 3,
				y,
				screenX: 3,
				screenY: y,
				width: 160,
				height: 32,
				shift: false,
				alt: false,
				ctrl: false,
			});
		click(7);
		expect(panel.getSelectedId()).toBe("failed-review");
		panel.handleInput("\t");
		click(2);
		expect(panel.render(160).map(stripVTControlCharacters).join("\n")).toContain("> Queue");
		expect(panel.getSelectedId()).toBe("failed-review");
		for (const width of [160, 100, 90, 35]) {
			lines = panel.render(width);
			expect(lines).toHaveLength(32);
			for (const line of lines) expect(visibleWidth(line)).toBe(width);
			const text = lines.map(stripVTControlCharacters).join("\n");
			expect(text).toContain("a actions");
			expect(text).toContain("q close");
			expect(text).toContain("not signed off");
		}
		rows.length = 0;
		panel.refresh();
		lines = panel.render(160);
		expect(lines.map(stripVTControlCharacters).join("\n")).toContain("No recorded reviews.");
		for (const line of lines) expect(visibleWidth(line)).toBe(160);
	});

	it("shows status, partial coverage and findings in the master list and preserves selection across reorder and resize", () => {
		const screen = fakeTui(180, 40);
		let rows = [review("first-review", "running"), review("second-review", "incomplete")];
		rows[1]!.ownerName = "Owner\nwith\tcontrols\x07";
		rows[1]!.reason = `${"Long evidence ".repeat(30)}\nAnother line\rcarriage return\x07`;
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
		const read = vi.fn(source(() => rows));
		const panel = new ReviewPanel(screen.tui, plainTheme, read, events);
		panel.render(160);
		const pageSize = read.mock.lastCall![0].limit;
		panel.handleInput("]");
		expect(panel.getSelectedId()).toBe(rows[pageSize]!.id);
		panel.handleInput("\t");
		panel.handleInput("\x1b[B");
		expect(panel.getSelectedId()).toBe(rows[pageSize]!.id);
		panel.handleInput("v");
		expect(events.view).toHaveBeenCalledWith(rows[pageSize]);
		panel.handleInput("a");
		expect(events.menu).toHaveBeenCalledWith(rows[pageSize]);
		panel.handleInput("\x1b");
		expect(events.unfocus).toHaveBeenCalledOnce();
		panel.handleInput("q");
		expect(events.close).toHaveBeenCalledOnce();
	});

	it("pages evidence separately, scrolls within a page and brings operation outcomes into view", () => {
		const screen = fakeTui(180, 15);
		const row = review("paged-review", "completed");
		const page = vi.fn(source(() => [row]));
		const panel = new ReviewPanel(
			screen.tui,
			plainTheme,
			(options) => ({
				...page(options),
				detail: {
					title: "Findings",
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
		const detailSize = page.mock.lastCall![0].detailLimit;
		panel.handleInput("\t");
		panel.handleInput("\x1b[6~");
		expect(panel.render(160).join("\n")).toContain(`Evidence 0: line ${detailSize}`);
		panel.setNote("Request handle: outcome unknown");
		expect(panel.render(160).join("\n")).toContain("Request handle: outcome unknown");
		panel.setNote("");
		panel.handleInput("]");
		expect(panel.render(160).join("\n")).toContain(`Evidence ${detailSize}: line 0`);
		panel.handleInput("]");
		expect(panel.render(160).join("\n")).toContain(`Evidence ${detailSize}: line 0`);
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
