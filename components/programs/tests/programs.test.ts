import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { createCodemodeExtension } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import installProgramsExtension from "../src/index.js";
import { parseProgram, programScript } from "../src/programs.js";

const ROOT = join(import.meta.dirname, "../../..");
const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

const HELLO = `// @program: {"description": "Greet someone.", "parameters": {"name": {"type": "string"}, "times": {"type": "integer", "default": 2}}, "required": ["name"]}
// @options: {"timeout_ms": 60000}
const files = await tools.read({ path: "app.ts" });
return { greeting: Array(inputs.times).fill(\`hello \${inputs.name}\`).join(" "), file: files.trim() };
`;

function project(programs: Record<string, string>) {
	const cwd = mkdtempSync(join(tmpdir(), "programs-"));
	mkdirSync(join(cwd, ".pi", "programs"), { recursive: true });
	writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
	for (const [name, source] of Object.entries(programs)) writeFileSync(join(cwd, ".pi", "programs", name), source);
	cleanups.push(() => rmSync(cwd, { recursive: true, force: true }));
	return cwd;
}

function resultText(session: { messages: { role: string; toolName?: string; content?: unknown }[] }, tool: string) {
	const result = session.messages.find((message) => message.role === "toolResult" && message.toolName === tool);
	return JSON.stringify(result?.content ?? null);
}

test("a program's header declares its parameters, and its script receives typed inputs with defaults", () => {
	const program = parseProgram("hello", HELLO);
	expect(program.description).toBe("Greet someone.");
	expect(program.required).toEqual(["name"]);
	const script = programScript(program, { name: "Ada" });
	expect(script.split("\n")[0]).toBe('// @options: {"timeout_ms": 60000}');
	expect(script.split("\n")[1]).toBe('const inputs = {"name":"Ada","times":2};');
	expect(() => parseProgram("broken", "return 1;")).toThrow(/@program/);
});

test("the packaged programs parse", () => {
	for (const path of ["skills/ralph/references/ralph.js", ".pi/programs/rpc-smoke.js"])
		expect(() => parseProgram("check", readFileSync(join(ROOT, path), "utf8")), path).not.toThrow();
});

test("a saved program becomes a tool that runs on codemode and calls other tools", async () => {
	const cwd = project({ "hello.js": HELLO, "broken.js": "return 1;\n" });
	const run = await fauxSession(
		[createCodemodeExtension({ models: false }), installProgramsExtension],
		[
			fauxAssistantMessage([fauxToolCall("program_hello", { name: "Ada" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		],
		["read", "codemode", "program_hello"],
		{ cwd },
	);
	cleanups.push(run.dispose);
	expect(run.session.getActiveToolNames()).toEqual(expect.arrayContaining(["codemode", "program_hello"]));
	expect(run.session.getActiveToolNames()).not.toContain("program_broken");
	await run.session.prompt("greet");
	const text = resultText(run.session, "program_hello");
	expect(text).toContain("hello Ada hello Ada");
	expect(text).toContain("export const value = 1;");
});

test("peer tools refuse a session that does not manage people", async () => {
	const cwd = project({
		"ask.js": `// @program: {"description": "Ask a peer."}\nreturn await tools.temporary_peer({ role: "implementation-engineer", task: "Say hi." });\n`,
	});
	const run = await fauxSession(
		[createCodemodeExtension({ models: false }), installProgramsExtension],
		[fauxAssistantMessage([fauxToolCall("program_ask", {})], { stopReason: "toolUse" }), fauxAssistantMessage("done")],
		["read", "codemode", "program_ask"],
		{ cwd },
	);
	cleanups.push(run.dispose);
	await run.session.prompt("ask");
	expect(resultText(run.session, "program_ask")).toContain("Peer turns need a managing role");
});
