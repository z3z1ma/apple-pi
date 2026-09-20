import { describe, expect, it, vi } from "vitest";
import { registerAgents } from "../src/agent-types.js";
import { renderRunningAgentStatus } from "../src/index.js";
import {
	type AgentActivity,
	AgentWidget,
	fgPreservingNestedStyles,
	formatSessionTokens,
} from "../src/ui/agent-widget.js";

describe("formatSessionTokens", () => {
	const theme = { fg: (c: string, s: string) => `<${c}>${s}</${c}>`, bold: (s: string) => s };
	const ansiTheme = {
		fg: (c: string, s: string) => {
			const codes: Record<string, string> = { dim: "2", warning: "33", accent: "35" };
			return `\u001b[${codes[c] ?? "31"}m${s}\u001b[39m`;
		},
		bold: (s: string) => s,
	};

	it("applies threshold colors (<70 dim, 70–85 warning, ≥85 error)", () => {
		expect(formatSessionTokens(1234, null, theme)).toBe("1.2k token");
		expect(formatSessionTokens(1234, 50, theme)).toBe("1.2k token (<dim>50%</dim>)");
		expect(formatSessionTokens(1234, 70, theme)).toBe("1.2k token (<warning>70%</warning>)");
		expect(formatSessionTokens(1234, 84, theme)).toBe("1.2k token (<warning>84%</warning>)");
		expect(formatSessionTokens(1234, 85, theme)).toBe("1.2k token (<error>85%</error>)");
		expect(formatSessionTokens(1234, 99, theme)).toBe("1.2k token (<error>99%</error>)");
	});

	it("annotates compaction count alongside percent", () => {
		// compactions only (e.g. immediately post-compaction, percent null)
		expect(formatSessionTokens(1234, null, theme, 1)).toBe("1.2k token (<dim>⇊1</dim>)");
		expect(formatSessionTokens(1234, null, theme, 3)).toBe("1.2k token (<dim>⇊3</dim>)");
		// percent + compactions, joined with ` · `
		expect(formatSessionTokens(1234, 45, theme, 2)).toBe("1.2k token (<dim>45%</dim> · <dim>⇊2</dim>)");
		expect(formatSessionTokens(1234, 88, theme, 4)).toBe("1.2k token (<error>88%</error> · <dim>⇊4</dim>)");
		// compactions=0 omitted
		expect(formatSessionTokens(1234, 45, theme, 0)).toBe("1.2k token (<dim>45%</dim>)");
	});

	it("preserves the outer style after nested annotation styles reset", () => {
		const tokenText = formatSessionTokens(1234, 70, ansiTheme);

		expect(fgPreservingNestedStyles(ansiTheme, "accent", tokenText)).toBe(
			"\u001b[35m1.2k token (\u001b[33m70%\u001b[39m\u001b[35m)\u001b[39m",
		);
	});
});

describe("renderRunningAgentStatus", () => {
	it("renders running status as separate component lines", () => {
		const theme = { fg: (_c: string, s: string) => s };
		const component = renderRunningAgentStatus("⠋", "thinking: xhigh · 4 tool uses", "thinking…", theme);

		expect(component.render(120).map((line) => line.trimEnd())).toEqual([
			"⠋ thinking: xhigh · 4 tool uses",
			"  ⎿  thinking…",
		]);
	});
});

describe("AgentWidget", () => {
	const theme = { fg: (_c: string, s: string) => s, bold: (s: string) => s };

	function makeActivity(): AgentActivity {
		return {
			activeTools: new Map(),
			toolUses: 0,
			responseText: "",
			turnCount: 1,
			lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
		};
	}

	function makeRecord(id: string, opts: { isBackground?: boolean; parentAgentId?: string } = {}) {
		return {
			id,
			type: "explorer",
			description: `${id} description`,
			status: "running",
			toolUses: 0,
			startedAt: Date.now(),
			lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
			compactionCount: 0,
			isBackground: opts.isBackground,
			parentAgentId: opts.parentAgentId,
		};
	}

	/** Render the widget for a manager and return the produced lines ("" if nothing rendered). */
	function renderLines(manager: unknown, activityId: string): string {
		const widget = new AgentWidget(manager as any, new Map([[activityId, makeActivity()]]));
		let factory: any;
		widget.setUICtx({
			setStatus: () => {},
			setWidget: (_key, content) => {
				factory = content;
			},
		});
		widget.update();
		if (!factory) return "";
		return factory({ terminal: { columns: 120 }, requestRender: () => {} }, theme)
			.render()
			.join("\n");
	}

	it("shows every active public top-level agent", () => {
		registerAgents(new Map());
		const manager = {
			listAgents: () => [
				makeRecord("foreground", { isBackground: false }),
				makeRecord("background", { isBackground: true }),
				makeRecord("unflagged"),
			],
		};
		const lines = renderLines(manager, "foreground");
		expect(lines).toContain("foreground description");
		expect(lines).toContain("background description");
		expect(lines).toContain("unflagged description");
	});

	it("hides nested children", () => {
		const manager = {
			listAgents: () => [makeRecord("nested", { isBackground: true, parentAgentId: "parent" })],
		};
		expect(renderLines(manager, "nested")).toBe("");
	});

	it("moves the complete active projection when the UI context is replaced", () => {
		const running = makeRecord("running", { isBackground: true });
		const widget = new AgentWidget({ listAgents: () => [running] } as any, new Map());
		const first = { setStatus: vi.fn(), setWidget: vi.fn() };
		const second = { setStatus: vi.fn(), setWidget: vi.fn() };

		widget.setUICtx(first);
		widget.update();
		widget.setUICtx(second);

		expect(first.setWidget).toHaveBeenLastCalledWith("active-work", undefined);
		expect(first.setStatus).toHaveBeenLastCalledWith("subagents", undefined);
		expect(second.setWidget).toHaveBeenCalledWith("active-work", expect.any(Function), { placement: "aboveEditor" });
		expect(second.setStatus).toHaveBeenCalledWith("subagents", "agents:1");
		widget.dispose();
	});

	it("clears an invalidated widget when its last active agent settles", () => {
		const running = makeRecord("running", { isBackground: true });
		const widget = new AgentWidget({ listAgents: () => [running] } as any, new Map());
		const setWidget = vi.fn();
		let factory: any;
		widget.setUICtx({
			setStatus: vi.fn(),
			setWidget: (_key, content, options) => {
				setWidget(_key, content, options);
				if (content) factory = content;
			},
		});
		factory({ terminal: { columns: 120 }, requestRender: () => {} }, theme).invalidate();

		running.status = "completed";
		(running as any).completedAt = Date.now();
		widget.update();

		expect(setWidget).toHaveBeenLastCalledWith("active-work", undefined, undefined);
		widget.dispose();
	});

	it("publishes the active count and renders only running or queued agent identities above the editor", () => {
		const running = makeRecord("running", { isBackground: true });
		const queued = { ...makeRecord("queued", { isBackground: true }), status: "queued" };
		const completed = {
			...makeRecord("completed", { isBackground: true }),
			status: "completed",
			completedAt: Date.now(),
		};
		const records = [running, queued, completed];
		const manager = { listAgents: () => records };
		const widget = new AgentWidget(manager as any, new Map([[running.id, makeActivity()]]));
		const statuses: Array<[string, string | undefined]> = [];
		const widgets: Array<[string, unknown, unknown]> = [];
		let factory: any;
		widget.setUICtx({
			setStatus: (key, text) => statuses.push([key, text]),
			setWidget: (key, content, options) => {
				widgets.push([key, content, options]);
				factory = content;
			},
		});

		widget.update();
		const lines = factory({ terminal: { columns: 120 }, requestRender: () => {} }, theme)
			.render()
			.join("\n");
		expect(statuses.at(-1)).toEqual(["subagents", "agents:2"]);
		expect(widgets.at(-1)?.slice(0, 1)).toEqual(["active-work"]);
		expect(widgets.at(-1)?.[2]).toEqual({ placement: "aboveEditor" });
		expect(lines).toContain("Active work");
		expect(lines).toContain("running description");
		expect(lines).toContain("queued description");
		expect(lines).not.toContain("completed description");

		running.status = "completed";
		(running as any).completedAt = Date.now();
		queued.status = "stopped";
		(queued as any).completedAt = Date.now();
		widget.update();
		expect(statuses.at(-1)).toEqual(["subagents", undefined]);
		expect(widgets.at(-1)?.slice(0, 2)).toEqual(["active-work", undefined]);
		widget.dispose();
	});
});

// The widget caps itself at MAX_WIDGET_LINES (12) and, past that, hands out a
// line budget in priority order: running pairs, then the queued summary, then
// finished lines. Running and finished increment `hiddenRunning`/`hiddenFinished`
// when they don't fit; the queued line is dropped with NO counter at all, so the
// footer under-reports and — worse — the queue vanishes from the UI entirely.
// That happens exactly when the concurrency limit is saturated, i.e. when the
// queue is the thing the user most needs to see.
describe("AgentWidget overflow accounting", () => {
	const theme = { fg: (_c: string, s: string) => s, bold: (s: string) => s };

	function record(id: string, status: string) {
		return {
			id,
			type: "explorer",
			description: `${id} description`,
			status,
			toolUses: 0,
			startedAt: Date.now(),
			completedAt: status === "completed" ? Date.now() : undefined,
			lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
			compactionCount: 0,
			isBackground: true,
		};
	}

	/** Render a mixed set of agent statuses and return the active projection. */
	function renderActiveWork(counts: { running: number; queued: number; finished: number }): string[] {
		const agents = [
			...Array.from({ length: counts.running }, (_, i) => record(`run${i}`, "running")),
			...Array.from({ length: counts.queued }, (_, i) => record(`q${i}`, "queued")),
			...Array.from({ length: counts.finished }, (_, i) => record(`fin${i}`, "completed")),
		];
		const activity = new Map(
			agents.map((a) => [
				a.id,
				{
					activeTools: new Map(),
					toolUses: 0,
					responseText: "",
					turnCount: 1,
					lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
				} as AgentActivity,
			]),
		);
		const widget = new AgentWidget({ listAgents: () => agents } as any, activity);
		let factory: any;
		widget.setUICtx({
			setStatus: () => {},
			setWidget: (_k: string, c: any) => {
				factory = c;
			},
		} as any);
		widget.update();
		if (!factory) return [];
		return factory({ terminal: { columns: 200 }, requestRender: () => {} }, theme).render();
	}

	/** The `+N more (…)` footer, if the widget overflowed. */
	const footer = (lines: string[]) => lines.find((line) => line.includes("more active"));

	/** Every relevant status mix — swept, not sampled. */
	const SHAPES: { running: number; queued: number; finished: number }[] = [];
	for (let running = 0; running <= 8; running++)
		for (let queued = 0; queued <= 8; queued++)
			for (let finished = 0; finished <= 8; finished++) SHAPES.push({ running, queued, finished });

	// Swept rather than sampled: reserving the queued row moves `budget` around by
	// hand, and an off-by-one there overflows the cap only for specific shapes.
	it("never exceeds the line cap, for any status mix", () => {
		for (const counts of SHAPES) {
			expect(renderActiveWork(counts).length, JSON.stringify(counts)).toBeLessThanOrEqual(12);
		}
	});

	it("reports exactly how many active agents are hidden", () => {
		for (const counts of SHAPES) {
			const lines = renderActiveWork(counts);
			const f = footer(lines);
			const body = lines.join("\n");
			const activeIds = [
				...Array.from({ length: counts.running }, (_, index) => `run${index}`),
				...Array.from({ length: counts.queued }, (_, index) => `q${index}`),
			];
			const hidden = activeIds.filter((id) => !body.includes(`${id} description`)).length;
			const reported = f ? Number(/\+(\d+) more active/.exec(f)?.[1] ?? -1) : 0;
			expect(reported, `${JSON.stringify(counts)} → ${f ?? "no footer"}`).toBe(hidden);
		}
	});

	it("renders queued identities and excludes settled identities", () => {
		const lines = renderActiveWork({ running: 2, queued: 1, finished: 1 });
		const body = lines.join("\n");
		expect(body).toContain("q0 description");
		expect(body).toContain("queued");
		expect(body).not.toContain("fin0 description");
		expect(footer(lines)).toBeUndefined();
	});
});
