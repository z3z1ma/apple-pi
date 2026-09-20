import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { registerAgents } from "../src/agent-types.js";
import type { AgentRecord } from "../src/types.js";
import { AgentManagerComponent, openAgentManager } from "../src/ui/agent-manager.js";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

function record(id: string, status: AgentRecord["status"], extra: Partial<AgentRecord> = {}): AgentRecord {
	return {
		id,
		type: "explorer",
		description: `${id} description`,
		status,
		toolUses: 2,
		startedAt: Date.now() - 2_000,
		lifetimeUsage: { input: 800, output: 200, cacheWrite: 0 },
		compactionCount: 0,
		...extra,
	} as AgentRecord;
}

describe("AgentManagerComponent", () => {
	it("renders useful state for public top-level agents only within the available width", () => {
		registerAgents(new Map());
		const records = [
			record("running", "running"),
			record("queued", "queued", { description: "queued description\nsecond line" }),
			record("settled", "completed", { completedAt: Date.now() }),
			record("nested", "running", { parentAgentId: "running" }),
			record("internal", "running", { internalOwner: "system" }),
		];
		const component = new AgentManagerComponent(
			{ terminal: { rows: 30, columns: 120 }, requestRender: vi.fn() } as any,
			theme,
			() => records,
			(id) =>
				id === "running"
					? ({
							activeTools: new Map([["tool", "read"]]),
							toolUses: 2,
							responseText: "",
							turnCount: 3,
							maxTurns: 12,
							lifetimeUsage: { input: 800, output: 200, cacheWrite: 0 },
						} as any)
					: undefined,
			[],
			undefined,
			vi.fn(),
		);

		const lines = component.render(120);
		const text = lines.join("\n");
		expect(text).toContain("running description");
		expect(text).toContain("queued description");
		expect(lines.find((line) => line.includes("queued description"))).not.toContain("(running)");
		expect(text).toContain("settled description");
		expect(text).toContain("reading");
		expect(text).toContain("↻3≤12");
		expect(text).not.toContain("nested description");
		expect(text).not.toContain("internal description");
		for (const line of lines) {
			expect(line).not.toContain("\n");
			expect(visibleWidth(line)).toBeLessThanOrEqual(120);
		}
		component.dispose();
	});

	it("uses configured selection keys and inspects the selected public agent by ID", () => {
		registerAgents(new Map());
		const done = vi.fn();
		const component = new AgentManagerComponent(
			{ terminal: { rows: 30, columns: 80 }, requestRender: vi.fn() } as any,
			theme,
			() => [record("first", "running"), record("second", "queued")],
			() => undefined,
			[],
			"first",
			done,
			{
				matches: (data: string, binding: string) => data === "D" && binding === "tui.select.down",
				getKeys: (binding: string) =>
					binding === "tui.select.up" ? ["ctrl+p"] : binding === "tui.select.down" ? ["ctrl+n"] : [],
			} as any,
		);

		expect(component.render(80).join("\n")).toContain("ctrl+p/ctrl+n select");
		component.handleInput("D");
		component.handleInput("\r");

		expect(done).toHaveBeenCalledWith({ type: "inspect", id: "second" });
		component.dispose();
	});

	it("keeps discovered built-in and Markdown agent types inspectable in the same overlay", () => {
		const tui = { terminal: { rows: 30, columns: 80 }, requestRender: vi.fn() } as any;
		const component = new AgentManagerComponent(
			tui,
			theme,
			() => [],
			() => undefined,
			[
				{ name: "explorer", description: "Quick repository scout" },
				{ name: "release", description: "Project release agent", sourcePath: "/project/.pi/agents/release.md" },
			],
			undefined,
			vi.fn(),
			{
				matches: (data: string, binding: string) => data === "D" && binding === "tui.select.down",
				getKeys: () => [],
			} as any,
		);

		component.handleInput("t");
		component.handleInput("D");
		const text = component.render(80).join("\n");

		expect(text).toContain("release");
		expect(text).toContain("Project release agent");
		expect(text).toContain("/project/.pi/agents/release.md");
		expect(text).toContain("t agents");
		component.dispose();
	});

	it("keeps large live rosters within the terminal height and disposes its refresh timer", () => {
		vi.useFakeTimers();
		const tui = { terminal: { rows: 20, columns: 80 }, requestRender: vi.fn() } as any;
		const component = new AgentManagerComponent(
			tui,
			theme,
			() => Array.from({ length: 30 }, (_, index) => record(`agent-${index}`, "running")),
			() => undefined,
			[],
			undefined,
			vi.fn(),
		);

		expect(component.render(80).length).toBeLessThanOrEqual(16);
		tui.terminal.rows = 4;
		expect(component.render(80).length).toBeLessThanOrEqual(3);
		vi.advanceTimersByTime(500);
		expect(tui.requestRender).toHaveBeenCalled();
		component.dispose();
		tui.requestRender.mockClear();
		vi.advanceTimersByTime(1_000);
		expect(tui.requestRender).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it("returns from conversation detail to the same agent ID after the roster changes", async () => {
		registerAgents(new Map());
		let records = [record("first", "running"), record("second", "running")];
		const renderedSelections: string[] = [];
		let call = 0;
		const ui = {
			custom: async (factory: any) => {
				call++;
				let action: any;
				const component = factory(
					{ terminal: { rows: 30, columns: 100 }, requestRender: vi.fn() },
					theme,
					undefined,
					(result: any) => {
						action = result;
					},
				);
				if (call === 1) {
					component.handleInput("\x1b[B");
					component.handleInput("\r");
				} else {
					renderedSelections.push(component.render(100).find((line: string) => line.startsWith(">")) ?? "");
					component.handleInput("q");
				}
				component.dispose();
				return action;
			},
		};
		const inspect = vi.fn(async () => {
			records = [record("new", "queued"), records[1], records[0]];
		});

		await openAgentManager(ui as any, {
			getRecords: () => records,
			getActivity: () => undefined,
			types: [],
			inspect,
		});

		expect(inspect).toHaveBeenCalledWith(expect.objectContaining({ id: "second" }));
		expect(renderedSelections[0]).toContain("second description");
	});
});
