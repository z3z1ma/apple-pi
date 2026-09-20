import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { type ActiveWorkSource, ActiveWorkSurface, getActiveWorkSurface } from "../src/active-work.js";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

function source(key: string, label: string, ids: string[]): ActiveWorkSource {
	return {
		key,
		statusKey: key,
		countLabel: label,
		getEntries: () =>
			ids.map((id) => ({
				id,
				render: (width: number) => [`├─ ${id} active work description`.slice(0, width)],
			})),
	};
}

describe("ActiveWorkSurface", () => {
	it("shares one surface between extension installers for the same Pi runtime", () => {
		const pi = {};
		expect(getActiveWorkSurface(pi)).toBe(getActiveWorkSurface(pi));
		expect(getActiveWorkSurface({})).not.toBe(getActiveWorkSurface(pi));
	});

	it("combines domains above the editor and publishes each non-zero active count", () => {
		const surface = new ActiveWorkSurface();
		surface.registerSource(source("subagents", "agents", ["agent-1", "agent-2"]));
		surface.registerSource(source("tasks", "tasks", ["task-1", "task-2"]));
		const setStatus = vi.fn();
		const setWidget = vi.fn();
		let factory: any;
		surface.setUICtx({
			setStatus,
			setWidget: (key, content, options) => {
				setWidget(key, content, options);
				if (content) factory = content;
			},
		});

		expect(setStatus).toHaveBeenCalledWith("subagents", "agents:2");
		expect(setStatus).toHaveBeenCalledWith("tasks", "tasks:2");
		expect(setWidget).toHaveBeenCalledWith("active-work", expect.any(Function), { placement: "aboveEditor" });
		const lines = factory({ terminal: { columns: 30 }, requestRender: vi.fn() }, theme).render();
		expect(lines.join("\n")).toContain("Active work");
		expect(lines.join("\n")).toMatch(/agent-1[\s\S]*task-1[\s\S]*agent-2[\s\S]*task-2/);
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(30);
		surface.clearUI();
	});
});
