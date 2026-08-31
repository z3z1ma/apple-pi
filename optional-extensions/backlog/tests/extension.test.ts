import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { installBacklog } from "../src/index.js";
import { BACKLOG_STATE_ENTRY } from "../src/state.js";

type RegisteredTool = {
	name: string;
	executionMode?: string;
	execute: (...args: unknown[]) => Promise<{
		content: Array<{ type: string; text: string }>;
		details?: unknown;
	}>;
};

describe("backlog extension", () => {
	it("creates an item from the human backlog manager", async () => {
		const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
		const appendEntry = vi.fn();
		const custom = vi.fn().mockResolvedValueOnce({ type: "create" }).mockResolvedValueOnce({ type: "close" });
		const editor = vi.fn().mockResolvedValueOnce("Human note").mockResolvedValueOnce("Remember this later");
		const pi = {
			appendEntry,
			on: vi.fn(),
			registerTool: vi.fn(),
			registerCommand(name: string, command: { handler: (args: string, ctx: any) => Promise<void> }) {
				commands.set(name, command);
			},
		} as unknown as ExtensionAPI;

		installBacklog(pi);
		await commands.get("backlog")?.handler("", {
			mode: "tui",
			ui: { custom, editor, setStatus: vi.fn(), notify: vi.fn() },
		});

		expect(editor).toHaveBeenNthCalledWith(1, "Backlog title", "");
		expect(editor).toHaveBeenNthCalledWith(2, "Backlog description", "");
		expect(appendEntry).toHaveBeenCalledWith(
			BACKLOG_STATE_ENTRY,
			expect.objectContaining({
				nextId: 2,
				items: [expect.objectContaining({ id: 1, title: "Human note", description: "Remember this later" })],
			}),
		);
	});

	it("keeps human-manager state and status unchanged when persistence fails", async () => {
		const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
		const tools = new Map<string, RegisteredTool>();
		const appendEntry = vi.fn(() => {
			throw new Error("disk full");
		});
		const setStatus = vi.fn();
		const pi = {
			appendEntry,
			on: vi.fn(),
			registerTool(tool: RegisteredTool) {
				tools.set(tool.name, tool);
			},
			registerCommand(name: string, command: { handler: (args: string, ctx: any) => Promise<void> }) {
				commands.set(name, command);
			},
		} as unknown as ExtensionAPI;
		installBacklog(pi);
		await commands.get("backlog")?.handler("", {
			mode: "tui",
			ui: {
				custom: vi.fn().mockResolvedValueOnce({ type: "create" }).mockResolvedValueOnce({ type: "close" }),
				editor: vi.fn().mockResolvedValueOnce("Human note").mockResolvedValueOnce("later"),
				setStatus,
				notify: vi.fn(),
			},
		});
		const listed = await tools.get("backlog_list")?.execute("call-1", {});
		expect(listed?.content[0]?.text).toBe("The session backlog is empty.");
		expect(setStatus).not.toHaveBeenCalled();
	});

	it("keeps state unpublished when persistence fails", async () => {
		const tools = new Map<string, RegisteredTool>();
		const pi = {
			appendEntry: vi.fn(() => {
				throw new Error("disk full");
			}),
			on: vi.fn(),
			registerTool(tool: RegisteredTool) {
				tools.set(tool.name, tool);
			},
			registerCommand: vi.fn(),
		} as unknown as ExtensionAPI;
		installBacklog(pi);

		await expect(
			tools.get("backlog_add")?.execute("call-1", { title: "Follow up" }, undefined, undefined, {
				ui: { setStatus: vi.fn() },
			}),
		).rejects.toThrow("disk full");
		const listed = await tools.get("backlog_list")?.execute("call-2", {});
		expect(listed?.content[0]?.text).toBe("The session backlog is empty.");
	});

	it("registers add/read/take tools, publishes the count, and persists mutations", async () => {
		const tools = new Map<string, RegisteredTool>();
		const commands = new Map<string, unknown>();
		const handlers = new Map<string, (...args: unknown[]) => unknown>();
		const appendEntry = vi.fn();
		const setStatus = vi.fn();
		const ctx = {
			sessionManager: { getBranch: () => [] },
			ui: { setStatus },
		};
		const pi = {
			appendEntry,
			on(name: string, handler: (...args: unknown[]) => unknown) {
				handlers.set(name, handler);
			},
			registerTool(tool: RegisteredTool) {
				tools.set(tool.name, tool);
			},
			registerCommand(name: string, command: unknown) {
				commands.set(name, command);
			},
		} as unknown as ExtensionAPI;

		installBacklog(pi);
		expect([...tools.keys()]).toEqual(["backlog_add", "backlog_list", "backlog_take"]);
		expect(commands.has("backlog")).toBe(true);
		expect(tools.get("backlog_add")?.executionMode).toBe("sequential");
		expect(tools.get("backlog_take")?.executionMode).toBe("sequential");

		await handlers.get("session_start")?.({}, ctx);
		expect(setStatus).toHaveBeenLastCalledWith("backlog", undefined);
		const add = tools.get("backlog_add");
		expect(add).toBeDefined();
		const added = await add?.execute("call-1", { title: "Follow up", description: "Later" }, undefined, undefined, ctx);
		expect(added?.content[0]?.text).toBe("Backlogged #1: Follow up");
		expect(appendEntry).toHaveBeenCalledWith(
			BACKLOG_STATE_ENTRY,
			expect.objectContaining({ nextId: 2, items: [expect.objectContaining({ id: 1, title: "Follow up" })] }),
		);

		expect(setStatus).toHaveBeenLastCalledWith("backlog", "backlog 1");
		const listed = await tools.get("backlog_list")?.execute("call-2", {});
		expect(listed?.content[0]?.text).toContain("#1 Follow up");
		expect(listed?.content[0]?.text).toContain("Later");

		const taken = await tools.get("backlog_take")?.execute("call-3", { id: 1 }, undefined, undefined, ctx);
		expect(taken?.content[0]?.text).toBe("Removed #1 from the backlog: Follow up");
		expect(setStatus).toHaveBeenLastCalledWith("backlog", undefined);
		expect(appendEntry).toHaveBeenLastCalledWith(
			BACKLOG_STATE_ENTRY,
			expect.objectContaining({ nextId: 2, items: [] }),
		);

		const empty = await tools.get("backlog_list")?.execute("call-4", {});
		expect(empty?.content[0]?.text).toBe("The session backlog is empty.");
	});
});
