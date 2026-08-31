import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { installTodos, promptTodoFields } from "../src/installer.js";

describe("todo manager field mapping", () => {
	it("maps optional execution fields and preserves explicit clearing", async () => {
		const answers = ["Updated", "Context", "Running", "builder", "coding"];
		const fields = await promptTodoFields({
			editor: async () => answers.shift(),
		});
		expect(fields).toEqual({
			title: "Updated",
			description: "Context",
			activeForm: "Running",
			agentType: "builder",
			agentProfile: "coding",
		});
		const cleared = await promptTodoFields(
			{ editor: async (label) => (label === "Todo title" ? "Keep" : "") },
			{ title: "Old", activeForm: "Old form", agentType: "explorer", agentProfile: "quick" },
		);
		expect(cleared).toMatchObject({ title: "Keep", activeForm: "", agentType: "", agentProfile: "" });
	});
});

describe("todos extension", () =>
	it("registers CRUD tools with valid results and snapshots only mutations", async () => {
		const tools: any[] = [];
		const appendEntry = vi.fn();
		const pi = {
			on: vi.fn(),
			appendEntry,
			registerTool: (x: any) => tools.push(x),
			registerCommand: vi.fn(),
		};
		installTodos(pi as any);
		expect(tools.map((x) => x.name)).toEqual([
			"todo_create",
			"todo_list",
			"todo_get",
			"todo_update",
			"todo_delete",
			"todo_execute",
			"todo_output",
			"todo_stop",
		]);
		const byName = (name: string) => tools.find((tool) => tool.name === name);
		const created = await byName("todo_create").execute("call", {
			title: "one",
			description: "full context",
			agent_type: "builder",
			profile: "coding",
			active_form: "Creating",
		});
		expect(created.content[0].text).toContain("Created #1");
		expect(created.details).toMatchObject({
			agentType: "builder",
			agentProfile: "coding",
			activeForm: "Creating",
		});
		expect(appendEntry).toHaveBeenCalledTimes(1);
		const dependent = await byName("todo_create").execute("call", {
			title: "dependent",
			blocked_by: [1],
		});
		expect(dependent.details).toMatchObject({ blockedBy: [1] });
		const listed = await byName("todo_list").execute("call", {});
		const got = await byName("todo_get").execute("call", { id: 1 });
		expect(listed.content[0].text).toContain("one");
		expect(got.content[0].text).toContain("one");
		expect(got.content[0].text).toContain("Description: full context");
		expect(got.content[0].text).toContain("Active form: Creating");
		expect(got.content[0].text).toContain("Agent type: builder");
		expect(got.content[0].text).toContain("Profile: coding");
		expect(got.content[0].text).toContain("Created:");
		expect(got.content[0].text).toContain("Updated:");
		expect(appendEntry).toHaveBeenCalledTimes(2);
		const updated = await byName("todo_update").execute("call", {
			id: 1,
			agent_type: "",
			profile: "",
		});
		expect(updated.details).not.toHaveProperty("agentType");
		expect(updated.details).not.toHaveProperty("agentProfile");
		const deleted = await byName("todo_delete").execute("call", { id: 1 });
		expect(deleted.content[0].text).toBe("Deleted todo #1");
		expect(appendEntry).toHaveBeenCalledTimes(4);
	}));

it("latches unavailable without exposing a mutation when session snapshot persistence fails", async () => {
	const tools: any[] = [];
	installTodos({
		appendEntry: () => {
			throw new Error("disk full");
		},
		on: vi.fn(),
		registerTool: (tool: any) => tools.push(tool),
		registerCommand: vi.fn(),
	} as any);
	const byName = (name: string) => tools.find((tool) => tool.name === name);
	await expect(byName("todo_create").execute("call", { title: "not persisted" })).rejects.toThrow("disk full");
	await expect(byName("todo_list").execute("call", {})).rejects.toThrow(/unavailable after snapshot failure/);
});

it("settles local execution before tree navigation and never appends old state after session_tree", async () => {
	const tools: any[] = [];
	const handlers = new Map<string, any>();
	const appendEntry = vi.fn();
	let resolveRun!: (record: { status: string; error?: string }) => void;
	const completion = new Promise<{ status: string; error?: string }>((resolve) => {
		resolveRun = resolve;
	});
	const abort = vi.fn(() => {
		resolveRun({ status: "stopped", error: "navigation" });
		return true;
	});
	const service = {
		startBackground: () => ({ id: "agent-1", completion, abort }),
	};
	installTodos({
		appendEntry,
		on: (name: string, handler: any) => handlers.set(name, handler),
		registerTool: (tool: any) => tools.push(tool),
		registerCommand: vi.fn(),
		events: { emit: (_name: string, reply: (value: unknown) => void) => reply(service) },
	} as any);
	let branch: unknown[] = [];
	const ctx = {
		cwd: process.cwd(),
		isProjectTrusted: () => false,
		sessionManager: { getBranch: () => branch },
	};
	handlers.get("session_start")({}, ctx);
	const byName = (name: string) => tools.find((tool) => tool.name === name);
	await byName("todo_create").execute("call", { title: "run", agent_type: "builder" }, undefined, undefined, ctx);
	await byName("todo_execute").execute("call", { ids: [1] }, undefined, undefined, ctx);
	appendEntry.mockClear();
	await handlers.get("session_before_tree")({}, ctx);
	expect(abort).toHaveBeenCalledOnce();
	expect(appendEntry).toHaveBeenCalledTimes(1);
	branch = [];
	appendEntry.mockClear();
	handlers.get("session_tree")({}, ctx);
	expect(appendEntry).not.toHaveBeenCalled();
});

it("selects trusted project storage only on session start", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "todos-project-"));
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "todos.json"), JSON.stringify({ storage: "project" }));
	const tools: any[] = [];
	const handlers = new Map<string, any>();
	const appendEntry = vi.fn();
	installTodos({
		appendEntry,
		on: (name: string, handler: any) => handlers.set(name, handler),
		registerTool: (tool: any) => tools.push(tool),
		registerCommand: vi.fn(),
	} as any);
	handlers.get("session_start")(
		{},
		{
			cwd,
			isProjectTrusted: () => true,
			sessionManager: { getBranch: () => [] },
		},
	);
	await tools.find((tool) => tool.name === "todo_create").execute("call", { title: "shared" });
	expect(existsSync(join(cwd, ".pi", "todos", "shared.json"))).toBe(true);
	expect(appendEntry).not.toHaveBeenCalled();
});

it("keeps project storage disabled when the project is untrusted", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "todos-untrusted-"));
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "todos.json"), JSON.stringify({ storage: "project" }));
	const tools: any[] = [];
	const handlers = new Map<string, any>();
	const appendEntry = vi.fn();
	installTodos({
		appendEntry,
		on: (name: string, handler: any) => handlers.set(name, handler),
		registerTool: (tool: any) => tools.push(tool),
		registerCommand: vi.fn(),
	} as any);
	handlers.get("session_start")(
		{},
		{
			cwd,
			isProjectTrusted: () => false,
			sessionManager: { getBranch: () => [] },
		},
	);
	await tools.find((tool) => tool.name === "todo_create").execute("call", { title: "local" });
	expect(appendEntry).toHaveBeenCalledTimes(1);
	expect(existsSync(join(cwd, ".pi", "todos", "shared.json"))).toBe(false);
});
