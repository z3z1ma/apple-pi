import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionToolContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import runtime from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function project() {
	const cwd = mkdtempSync(join(tmpdir(), "apple-pi-saved-programs-"));
	temporaryDirectories.push(cwd);
	const directory = join(cwd, ".pi", "programs");
	mkdirSync(directory, { recursive: true });
	return { cwd, directory, write: (name: string, code: string) => writeFileSync(join(directory, name), code) };
}

function registeredRuntime(cwd: string) {
	const tools = new Map<string, ToolDefinition<any, any>>();
	const handlers = new Map<string, Array<(event: any, ctx: ExtensionContext) => unknown>>();
	const registrations: string[] = [];
	let trusted = true;
	let branch: unknown[] = [];
	const ctx = {
		cwd,
		hasUI: false,
		isProjectTrusted: () => trusted,
		sessionManager: {
			getSessionId: () => "saved-program-test",
			getBranch: () => branch,
			getSessionFile: () => undefined,
		},
	} as unknown as ExtensionToolContext;
	runtime({
		appendEntry() {},
		registerTool(tool: ToolDefinition<any, any>) {
			tools.set(tool.name, tool);
			registrations.push(tool.name);
		},
		on(event: string, handler: (event: any, ctx: ExtensionContext) => unknown) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
	} as unknown as ExtensionAPI);
	return {
		tools,
		registrations,
		ctx,
		setTrusted: (value: boolean) => {
			trusted = value;
		},
		setBranch: (value: unknown[]) => {
			branch = value;
		},
		async emit(event: string, payload: Record<string, unknown> = {}) {
			const results = [];
			for (const handler of handlers.get(event) ?? []) results.push(await handler({ type: event, ...payload }, ctx));
			return results;
		},
		async call(name: string, args: Record<string, unknown> = {}) {
			const tool = tools.get(name);
			if (!tool) throw new Error(`Tool not registered: ${name}`);
			return tool.execute(`call-${name}`, args, undefined, undefined, ctx);
		},
	};
}

describe("saved Python program tools", () => {
	it("shares Monty globals between saved programs and direct pi_exec calls", async () => {
		const fixture = project();
		fixture.write(
			"store.py",
			'"""Store a value.\n@param {int} amount Value to store\n"""\nsaved_value: int = int(inputs["amount"])\nsaved_value',
		);
		const session = registeredRuntime(fixture.cwd);
		await session.emit("session_start");
		const stored = await session.call("program_store", { amount: 5 });
		const restored = await session.call("pi_exec", { code: "saved_value" });
		if (stored.content[0]?.type !== "text" || restored.content[0]?.type !== "text")
			throw new Error("Expected text results");
		expect(stored.content[0].text).toBe("5");
		expect(restored.content[0].text).toBe("5");
	});

	it("advertises the Python saved-program format even before any saved tool exists", () => {
		const session = registeredRuntime(project().cwd);
		const guidance = session.tools.get("pi_exec")?.promptGuidelines?.join("\n");
		expect(guidance).toContain(".pi/programs/<name>.py");
		expect(guidance).toContain("leading Python docstring");
		expect(guidance).toContain("@param {int} [count=2]");
		expect(guidance).toContain("inputs");
	});

	it("discovers a leading docstring and typed parameters at session start, then runs Python with string inputs", async () => {
		const fixture = project();
		fixture.write(
			"repeat-message.py",
			`"""Repeat a caller's message.
@param {str} message - Message to repeat.
@param {int} count - Repetition count.
@param {bool} excited - Add punctuation.
"""
(inputs["message"] + ("!" if inputs["excited"] == "true" else "")) * int(inputs["count"])
`,
		);
		const session = registeredRuntime(fixture.cwd);
		await session.emit("session_start");
		const tool = session.tools.get("program_repeat_message");
		expect(tool).toBeDefined();
		expect(tool?.description).toContain(".pi/programs/repeat-message.py");
		expect(tool?.description).toContain("Repeat a caller's message.");
		expect(tool?.parameters).toMatchObject({
			type: "object",
			properties: {
				message: { type: "string", description: "Message to repeat." },
				count: { type: "integer", description: "Repetition count." },
				excited: { type: "boolean", description: "Add punctuation." },
			},
			required: ["message", "count", "excited"],
		});
		const result = await session.call("program_repeat_message", { message: "hi", count: 2, excited: true });
		expect(result.content).toEqual([{ type: "text", text: "hi!hi!" }]);
		expect(result.details.trace.outcome).toBe("succeeded");
	});

	it("publishes optional/defaulted types and supplies defaults without overriding caller inputs", async () => {
		const fixture = project();
		fixture.write(
			"defaults.py",
			`'''Apply declared defaults.
@param {string} [prefix="go now"] - Prefix text.
@param {integer} [count=2] - Repetition count.
@param {float} [ratio=1.5] - Ratio.
@param {boolean} [enabled=False] - Enable output.
@param {str} [note] - Optional note.
'''
[inputs["prefix"], int(inputs["count"]), float(inputs["ratio"]), inputs["enabled"] == "true", inputs.get("note", "absent")]
`,
		);
		const session = registeredRuntime(fixture.cwd);
		await session.emit("session_start");
		const schema = session.tools.get("program_defaults")?.parameters;
		expect(schema).toMatchObject({
			properties: {
				prefix: { type: "string", default: "go now" },
				count: { type: "integer", default: 2 },
				ratio: { type: "number", default: 1.5 },
				enabled: { type: "boolean", default: false },
				note: { type: "string" },
			},
		});
		expect(schema?.required ?? []).toEqual([]);
		const defaults = await session.call("program_defaults");
		expect(JSON.parse((defaults.content[0] as { text: string }).text)).toEqual(["go now", 2, 1.5, false, "absent"]);
		const explicit = await session.call("program_defaults", {
			prefix: "stop",
			count: 0,
			ratio: 0,
			enabled: true,
			note: "",
			inputs: { prefix: "raw prefix", count: "10" },
		});
		expect(JSON.parse((explicit.content[0] as { text: string }).text)).toEqual(["stop", 0, 0, true, ""]);
		const inputsOverride = await session.call("program_defaults", { inputs: { count: "3" } });
		expect(JSON.parse((inputsOverride.content[0] as { text: string }).text)[1]).toBe(3);
	});

	it("parses quoted defaults without swallowing brackets in parameter descriptions", async () => {
		const fixture = project();
		fixture.write(
			"quoted-defaults.py",
			`"""Keep quoted defaults intact.
@param {str} [suffix="]"] - Read inputs["suffix"] directly.
@param {string} [prefix='go'] - Read inputs["prefix"] directly.
@param [empty=""] - An empty string.
"""
[inputs["prefix"], inputs["suffix"], inputs["empty"]]
`,
		);
		const session = registeredRuntime(fixture.cwd);
		await session.emit("session_start");
		expect(session.tools.get("program_quoted_defaults")?.parameters.properties.suffix).toMatchObject({
			type: "string",
			default: "]",
			description: 'Read inputs["suffix"] directly.',
		});
		const result = await session.call("program_quoted_defaults");
		expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(["go", "]", ""]);
	});

	it("rereads edited source on each call but keeps schemas and defaults frozen until a safe boundary", async () => {
		const fixture = project();
		fixture.write(
			"changing.py",
			'"""Original description.\n@param {int} [count=2] - Original count.\n"""\nint(inputs["count"]) + 1',
		);
		const session = registeredRuntime(fixture.cwd);
		await session.emit("session_start");
		const original = session.tools.get("program_changing");
		expect((await session.call("program_changing")).content).toEqual([{ type: "text", text: "3" }]);
		session.setBranch([{ type: "message" }]);
		const registrations = session.registrations.length;
		fixture.write(
			"changing.py",
			'"""Updated description.\n@param {number} [count=8] - Updated count.\n"""\nint(inputs["count"]) * 10',
		);
		fixture.write("new-tool.py", '"""Added during a turn."""\n42');
		await session.emit("turn_start");
		await session.emit("before_agent_start");
		expect(session.registrations).toHaveLength(registrations);
		expect(session.tools.get("program_changing")).toBe(original);
		expect(original?.parameters.properties.count).toMatchObject({ type: "integer", default: 2 });
		expect(original?.description).toContain("Original description.");
		expect(session.tools.has("program_new_tool")).toBe(false);
		expect((await session.call("program_changing")).content).toEqual([{ type: "text", text: "20" }]);
		await session.emit("session_compact");
		expect(session.tools.get("program_changing")?.parameters.properties.count).toMatchObject({
			type: "number",
			default: 8,
		});
		expect(session.tools.get("program_changing")?.description).toContain("Updated description.");
		expect(session.tools.has("program_new_tool")).toBe(true);
		expect((await session.call("program_changing")).content).toEqual([{ type: "text", text: "80" }]);

		fixture.write("first-turn.py", '"""Added before first message."""\n1');
		session.setBranch([{ type: "custom", customType: "metadata" }]);
		await session.emit("before_agent_start");
		expect(session.tools.has("program_first_turn")).toBe(true);
	});

	it("checks project trust on every call, including after registration", async () => {
		const fixture = project();
		fixture.write("trusted.py", '"""Requires a trusted project."""\n"ran"');
		const session = registeredRuntime(fixture.cwd);
		session.setTrusted(false);
		await session.emit("session_start");
		expect(session.tools.has("program_trusted")).toBe(true);
		await expect(session.call("program_trusted")).rejects.toThrow(/require a trusted project/);
		session.setTrusted(true);
		expect((await session.call("program_trusted")).content).toEqual([{ type: "text", text: "ran" }]);
		session.setTrusted(false);
		await expect(session.call("program_trusted")).rejects.toThrow(/require a trusted project/);
		delete (session.ctx as Partial<ExtensionContext>).isProjectTrusted;
		await expect(session.call("program_trusted")).rejects.toThrow(/require a trusted project/);
	});

	it("discovers only regular Python files with confined names and valid descriptions", async () => {
		const fixture = project();
		const valid = '"""A valid program."""\n1';
		fixture.write("valid.py", valid);
		fixture.write("legacy.js", "/** @description Legacy JavaScript. */\nreturn 1;");
		fixture.write("Upper.py", valid);
		fixture.write("bad_name.py", valid);
		fixture.write("bad--name.py", valid);
		fixture.write(`${"a".repeat(121)}.py`, valid);
		fixture.write("no-description.py", "1");
		fixture.write("missing-summary.py", '"""\n@param {str} x\n"""\n1');
		fixture.write("empty.py", '""" """\n1');
		fixture.write("long-description.py", `"""${"a".repeat(301)}"""\n1`);
		fixture.write("unterminated.py", '"""Description without closing quotes.');
		fixture.write("too-big.py", `${valid}\n# ${"a".repeat(100_000)}`);
		mkdirSync(join(fixture.directory, "directory.py"));
		symlinkSync(join(fixture.directory, "valid.py"), join(fixture.directory, "symlink.py"));
		const session = registeredRuntime(fixture.cwd);
		await session.emit("session_start");
		expect([...session.tools.keys()].filter((name) => name.startsWith("program_"))).toEqual(["program_valid"]);
		fixture.write("valid.py", "1");
		await expect(session.call("program_valid")).rejects.toThrow(/Python docstring/);
		unlinkSync(join(fixture.directory, "valid.py"));
		await expect(session.call("program_valid")).rejects.toThrow(/Unknown pi_exec program/);
	});

	it.each([
		"@param {int} [count=nope]",
		"@param {int} [count=1.5]",
		"@param {float} [count=Infinity]",
		"@param {bool} [enabled=yes]",
		'@param {str} [text="unterminated]',
		"@param {unknown} value",
		"@param {__proto__} value",
		"@param {str} reset",
		"@param {str} limits",
		"@param {str} inputs",
		"@param {str} duplicate\\n@param {int} duplicate",
		"@param {str}",
	])("rejects malformed parameter metadata: %s", async (declaration) => {
		const fixture = project();
		const session = registeredRuntime(fixture.cwd);
		fixture.write("invalid.py", `"""Reject invalid metadata.\n${declaration.replaceAll("\\n", "\n")}\n"""\n1`);
		await session.emit("session_start");
		expect(session.tools.has("program_invalid")).toBe(false);
		fixture.write("invalid.py", '"""Valid metadata."""\n1');
		await session.emit("session_compact");
		expect(session.tools.has("program_invalid")).toBe(true);
		fixture.write("invalid.py", `"""Reject invalid metadata.\n${declaration.replaceAll("\\n", "\n")}\n"""\n1`);
		await expect(session.call("program_invalid")).rejects.toThrow(/@param/);
	});

	it("preserves saved-tool failure traces through the public result hook", async () => {
		const fixture = project();
		fixture.write("failure.py", '"""Fail deliberately."""\n1 / 0');
		const session = registeredRuntime(fixture.cwd);
		await session.emit("session_start");
		await expect(session.call("program_failure")).rejects.toThrow(/division by zero/);
		const hookResults = await session.emit("tool_result", {
			toolName: "program_failure",
			toolCallId: "call-program_failure",
			isError: true,
		});
		expect(hookResults).toContainEqual(
			expect.objectContaining({
				details: expect.objectContaining({ trace: expect.objectContaining({ outcome: "failed" }) }),
			}),
		);
	});

	it("rejects file and directory symlink escapes at discovery and again before execution", async () => {
		const fixture = project();
		const outside = project();
		outside.write("escape.py", '"""Outside project."""\n"outside"');
		fixture.write("safe.py", '"""Originally inside project."""\n"inside"');
		symlinkSync(join(outside.directory, "escape.py"), join(fixture.directory, "escape.py"));
		const session = registeredRuntime(fixture.cwd);
		await session.emit("session_start");
		expect(session.tools.has("program_escape")).toBe(false);
		unlinkSync(join(fixture.directory, "safe.py"));
		symlinkSync(join(outside.directory, "escape.py"), join(fixture.directory, "safe.py"));
		await expect(session.call("program_safe")).rejects.toThrow(/regular file/);
		rmSync(fixture.directory, { recursive: true });
		symlinkSync(outside.directory, fixture.directory);
		await expect(session.call("program_safe")).rejects.toThrow(/within the project/);
		const freshSession = registeredRuntime(fixture.cwd);
		await freshSession.emit("session_start");
		expect([...freshSession.tools.keys()].filter((name) => name.startsWith("program_"))).toEqual([]);
	});
});
