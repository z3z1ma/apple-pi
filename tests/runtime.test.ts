import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExtensionRunner } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { runInChildSessionContext } from "../components/subagents/src/child-context.js";
import runtime, {
	aggregateUsage,
	deriveProgramEnvelope,
	executeProgram,
	listSkills,
	PROGRAM_ENVELOPE_MAXIMA,
	readSkillBody,
} from "../extensions/runtime.js";
import {
	agentOperationArgs,
	CONTEXT_GUIDANCE,
	MAX_AGENT_CONTEXT_CHARS,
	OUTPUT_SCHEMA_GUIDANCE,
	PI_EXEC_OUTPUT_SCHEMA_ENV,
	PI_EXEC_RETURN_TOOL,
	parseAgentRequest,
	prepareAgentSpawn,
	resolveExecWorker,
	resolveStructuredOutput,
	serializeAgentContext,
	WORKER_RETURN_EXTENSION_PATH,
} from "../extensions/runtime-agent.js";
import {
	CORE_GUEST_TOOL_NAMES,
	coreGuestSignatures,
	coreToolDefinitions,
	ECMASCRIPT_GUEST_GLOBALS,
	formatObjectSignature,
	PI_EXEC_DESCRIPTION,
	PI_EXEC_DISPLAY_PARAMETER_DESCRIPTION,
	PI_EXEC_PROMPT_GUIDELINES,
	piExecGuestApiContract,
} from "../extensions/runtime-api.js";
import { renderExecCall, renderExecResult } from "../extensions/runtime-ui.js";
import { createEventBus } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/event-bus.js";
import {
	createExtensionRuntime,
	loadExtensions,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";

const theme = {
	fg: (_color: string, value: string) => value,
	bold: (value: string) => value,
} as any;

const execute = (
	code: string,
	hostCall: (ref: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>,
	timeoutMs = 2_000,
) => executeProgram(code, {}, timeoutMs, hostCall);

describe("pi_exec worker runtime", () => {
	it("aggregates every subagent model turn's usage", () => {
		const usage = (tokens: number) => ({
			input: tokens,
			output: tokens,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: tokens * 2,
			cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
		});
		expect(aggregateUsage([usage(2), usage(3)])).toMatchObject({
			input: 5,
			output: 5,
			totalTokens: 10,
			cost: { input: 2, output: 4, total: 6 },
		});
	});

	it("composes parallel calls and returns only the program value", async () => {
		const calls: string[] = [];
		const result = await execute(
			`
const values = await Promise.all([
  pi.read({ path: "a" }),
  pi.read({ path: "b" }),
]);
return values.map((value) => value.toUpperCase());
`,
			async (_ref, args) => {
				calls.push(String(args.path));
				return String(args.path);
			},
		);

		expect(result).toEqual({ outcome: "succeeded", value: ["A", "B"] });
		expect(calls.sort()).toEqual(["a", "b"]);
	});

	it("accepts the parent session's max thinking level", async () => {
		const result = await execute(`return agents.run({ task: "inspect", thinking: "max" });`, async (_ref, args) => ({
			status: "completed",
			text: String(args.thinking),
		}));
		expect(result.value).toEqual({ status: "completed", text: "max" });
	});

	it("supports structured agents.run and the text-returning agent convenience", async () => {
		const result = await execute(
			`
const structured = await agents.run({ task: "inspect", name: "reviewer" });
const text = await agent("summarize");
return { structured, text };
`,
			async (ref, args) => ({ status: "completed", text: String(args.task).toUpperCase(), ref }),
		);
		expect(result.value).toEqual({
			structured: { status: "completed", text: "INSPECT", ref: "agents.run" },
			text: "SUMMARIZE",
		});
	});

	it("forwards bound agent context without interpolating it into the task", async () => {
		const seen: Record<string, unknown>[] = [];
		const result = await execute(
			`return agents.run({ task: "judge these rows", name: "judge", context: { ids: [1, 2] } });`,
			async (_ref, args) => {
				seen.push(args);
				return { status: "completed", text: "ok" };
			},
		);
		expect(result.outcome).toBe("succeeded");
		expect(seen[0]).toEqual({
			task: "judge these rows",
			name: "judge",
			context: { ids: [1, 2] },
		});
	});

	it("returns a structured outputSchema value from agent() without parsing text", async () => {
		const result = await execute(
			`
const verdict = await agent({
  task: "judge",
  outputSchema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
});
return verdict;
`,
			async () => ({ status: "completed", text: "ignore me", value: { id: 7 } }),
		);
		expect(result).toEqual({ outcome: "succeeded", value: { id: 7 } });
	});

	it("supports timers without exposing Node globals", async () => {
		const result = await execute("await sleep(5); return 'awake';", async () => undefined);
		expect(result).toEqual({ outcome: "succeeded", value: "awake" });
	});

	it("provides fetch and familiar web JavaScript globals", async () => {
		const calls: Array<{ ref: string; args: Record<string, unknown> }> = [];
		const result = await execute(
			`
const url = new URL("/items", "https://example.test/base");
url.searchParams.set("q", "hello world");
const response = await fetch(url, {
  method: "POST",
  headers: new Headers({ "x-test": "yes" }),
  body: JSON.stringify({ active: true }),
});
const bytes = new TextEncoder().encode("pi ✓");
const copy = structuredClone({ nested: [1, 2] });
let ticks = 0;
await new Promise((resolve) => {
  const timer = setInterval(() => {
    if (++ticks === 2) { clearInterval(timer); resolve(); }
  }, 1);
});
return {
  status: response.status,
  contentType: response.headers.get("content-type"),
  payload: await response.json(),
  url: url.href,
  decoded: new TextDecoder().decode(bytes),
  base64: btoa("pi"),
  cloned: copy.nested,
  ticks,
  responseType: response instanceof Response,
};
`,
			async (ref, args) => {
				calls.push({ ref, args });
				return {
					status: 201,
					statusText: "Created",
					headers: [["content-type", "application/json"]],
					url: String(args.url),
					redirected: false,
					type: "basic",
					body: Buffer.from(JSON.stringify({ received: true })).toString("base64"),
					bodyBytes: 17,
				};
			},
		);

		expect(result).toEqual({
			outcome: "succeeded",
			value: {
				status: 201,
				contentType: "application/json",
				payload: { received: true },
				url: "https://example.test/items?q=hello+world",
				decoded: "pi ✓",
				base64: "cGk=",
				cloned: [1, 2],
				ticks: 2,
				responseType: true,
			},
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			ref: "fetch",
			args: {
				url: "https://example.test/items?q=hello+world",
				method: "POST",
				redirect: "follow",
			},
		});
		expect(calls[0].args.headers).toEqual(
			expect.arrayContaining([
				["content-type", "text/plain;charset=UTF-8"],
				["x-test", "yes"],
			]),
		);
	});

	it("cancels fetch through AbortSignal", async () => {
		let aborted = false;
		const result = await execute(
			`
try {
  await fetch("https://example.test/slow", { signal: AbortSignal.timeout(5) });
  return "unexpected";
} catch (error) {
  return error.name;
}
`,
			async (_ref, _args, signal) =>
				await new Promise((_resolve, reject) => {
					signal.addEventListener(
						"abort",
						() => {
							aborted = true;
							reject(signal.reason);
						},
						{ once: true },
					);
				}),
		);
		expect(result).toEqual({ outcome: "succeeded", value: "TimeoutError" });
		expect(aborted).toBe(true);
	});

	it("consumes Request bodies when fetch sends them", async () => {
		let calls = 0;
		const result = await execute(
			`
Request.prototype._snapshot = () => { throw new Error("guest snapshot hook must not run"); };
const request = new Request("https://example.test/items", { method: "POST", body: "once" });
await fetch(request);
let secondError;
try { await fetch(request); } catch (error) { secondError = error.message; }
return { bodyUsed: request.bodyUsed, secondError };
`,
			async () => {
				calls++;
				return {
					status: 204,
					statusText: "No Content",
					headers: [],
					url: "https://example.test/items",
					redirected: false,
					type: "basic",
					body: "",
					bodyBytes: 0,
				};
			},
		);
		expect(result.value).toEqual({ bodyUsed: true, secondError: "Body has already been consumed" });
		expect(calls).toBe(1);
	});

	it("supports conditional pipelines and named inputs", async () => {
		const result = await executeProgram(
			`
const values = await pipeline(
  inputs.names.split(","),
  async (name) => pi.read({ path: name }),
  (value) => value.length,
);
return values.filter((length) => length > 3);
`,
			{ names: "one,three" },
			2_000,
			async (_ref, args) => String(args.path),
		);
		expect(result).toEqual({ outcome: "succeeded", value: [5] });
	});

	it("logs without creating an unawaited host call", async () => {
		const logs: unknown[][] = [];
		const result = await executeProgram(
			'console.log("checkpoint", 1); return 42;',
			{},
			2_000,
			async () => undefined,
			undefined,
			(values) => logs.push(values),
		);
		expect(result).toEqual({ outcome: "succeeded", value: 42 });
		expect(logs).toEqual([["checkpoint 1"]]);
	});

	it("does not expose Node globals to guest code", async () => {
		const result = await execute(
			"return { process: typeof process, require: typeof require, fetch: typeof fetch };",
			async () => undefined,
		);
		expect(result.value).toEqual({ process: "undefined", require: "undefined", fetch: "function" });
	});

	it("blocks string-generated escapes through guest and bridged values", async () => {
		for (const code of [
			'return globalThis.constructor.constructor("return process")();',
			'return URL.constructor("return process")();',
			'return setTimeout.constructor("return process")();',
			'return inputs.constructor.constructor("return process")();',
			'const result = await agents.run("inspect"); return result.constructor.constructor("return process")();',
		]) {
			const result = await execute(code, async () => ({ status: "completed", text: "ok" }));
			expect(result.outcome).toBe("failed");
			expect(result.error).toContain("Code generation from strings disallowed");
		}
	});

	it("keeps host promises hidden when guest intrinsics are modified", async () => {
		const result = await execute(
			`
Promise.resolve = () => { throw new Error("Promise.resolve intercepted a host value"); };
WeakMap.prototype.set = () => { throw new Error("WeakMap.set intercepted a host value"); };
const value = await agents.run("inspect");
return value.text;
`,
			async () => ({ status: "completed", text: "safe" }),
		);
		expect(result).toEqual({ outcome: "succeeded", value: "safe" });
	});

	it("terminates runaway synchronous code", async () => {
		const result = await execute("while (true) {}", async () => undefined, 50);
		expect(result.outcome).toBe("timed_out");
		expect(result.error).toContain("timed out");
	});

	it("fails clearly when the returned value cannot cross the worker boundary", async () => {
		const result = await execute("return () => 1;", async () => undefined);
		expect(result.outcome).toBe("failed");
		expect(result.error).toContain("not serializable");
	});

	it("reports unawaited rejected host calls as failures", async () => {
		const result = await execute("void pi.read({ path: 'missing' }); return 'premature';", async () => {
			throw new Error("missing file");
		});
		expect(result.outcome).toBe("failed");
		expect(result.error).toMatch(/returned before .* host call|Unawaited/);
	});

	it("rejects display as a program global with a tool-parameter error", async () => {
		const result = await execute('display.name = "Audit"; return 1;', async () => undefined);
		expect(result.outcome).toBe("failed");
		expect(result.error).toMatch(/display is a pi_exec tool parameter/);
	});
});

describe("pi_exec guest API documentation", () => {
	it("formats core tool calls as one object argument from the live parent schemas", () => {
		const definitions = coreToolDefinitions();
		expect(formatObjectSignature(definitions.read.parameters)).toBe(
			"{ path: string, offset?: number, limit?: number }",
		);
		expect(formatObjectSignature(definitions.edit.parameters)).toBe(
			"{ path: string, edits: [{ oldText: string, newText: string }] }",
		);
		for (const signature of coreGuestSignatures()) {
			expect(signature).toMatch(/^pi\.[a-z]+\(\{ /);
			expect(signature).toMatch(/ → Promise</);
			expect(signature).not.toMatch(/^pi\.[a-z]+\([a-z]/);
		}
	});

	it("includes primitive types and literal unions from JSON schemas", () => {
		const schema = Type.Object({
			action: Type.Union([Type.Literal("preview"), Type.Literal("run")]),
			path: Type.String(),
			limit: Type.Optional(Type.Number()),
			tags: Type.Array(Type.String()),
			modes: Type.Array(Type.Union([Type.Literal("fast"), Type.Literal("thorough")])),
			meta: Type.Record(Type.String(), Type.String()),
		});
		expect(formatObjectSignature(schema)).toBe(
			'{ action: "preview"|"run", path: string, limit?: number, tags: string[], modes: ("fast"|"thorough")[], meta: { [key: string]: string } }',
		);
	});

	it("embeds live object signatures in the tool contract and keeps the skill in sync", () => {
		const guidelines = PI_EXEC_PROMPT_GUIDELINES.join("\n");
		const contract = piExecGuestApiContract();
		expect(guidelines).toContain("never a positional string");
		expect(guidelines).toContain("pi.read({ path })");
		expect(guidelines).toContain("display is a pi_exec tool parameter");
		expect(guidelines).not.toMatch(/Set display\.name/);
		expect(guidelines).not.toMatch(/await tools\.describe/);
		expect(PI_EXEC_DESCRIPTION).toContain("never a positional string");
		expect(PI_EXEC_DESCRIPTION).toContain("outputSchema?");
		expect(PI_EXEC_DESCRIPTION).toContain("value?");
		expect(PI_EXEC_DISPLAY_PARAMETER_DESCRIPTION).toMatch(/not a program global/i);
		expect(contract).toContain("agent(request: AgentRequest)");
		expect(contract).toContain("agents.run(request: AgentRequest)");
		expect(contract).toContain("type?: string");
		expect(contract).toContain("context?: JSONValue");
		expect(contract).toContain("outputSchema?: object");
		expect(contract).toContain("value?: JSONValue");
		expect(contract).toContain("bind the compact result as context");
		expect(contract).toContain("Never JSON.parse assistant text");
		expect(contract).toContain("skills.list()");
		expect(contract).toContain("skills.body({ name: string })");
		expect(contract).toContain("fetch(input: string | URL | Request, init?: RequestInit)");
		expect(contract).toContain("parallel(");
		expect(contract).toContain("sleep(ms: number)");
		expect(contract).toContain("URL.parse(");
		expect(contract).toContain("URL.canParse(");
		expect(contract).toContain("AbortSignal.timeout(");
		expect(contract).toContain("AbortSignal.any(");
		expect(contract).toContain("AbortSignal.abort(");
		expect(contract).toContain("Response.error(");
		expect(contract).toContain("Response.redirect(");
		expect(contract).toContain("encodeInto(");
		expect(contract).toContain("getSetCookie(");
		expect(contract).toContain("DOMException");
		expect(contract).not.toContain("_fromFetch");

		const skill = readFileSync(new URL("../skills/pi-exec/SKILL.md", import.meta.url), "utf8");
		expect(skill).toContain("context?");
		expect(skill).toContain("outputSchema?");
		expect(skill).toContain("type?");
		expect(skill).toContain('type: "Explore"');
		expect(skill).toContain("agent(request: AgentRequest)");
		expect(skill).toContain("agents.run(request: AgentRequest)");
		expect(skill).toContain("value?: JSONValue");
		expect(skill).toContain("bind the compact result as `context`");
		expect(skill).toContain("Never `JSON.parse` assistant text");
		expect(skill).toContain("const verdict = await agent({");
		expect(skill).toContain("const result = await agents.run({");
		expect(skill).toContain("skills.list()");
		expect(skill).toContain("skills.body({ name })");
		expect(skill).toContain("context: first");
		expect(skill).not.toMatch(/Before calling an unfamiliar extension tool/);
		const definitions = coreToolDefinitions();
		for (const name of CORE_GUEST_TOOL_NAMES) {
			const signature = `pi.${name}({`;
			expect(contract).toContain(signature);
			expect(skill).toContain(signature);
			for (const field of Object.keys(definitions[name]?.parameters.properties ?? {})) {
				expect(contract).toContain(field);
				expect(skill).toContain(field);
			}
		}
	});

	it("documents every host-provided guest global", async () => {
		const result = await execute("return Reflect.ownKeys(globalThis).map(String).sort();", async () => undefined);
		expect(result.outcome).toBe("succeeded");
		const contract = piExecGuestApiContract();
		const ecma = new Set<string>(ECMASCRIPT_GUEST_GLOBALS);
		for (const name of result.value as string[]) {
			if (ecma.has(name)) continue;
			expect(contract, name).toContain(name);
		}
	});
});

describe("pi_exec skills", () => {
	it("lists packaged skills and returns a stripped body", () => {
		const dir = mkdtempSync(join(tmpdir(), "apple-pi-skills-"));
		try {
			const names = listSkills({ cwd: dir, includeDefaults: false }).map((skill) => skill.name);
			expect(names).toContain("pi-review");
			expect(names).toContain("pi-ralph");
			expect(names).not.toContain("ralph-executor");
			expect(names).not.toContain("ralph-judge");
			expect(names).not.toContain("review");
			expect(names).not.toContain("review-planner");
			expect(names).not.toContain("reviewer");
			expect(names).not.toContain("review-verifier");
			const body = readSkillBody("pi-review", { cwd: dir, includeDefaults: false });
			expect(body.startsWith("# Review")).toBe(true);
			expect(body).not.toMatch(/^---/);
			expect(body).toContain("pi_exec");
			expect(() => readSkillBody("review-planner", { cwd: dir, includeDefaults: false })).toThrow(
				/Unknown skill: review-planner/,
			);
			expect(() => readSkillBody("", { cwd: dir, includeDefaults: false })).toThrow(/requires a skill name/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("prefers a fixture catalog over package skills when skillPaths are set", () => {
		const dir = mkdtempSync(join(tmpdir(), "apple-pi-skill-fixture-"));
		try {
			const root = join(dir, "skills", "demo");
			mkdirSync(root, { recursive: true });
			writeFileSync(
				join(root, "SKILL.md"),
				"---\nname: demo\ndescription: Demo skill for catalog tests.\n---\n\n# Demo\n\nBody only.\n",
				"utf8",
			);
			const options = { cwd: dir, skillPaths: [join(dir, "skills")], includeDefaults: false };
			expect(listSkills(options)).toEqual([{ name: "demo", description: "Demo skill for catalog tests." }]);
			expect(readSkillBody("demo", options)).toBe("# Demo\n\nBody only.");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("pi_exec agent binding", () => {
	it("parses a bound request and trims name", () => {
		expect(
			parseAgentRequest({
				task: "judge",
				name: "  reviewer  ",
				context: { ids: [1] },
			}),
		).toEqual({
			task: "judge",
			name: "reviewer",
			context: { ids: [1] },
		});
	});

	it("parses a catalog type and keeps untyped workers generic", () => {
		expect(parseAgentRequest({ task: "map auth", type: "  Explore  " })).toEqual({
			task: "map auth",
			type: "Explore",
		});
		expect(parseAgentRequest({ task: "judge", systemPrompt: "REVIEWER" }).type).toBeUndefined();
		expect(agentOperationArgs({ task: "map auth", type: "Explore" })).toEqual({
			task: "map auth",
			type: "Explore",
		});
	});

	it("rejects an empty task", () => {
		expect(() => parseAgentRequest({ task: "   " })).toThrow(/non-empty task/);
	});

	it("resolves catalog types for agents.run and leaves untyped workers read-only", async () => {
		const cwd = process.cwd();
		const untyped = await resolveExecWorker({ task: "inspect" }, { cwd });
		expect(untyped).toEqual({ tools: ["read", "grep", "find", "ls"] });

		const custom = await resolveExecWorker(
			{ task: "review this diff", systemPrompt: "REVIEWER" },
			{ cwd, parentModel: "xai/parent", parentThinking: "low" },
		);
		expect(custom.tools).toEqual(["read", "grep", "find", "ls"]);
		expect(custom.systemPrompt).toBe("REVIEWER");
		expect(custom.model).toBe("xai/parent");
		expect(custom.type).toBeUndefined();

		const explore = await resolveExecWorker({ task: "where is X?", type: "Explore" }, { cwd });
		expect(explore.type).toBe("Explore");
		expect(explore.tools).toEqual(["read", "bash", "grep", "find", "ls"]);
		expect(explore.model).toBe("openai-codex/gpt-5.6-luna");
		expect(explore.thinking).toBe("medium");
		expect(explore.systemPrompt).toContain("Agent type: Explore");
		expect(explore.systemPrompt).toMatch(/file search specialist/i);

		const guided = await resolveExecWorker(
			{ task: "where is X?", type: "Explore", systemPrompt: "Prefer src/ over tests/." },
			{ cwd },
		);
		expect(guided.systemPrompt).toContain("Agent type: Explore");
		expect(guided.systemPrompt).toMatch(/file search specialist/i);
		expect(guided.systemPrompt).toContain("Prefer src/ over tests/.");

		const implement = await resolveExecWorker({ task: "apply the spec", type: "Implement" }, { cwd });
		expect(implement.tools).toEqual(expect.arrayContaining(["read", "bash", "edit", "write"]));
		expect(implement.thinking).toBe("high");

		const narrowed = await resolveExecWorker(
			{ task: "apply the spec", type: "Implement", tools: ["read", "edit"], thinking: "low", model: "xai/explicit" },
			{ cwd },
		);
		expect(narrowed.tools).toEqual(["read", "edit"]);
		expect(narrowed.thinking).toBe("low");
		expect(narrowed.model).toBe("xai/explicit");

		await expect(resolveExecWorker({ task: "nope", type: "not-a-lane" }, { cwd })).rejects.toThrow(
			/Unknown or disabled agent type/,
		);
	});

	it("routes a typed agents.run worker through modes.json", async () => {
		const root = mkdtempSync(join(tmpdir(), "apple-pi-exec-type-"));
		const globalRoot = join(root, "pi-agent");
		mkdirSync(globalRoot, { recursive: true });
		writeFileSync(
			join(globalRoot, "modes.json"),
			JSON.stringify({
				modes: {
					counsel: { provider: "anthropic", modelId: "route-counsel", thinkingLevel: "high" },
				},
			}),
		);
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = globalRoot;
		try {
			const available = [{ provider: "anthropic", id: "route-counsel", name: "route-counsel" }];
			const resolved = await resolveExecWorker(
				{ task: "should we split this module?", type: "Counsel" },
				{
					cwd: root,
					parentModel: "openai-codex/parent",
					parentModelObject: { provider: "openai-codex", id: "parent" },
					registry: {
						find: (provider, modelId) => available.find((model) => model.provider === provider && model.id === modelId),
						getAvailable: () => available,
					},
				},
			);
			expect(resolved.model).toBe("anthropic/route-counsel");
			expect(resolved.thinking).toBe("high");
			expect(resolved.tools).toEqual(["read", "bash", "grep", "find", "ls"]);
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects oversized or non-serializable context", () => {
		expect(() => serializeAgentContext(undefined)).toThrow(/JSON-serializable/);
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		expect(() => serializeAgentContext(cycle)).toThrow(/JSON-serializable/);
		expect(() => serializeAgentContext("x".repeat(MAX_AGENT_CONTEXT_CHARS))).toThrow(/exceeds/);
	});

	it("normalizes outputSchema and rejects a non-object schema", () => {
		expect(
			parseAgentRequest({
				task: "judge",
				outputSchema: { properties: { id: { type: "number" } }, required: ["id"] },
			}).outputSchema,
		).toEqual({
			type: "object",
			properties: { id: { type: "number" } },
			required: ["id"],
			additionalProperties: false,
		});
		expect(() => parseAgentRequest({ task: "judge", outputSchema: { type: "string" } })).toThrow(
			/must describe an object/,
		);
	});

	it("accepts a matching structured return and rejects a missing or invalid one", () => {
		const schema = {
			type: "object",
			properties: { id: { type: "number" } },
			required: ["id"],
			additionalProperties: false,
		};
		expect(resolveStructuredOutput(schema, { id: 7 })).toEqual({ value: { id: 7 } });
		expect(resolveStructuredOutput(schema, undefined).error).toMatch(new RegExp(PI_EXEC_RETURN_TOOL));
		expect(resolveStructuredOutput(schema, { id: "nope" }).error).toMatch(/validation failed/);
		expect(resolveStructuredOutput(undefined, { id: 7 })).toEqual({});
	});

	it("injects the worker-only return extension without host extensions", () => {
		const schema = {
			type: "object",
			properties: { id: { type: "number" } },
			required: ["id"],
			additionalProperties: false,
		};
		const prepared = prepareAgentSpawn({ task: "judge", outputSchema: schema }, { tools: ["read", "grep"] });
		try {
			const toolsFlag = prepared.args.indexOf("--tools");
			expect(prepared.args[toolsFlag + 1]).toBe(`read,grep,${PI_EXEC_RETURN_TOOL}`);
			expect(prepared.args).toContain("--no-extensions");
			expect(prepared.args).toContain("--extension");
			expect(prepared.args[prepared.args.indexOf("--extension") + 1]).toBe(WORKER_RETURN_EXTENSION_PATH);
			expect(prepared.args.join("\0")).toContain(OUTPUT_SCHEMA_GUIDANCE);
			expect(prepared.env?.[PI_EXEC_OUTPUT_SCHEMA_ENV]).toBeDefined();
			expect(JSON.parse(readFileSync(prepared.env![PI_EXEC_OUTPUT_SCHEMA_ENV]!, "utf8"))).toEqual(schema);
			expect(agentOperationArgs({ task: "judge", outputSchema: schema })).toEqual({
				task: "judge",
				outputSchema: { bound: true, chars: JSON.stringify(schema).length },
			});
		} finally {
			prepared.cleanup();
		}
		expect(existsSync(prepared.env![PI_EXEC_OUTPUT_SCHEMA_ENV]!)).toBe(false);
	});

	it("registers the worker-only return tool from the explicit extension", async () => {
		const schema = {
			type: "object",
			properties: { id: { type: "number" } },
			required: ["id"],
			additionalProperties: false,
		};
		const prepared = prepareAgentSpawn({ task: "judge", outputSchema: schema }, { tools: ["read"] });
		const previous = process.env[PI_EXEC_OUTPUT_SCHEMA_ENV];
		process.env[PI_EXEC_OUTPUT_SCHEMA_ENV] = prepared.env?.[PI_EXEC_OUTPUT_SCHEMA_ENV];
		try {
			const loaded = await loadExtensions(
				[WORKER_RETURN_EXTENSION_PATH],
				process.cwd(),
				createEventBus(),
				createExtensionRuntime(),
			);
			expect(loaded.errors).toEqual([]);
			expect([...loaded.extensions.flatMap((extension) => [...extension.tools.keys()])]).toEqual([PI_EXEC_RETURN_TOOL]);
		} finally {
			if (previous === undefined) delete process.env[PI_EXEC_OUTPUT_SCHEMA_ENV];
			else process.env[PI_EXEC_OUTPUT_SCHEMA_ENV] = previous;
			prepared.cleanup();
		}
	});

	it("writes context under tmpdir and redacts it from traces", () => {
		const payload = { ids: [1, 2], note: "bound" };
		const prepared = prepareAgentSpawn(
			{ task: "judge these rows", name: "judge", context: payload },
			{ tools: ["read", "grep"], model: "xai/test", thinking: "low" },
		);
		try {
			const attached = prepared.args.find((arg) => arg.startsWith("@"));
			expect(attached).toBeDefined();
			const path = attached!.slice(1);
			expect(path.startsWith(tmpdir())).toBe(true);
			expect(path.startsWith(process.cwd())).toBe(false);
			expect(readFileSync(path, "utf8")).toBe(JSON.stringify(payload));
			expect(statSync(path).mode & 0o077).toBe(0);
			expect(prepared.args).toContain("--name");
			expect(prepared.args).toContain("judge");
			expect(prepared.args.at(-1)).toBe("judge these rows");
			expect(prepared.args.join("\0")).toContain(CONTEXT_GUIDANCE);
			expect(agentOperationArgs({ task: "judge these rows", name: "judge", context: payload })).toEqual({
				task: "judge these rows",
				name: "judge",
				context: { bound: true, chars: JSON.stringify(payload).length },
			});
		} finally {
			prepared.cleanup();
		}
		const attached = prepared.args.find((arg) => arg.startsWith("@"));
		expect(existsSync(attached!.slice(1))).toBe(false);
	});
});

describe("pi_exec tool", () => {
	const register = () => {
		let tool: any;
		let resultHandler: any;
		runtime({
			registerTool(value: any) {
				tool = value;
			},
			on(event: string, handler: any) {
				if (event === "tool_result") resultHandler = handler;
			},
		} as any);
		return { tool, resultHandler };
	};

	it("publishes a live guest catalog on the registered tool", () => {
		const { tool } = register();
		expect(tool.promptGuidelines).toEqual([...PI_EXEC_PROMPT_GUIDELINES]);
		expect(tool.parameters.properties.display.description).toBe(PI_EXEC_DISPLAY_PARAMETER_DESCRIPTION);
		expect(tool.description).toContain(PI_EXEC_DESCRIPTION);
		expect(tool.description).toContain("pi.read({");
		expect(tool.description).toContain("outputSchema?");
		expect(tool.description).toContain("agent(request: AgentRequest)");
		expect(tool.parameters.properties.code.description).toBe(piExecGuestApiContract());
		expect(tool.parameters.properties.code.description).toContain("agents.run(");
		expect(tool.parameters.properties.code.description).toContain("outputSchema?: object");
		expect(tool.parameters.properties.code.description).toContain("value?: JSONValue");

		const echo = {
			name: "echo_value",
			label: "Echo",
			description: "Echo a supplied value",
			parameters: Type.Object({ value: Type.String() }),
			async execute() {
				return { content: [{ type: "text", text: "ok" }] };
			},
		};
		const runner = Object.create(ExtensionRunner.prototype) as any;
		runner.extensions = [{ tools: new Map([["echo_value", { definition: echo }]]) }];
		ExtensionRunner.prototype.getAllRegisteredTools.call(runner);

		expect(tool.parameters.properties.code.description).toContain("extensions.echo_value({ value: string })");
		expect(tool.description).toContain("extensions.echo_value({ value: string })");
	});

	it("bounds broad Promise.all fan-out through the harness-owned envelope", async () => {
		const dir = mkdtempSync(join(tmpdir(), "apple-pi-exec-"));
		try {
			for (let index = 0; index < 10; index++) {
				writeFileSync(join(dir, `${index}.txt`), String(index), "utf8");
			}
			const { tool } = register();
			const result = await tool.execute(
				"fanout",
				{
					code: `return Promise.all(Array.from({ length: 10 }, (_, index) => pi.read({ path: index + ".txt" })));`,
				},
				undefined,
				undefined,
				{ cwd: dir },
			);
			expect(JSON.parse(result.content[0].text)).toHaveLength(10);
			expect(result.details.trace.operations).toHaveLength(10);
			expect(result.details.activity.calls).toHaveLength(10);
			expect(result.details.activity.calls.every((call: any) => call.status === "succeeded")).toBe(true);
			expect(result.details.policy).toEqual(
				deriveProgramEnvelope(
					`return Promise.all(Array.from({ length: 10 }, (_, index) => pi.read({ path: index + ".txt" })));`,
				),
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("scales the envelope from optional tool-call limits and clamps to package maxima", () => {
		const workers = 'return agent({ task: "x" });';
		const plain = "return 1;";
		expect(deriveProgramEnvelope(workers).agentBudget).toBe(8);
		expect(deriveProgramEnvelope(workers, { agentBudget: 32 }).agentBudget).toBe(32);
		expect(deriveProgramEnvelope(workers, { agentBudget: 9_999 }).agentBudget).toBe(
			PROGRAM_ENVELOPE_MAXIMA.agentBudget,
		);
		expect(deriveProgramEnvelope(plain, { agentBudget: 32 }).agentBudget).toBe(0);
		expect(deriveProgramEnvelope(plain, { callBudget: 12 }).callBudget).toBe(12);
		expect(deriveProgramEnvelope(plain, { timeoutSeconds: 90 }).timeoutSeconds).toBe(90);
	});

	it("fails when a program exceeds its harness-owned call envelope", async () => {
		const dir = mkdtempSync(join(tmpdir(), "apple-pi-exec-envelope-"));
		try {
			const template = (count: number) =>
				`return Promise.all(Array.from({ length: ${count} }, (_, index) => pi.read({ path: index + ".txt" })));`;
			const count = deriveProgramEnvelope(template(100)).callBudget + 1;
			for (let index = 0; index < count; index++) writeFileSync(join(dir, `${index}.txt`), String(index), "utf8");
			const { tool } = register();
			await expect(
				tool.execute("call-envelope", { code: template(count) }, undefined, undefined, { cwd: dir }),
			).rejects.toThrow(/call budget exhausted/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("honors a lowered callBudget limit", async () => {
		const dir = mkdtempSync(join(tmpdir(), "apple-pi-exec-limit-"));
		try {
			for (let index = 0; index < 3; index++) writeFileSync(join(dir, `${index}.txt`), String(index), "utf8");
			const { tool } = register();
			await expect(
				tool.execute(
					"lowered-calls",
					{
						code: `return Promise.all([0, 1, 2].map((index) => pi.read({ path: index + ".txt" })));`,
						limits: { callBudget: 2 },
					},
					undefined,
					undefined,
					{ cwd: dir },
				),
			).rejects.toThrow(/call budget exhausted \(2\)/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fetches HTTP resources through a bounded, traced host call", async () => {
		const server = createServer((request, response) => {
			if (request.method === "HEAD") {
				response.writeHead(200, { "content-length": String(20 * 1_024 * 1_024) });
				response.end();
				return;
			}
			if (request.url === "/max") {
				const body = Buffer.alloc(10 * 1_024 * 1_024);
				response.writeHead(200, { "content-length": String(body.byteLength) });
				response.end(body);
				return;
			}
			if (request.url === "/too-large") {
				response.writeHead(200, { "content-length": String(10 * 1_024 * 1_024 + 1) });
				response.end();
				return;
			}
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ source: "local" }));
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("test server did not expose a port");
			const { tool } = register();
			const result = await tool.execute(
				"fetch",
				{
					code: "const response = await fetch(inputs.url); return { status: response.status, value: await response.json() };",
					inputs: { url: `http://127.0.0.1:${address.port}/data` },
				},
				undefined,
				undefined,
				{ cwd: process.cwd() },
			);
			expect(JSON.parse(result.content[0].text)).toEqual({ status: 200, value: { source: "local" } });
			expect(result.details.trace.operations).toEqual([
				expect.objectContaining({
					ref: "fetch",
					args: { url: `http://127.0.0.1:${address.port}/data`, method: "GET" },
					result: { status: 200, url: `http://127.0.0.1:${address.port}/data`, bodyBytes: 18 },
					outcome: "succeeded",
				}),
			]);

			const head = await tool.execute(
				"fetch-head",
				{
					code: "const response = await fetch(inputs.url, { method: 'HEAD' }); return { status: response.status, body: await response.text() };",
					inputs: { url: `http://127.0.0.1:${address.port}/large` },
				},
				undefined,
				undefined,
				{ cwd: process.cwd() },
			);
			expect(JSON.parse(head.content[0].text)).toEqual({ status: 200, body: "" });

			const maxBody = await tool.execute(
				"fetch-max-body",
				{
					code: "const response = await fetch(inputs.url); return (await response.text()).length;",
					inputs: { url: `http://127.0.0.1:${address.port}/max` },
				},
				undefined,
				undefined,
				{ cwd: process.cwd() },
			);
			expect(maxBody.content[0].text).toBe(String(10 * 1_024 * 1_024));

			await expect(
				tool.execute(
					"fetch-large-response",
					{
						code: "await fetch(inputs.url);",
						inputs: { url: `http://127.0.0.1:${address.port}/too-large` },
					},
					undefined,
					undefined,
					{ cwd: process.cwd() },
				),
			).rejects.toThrow("fetch response exceeds 10,485,760 bytes");

			await expect(
				tool.execute(
					"fetch-large-request",
					{
						code: "await fetch(inputs.url, { method: 'POST', body: 'x'.repeat(10 * 1024 * 1024 + 1) });",
						inputs: { url: `http://127.0.0.1:${address.port}/upload` },
					},
					undefined,
					undefined,
					{ cwd: process.cwd() },
				),
			).rejects.toThrow("fetch request exceeds 10,485,760 bytes");
		} finally {
			await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		}
	});

	it("reads session skills through the guest skills API", async () => {
		const dir = mkdtempSync(join(tmpdir(), "apple-pi-exec-skills-"));
		try {
			const { tool } = register();
			const result = await tool.execute(
				"skills",
				{
					code: `
const listed = await skills.list();
const body = await skills.body({ name: "pi-review" });
return {
  names: listed.map((skill) => skill.name),
  starts: body.slice(0, 8),
};
`,
				},
				undefined,
				undefined,
				{ cwd: dir },
			);
			const value = JSON.parse(result.content[0].text);
			expect(value.names).toContain("pi-review");
			expect(value.starts).toBe("# Review");
			expect(result.details.trace.operations.map((operation: any) => operation.ref)).toEqual([
				"skills.list",
				"skills.body",
			]);
			await expect(
				tool.execute(
					"missing-skill",
					{ code: `return skills.body({ name: "no-such-apple-pi-skill" });` },
					undefined,
					undefined,
					{ cwd: dir },
				),
			).rejects.toThrow(/Unknown skill: no-such-apple-pi-skill/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("sequences write and read through the core-tool bridge", async () => {
		const dir = mkdtempSync(join(tmpdir(), "apple-pi-exec-write-"));
		try {
			const { tool } = register();
			const result = await tool.execute(
				"write-read",
				{
					code: `
const written = await pi.write({ path: "result.txt", content: "hello from exec" });
if (!written.ok) throw new Error(written.output);
return pi.read({ path: "result.txt" });
`,
				},
				undefined,
				undefined,
				{ cwd: dir },
			);
			expect(result.content[0].text).toContain("hello from exec");
			expect(result.details.trace.operations.map((operation: any) => operation.ref)).toEqual(["pi.write", "pi.read"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("discovers and invokes registered extension tools inside the program", async () => {
		const { tool } = register();
		const echo = {
			name: "echo_value",
			label: "Echo",
			description: "Echo a supplied value",
			parameters: Type.Object({ value: Type.String() }),
			async execute(_id: string, params: { value: string }) {
				return { content: [{ type: "text", text: `echo:${params.value}` }], details: { echoed: true } };
			},
		};
		const runner = Object.create(ExtensionRunner.prototype) as any;
		runner.extensions = [{ tools: new Map([["echo_value", { definition: echo }]]) }];
		ExtensionRunner.prototype.getAllRegisteredTools.call(runner);
		const childRunner = Object.create(ExtensionRunner.prototype) as any;
		childRunner.extensions = [{ tools: new Map([["child_only", { definition: { ...echo, name: "child_only" } }]]) }];
		runInChildSessionContext(() => ExtensionRunner.prototype.getAllRegisteredTools.call(childRunner));
		// Pi replaces the root runner on /reload; that non-child catalog must win.
		const reloaded = { ...echo, name: "reload_value" };
		const reloadedRoot = Object.create(ExtensionRunner.prototype) as any;
		reloadedRoot.extensions = [
			{
				tools: new Map([
					["echo_value", { definition: echo }],
					["reload_value", { definition: reloaded }],
				]),
			},
		];
		ExtensionRunner.prototype.getAllRegisteredTools.call(reloadedRoot);
		childRunner.extensions = [
			{ tools: new Map([["late_child_only", { definition: { ...echo, name: "late_child_only" } }]]) },
		];
		ExtensionRunner.prototype.getAllRegisteredTools.call(childRunner);

		const result = await tool.execute(
			"extension-call",
			{
				code: `
const available = await tools.list();
const echoed = await extensions.echo_value({ value: "hello" });
return { names: available.map((tool) => tool.name), text: echoed.text };
`,
			},
			undefined,
			undefined,
			{ cwd: process.cwd() },
		);
		expect(JSON.parse(result.content[0].text)).toEqual({ names: ["echo_value", "reload_value"], text: "echo:hello" });
		expect(result.details.trace.operations[1]).toMatchObject({ ref: "extensions.echo_value", outcome: "succeeded" });
	});

	it("mounts and clears the live activity widget in TUI mode", async () => {
		const widgets: Array<{ key: string; content: unknown }> = [];
		let widgetLines: string[] = [];
		const { tool } = register();
		await tool.execute(
			"widget",
			{ code: "await sleep(5); return 1;", display: { name: "Inspect release" } },
			undefined,
			undefined,
			{
				cwd: process.cwd(),
				hasUI: true,
				mode: "tui",
				ui: {
					setWidget(key: string, content: unknown) {
						widgets.push({ key, content });
						if (typeof content === "function") {
							const component = content({ requestRender() {} }, theme);
							widgetLines = component.render(120);
						}
					},
					notify() {},
				},
			},
		);
		expect(widgets[0]).toMatchObject({ key: "apple-pi:exec-activity" });
		expect(typeof widgets[0].content).toBe("function");
		expect(widgetLines.join("\n")).toContain("Pi Exec Inspect release · starting");
		expect(widgets.at(-1)).toEqual({ key: "apple-pi:exec-activity", content: undefined });
	});

	it("reattaches durable trace details to failed tool results", async () => {
		const { tool, resultHandler } = register();
		await expect(
			tool.execute("failure", { code: "await pi.read({ path: 42 });" }, undefined, undefined, { cwd: process.cwd() }),
		).rejects.toThrow("Invalid pi.read arguments");

		const patch = resultHandler({
			toolName: "pi_exec",
			toolCallId: "failure",
			isError: true,
		});
		expect(patch.details.trace.kind).toBe("apple-pi.execution");
		expect(patch.details.trace.operations[0]).toMatchObject({
			ref: "pi.read",
			outcome: "failed",
		});
	});
});

describe("pi_exec TUI rendering", () => {
	it("renders an objective, bounded code preview, and expansion hint", () => {
		const component = renderExecCall(
			{
				code: Array.from({ length: 12 }, (_, index) => `const v${index} = ${index};`).join("\n"),
				display: { name: "Inspect release", description: "Map independent tracks" },
			},
			theme,
			{ expanded: false, isError: false },
		);
		const text = component.render(120).join("\n");
		expect(text).toContain("pi_exec Inspect release JavaScript · 12 lines");
		expect(text).toContain("Map independent tracks");
		expect(text).toContain("4 lines hidden · ctrl-o to expand");
	});

	it("renders live call states and elapsed summary", () => {
		const component = renderExecResult(
			{
				content: [{ type: "text", text: "working" }],
				details: {
					activity: {
						name: "Release map",
						startedAt: Date.now() - 1_000,
						calls: [
							{
								sequence: 0,
								ref: "agents.run",
								args: { task: "inspect runtime" },
								status: "running",
								activity: "thinking",
							},
							{ sequence: 1, ref: "pi.read", args: { path: "README.md" }, status: "succeeded" },
						],
					},
				},
			},
			{ expanded: false, isPartial: true },
			theme,
			{ expanded: false, isError: false },
		);
		const text = component.render(120).join("\n");
		expect(text).toContain("Pi Exec Release map · 1/2 calls · 1 running");
		expect(text).toContain("agent inspect runtime · thinking");
		expect(text).toContain("read README.md");
	});

	it("labels workers by name when present", () => {
		const component = renderExecResult(
			{
				content: [{ type: "text", text: "working" }],
				details: {
					activity: {
						name: "Release map",
						startedAt: Date.now() - 1_000,
						calls: [
							{
								sequence: 0,
								ref: "agents.run",
								args: { task: "inspect runtime", name: "reviewer" },
								status: "running",
								activity: "thinking",
							},
						],
					},
				},
			},
			{ expanded: false, isPartial: true },
			theme,
			{ expanded: false, isError: false },
		);
		const text = component.render(120).join("\n");
		expect(text).toContain("agent reviewer · thinking");
		expect(text).not.toContain("agent inspect runtime");
	});
});
