import { describe, expect, it, vi } from "vitest";
import { createBackgroundTaskBashTool } from "../src/bash-tool.js";
import { TaskManager } from "../src/task-manager.js";

vi.mock("../src/terminal.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/terminal.js")>()),
	openTerminal: () => {
		throw new Error("no pseudo-terminal available");
	},
}));

describe("Bash without a pseudo-terminal", () => {
	it("runs the command on pipes and says why in the details", async () => {
		const manager = new TaskManager();
		try {
			const result = await createBackgroundTaskBashTool(manager).execute(
				"fallback",
				{ command: "test -t 1 && echo terminal || echo pipe", verbatim: true } as any,
				undefined,
				undefined,
				{ cwd: process.cwd() } as any,
			);
			expect(result.content[0]).toEqual({ type: "text", text: "pipe\n" });
			expect(result.details.terminalUnavailable).toBe("no pseudo-terminal available");
		} finally {
			manager.reset();
		}
	});
});
