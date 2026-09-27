import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExtensionRunner } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { PAIR_EXTENSION_PATH } from "../extensions/pi-pair.js";
import runtime, {
	aggregateUsage,
	deriveProgramEnvelope,
	listSkills,
	PROGRAM_ENVELOPE_MAXIMA,
	readSkillBody,
} from "../extensions/runtime.js";
import {
	AUTO_COMPACT_EXTENSION_PATH,
	agentOperationArgs,
	VROOM_EXTENSION_PATH,
	CONTEXT_GUIDANCE,
	HOME_SEARCH_GUARD_EXTENSION_PATH,
	LEDGER_EXTENSION_PATH,
	OUTPUT_SCHEMA_GUIDANCE,
	PI_EXEC_OUTPUT_SCHEMA_ENV,
	PI_EXEC_RETURN_TOOL,
	parseAgentRequest,
	prepareAgentSpawn,
	resolveExecWorker,
	resolveStructuredOutput,
	SESSION_SEARCH_EXTENSION_PATH,
	serializeAgentContext,
	WIKI_EXTENSION_PATH,
	WIKI_TOOL_NAMES,
	WORKER_RETURN_EXTENSION_PATH,
} from "../extensions/runtime-agent.js";
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

describe("pi_exec usage", () => {
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
});

describe("pi_exec skills", () => {
	it("lists packaged skills and returns a stripped body", () => {
		const dir = mkdtempSync(join(tmpdir(), "apple-pi-skills-"));
		try {
			const names = listSkills({ cwd: dir, includeDefaults: false }).map((skill) => skill.name);
			expect(names).toContain("code-review");
			expect(names).not.toContain("review");
			expect(names).toContain("tdd");
			expect(names).toContain("resolving-merge-conflicts");
			expect(names).toContain("ralph");
			expect(names).not.toContain("implement");
			expect(names).not.toContain("improve-codebase-architecture");
			expect(names).not.toContain("interrogate-to-design");
			expect(names).not.toContain("to-spec");
			expect(names).not.toContain("to-tickets");
			expect(names).not.toContain("wayfinder");
			expect(() => readSkillBody("implement", { cwd: dir, includeDefaults: false })).toThrow(/Unknown skill/);
			expect(() => readSkillBody("improve-codebase-architecture", { cwd: dir, includeDefaults: false })).toThrow(
				/Unknown skill/,
			);
			expect(() => readSkillBody("interrogate-to-design", { cwd: dir, includeDefaults: false })).toThrow(
				/Unknown skill/,
			);
			expect(() => readSkillBody("to-spec", { cwd: dir, includeDefaults: false })).toThrow(/Unknown skill/);
			expect(() => readSkillBody("to-tickets", { cwd: dir, includeDefaults: false })).toThrow(/Unknown skill/);
			expect(() => readSkillBody("wayfinder", { cwd: dir, includeDefaults: false })).toThrow(/Unknown skill/);
			const body = readSkillBody("code-review", { cwd: dir, includeDefaults: false });
			expect(body.startsWith("# Code Review")).toBe(true);
			expect(body).not.toMatch(/^---/);
			const tddBody = readSkillBody("tdd", { cwd: dir, includeDefaults: false });
			expect(tddBody.startsWith("# Test-Driven Development")).toBe(true);
			const conflictBody = readSkillBody("resolving-merge-conflicts", { cwd: dir, includeDefaults: false });
			expect(conflictBody.startsWith("# Resolving Merge Conflicts")).toBe(true);
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
			const hiddenRoot = join(dir, "skills", "hidden");
			mkdirSync(hiddenRoot, { recursive: true });
			writeFileSync(
				join(hiddenRoot, "SKILL.md"),
				"---\nname: hidden\ndescription: Human-only fixture.\ndisable-model-invocation: true\n---\n\n# Hidden\n",
				"utf8",
			);
			const options = { cwd: dir, skillPaths: [join(dir, "skills")], includeDefaults: false };
			expect(listSkills(options)).toEqual([{ name: "demo", description: "Demo skill for catalog tests." }]);
			expect(readSkillBody("demo", options)).toBe("# Demo\n\nBody only.");
			expect(() => readSkillBody("hidden", options)).toThrow(/Unknown skill/);
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
		expect(parseAgentRequest({ task: "map auth", type: "  explorer  ", profile: "deep", pair: true })).toEqual({
			task: "map auth",
			type: "explorer",
			profile: "deep",
			pair: true,
		});
		expect(agentOperationArgs({ task: "map auth", type: "explorer", pair: false })).toEqual({
			task: "map auth",
			type: "explorer",
			pair: false,
		});
	});

	it("rejects empty tasks, padded profiles, and invalid pair values", () => {
		expect(() => parseAgentRequest({ task: "   " })).toThrow(/non-empty task/);
		expect(() => parseAgentRequest({ task: "inspect", profile: " deep" })).toThrow(/unpadded/);
		expect(() => parseAgentRequest({ task: "inspect", pair: "on" })).toThrow(/pair must be a boolean/);
	});

	it("resolves catalog defaults and explicit profile overrides for agent.run", async () => {
		const cwd = process.cwd();
		const agentDir = mkdtempSync(join(tmpdir(), "apple-pi-exec-profiles-"));
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		writeFileSync(
			join(agentDir, "model-profiles.json"),
			JSON.stringify({
				profiles: {
					quick: { model: "xai/fast", thinking: "medium" },
					coding: { model: "xai/coder", thinking: "high" },
					deep: { model: "anthropic/deep", thinking: "xhigh" },
				},
			}),
		);
		const available = [
			{ provider: "xai", id: "fast" },
			{ provider: "xai", id: "coder" },
			{ provider: "anthropic", id: "deep" },
		];
		const options = {
			cwd,
			registry: {
				find: (provider: string, id: string) =>
					available.find((model) => model.provider === provider && model.id === id),
			},
		};
		try {
			const untyped = await resolveExecWorker({ task: "inspect" }, { cwd });
			expect(untyped).toEqual({ tools: ["read", "grep", "find", "ls"], pair: false });

			const custom = await resolveExecWorker(
				{ task: "review this diff", systemPrompt: "Focus on API boundaries." },
				{ cwd, parentModel: "xai/parent", parentThinking: "low" },
			);
			expect(custom.tools).toEqual(["read", "grep", "find", "ls"]);
			expect(custom.systemPrompt).toBe("Focus on API boundaries.");
			expect(custom.model).toBe("xai/parent");

			const explore = await resolveExecWorker({ task: "where is X?", type: "explorer" }, options);
			expect(explore.type).toBe("explorer");
			expect(explore.tools).toEqual(expect.arrayContaining(["read", "bash", "grep", "find", "ls"]));
			expect(explore.tools).not.toContain("edit");
			expect(explore.tools).not.toContain("write");
			expect(explore.model).toBe("xai/fast");
			expect(explore.thinking).toBe("medium");
			expect(explore.systemPrompt).toContain("Agent type: explorer");
			expect(explore.systemPrompt).toMatch(/team's codebase scout/i);

			const guided = await resolveExecWorker(
				{ task: "where is X?", type: "explorer", systemPrompt: "Prefer src/ over tests/." },
				options,
			);
			expect(guided.systemPrompt).toContain("Agent type: explorer");
			expect(guided.systemPrompt).toContain("Prefer src/ over tests/.");

			const implement = await resolveExecWorker({ task: "apply the spec", type: "builder" }, options);
			expect(implement.tools).toEqual(expect.arrayContaining(["read", "bash", "edit", "write"]));
			expect(implement.pair).toBe(true);
			expect(implement.model).toBe("xai/coder");
			expect(implement.thinking).toBe("high");

			const overridden = await resolveExecWorker(
				{ task: "apply the spec", type: "builder", tools: ["read", "edit"], profile: "deep" },
				options,
			);
			expect(overridden.tools).toEqual(["read", "edit"]);
			expect(overridden.thinking).toBe("xhigh");
			expect(overridden.model).toBe("anthropic/deep");

			const optedOut = await resolveExecWorker({ task: "apply the spec", type: "builder", pair: false }, options);
			expect(optedOut.pair).toBe(false);

			await expect(resolveExecWorker({ task: "nope", type: "not-a-lane" }, options)).rejects.toThrow(
				/Unknown or disabled agent type/,
			);
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
			rmSync(agentDir, { recursive: true, force: true });
		}
	});

	it("routes a typed agent.run worker through its semantic model profile", async () => {
		const root = mkdtempSync(join(tmpdir(), "apple-pi-exec-type-"));
		const globalRoot = join(root, "pi-agent");
		mkdirSync(globalRoot, { recursive: true });
		writeFileSync(
			join(globalRoot, "model-profiles.json"),
			JSON.stringify({ profiles: { deep: { model: "anthropic/route-advisor", thinking: "high" } } }),
		);
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = globalRoot;
		try {
			const available = [{ provider: "anthropic", id: "route-advisor", name: "route-advisor" }];
			const resolved = await resolveExecWorker(
				{ task: "should we split this module?", type: "consultant" },
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
			expect(resolved.model).toBe("anthropic/route-advisor");
			expect(resolved.thinking).toBe("high");
			expect(resolved.tools).toContain("bash");
			expect(resolved.tools).not.toContain("edit");
			expect(resolved.tools).not.toContain("write");
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects non-serializable context", () => {
		expect(() => serializeAgentContext(undefined)).toThrow(/JSON-serializable/);
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		expect(() => serializeAgentContext(cycle)).toThrow(/JSON-serializable/);
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

	it("accepts a matching structured return of any serialized length and rejects a missing or invalid one", () => {
		const schema = {
			type: "object",
			properties: { id: { type: "number" } },
			required: ["id"],
			additionalProperties: false,
		};
		expect(resolveStructuredOutput(schema, { id: 7 })).toEqual({ value: { id: 7 } });
		const largeSchema = {
			type: "object",
			properties: { text: { type: "string" } },
			required: ["text"],
			additionalProperties: false,
		};
		const largeValue = { text: "x".repeat(75_000) };
		expect(resolveStructuredOutput(largeSchema, largeValue)).toEqual({ value: largeValue });
		expect(resolveStructuredOutput(schema, undefined).error).toMatch(new RegExp(PI_EXEC_RETURN_TOOL));
		expect(resolveStructuredOutput(schema, { id: "nope" }).error).toMatch(/validation failed/);
		expect(resolveStructuredOutput(undefined, { id: 7 })).toEqual({});
	});

	it("injects pair programmer for an enabled worker and preserves explicit extension isolation", () => {
		const schema = {
			type: "object",
			properties: { id: { type: "number" } },
			required: ["id"],
			additionalProperties: false,
		};
		const prepared = prepareAgentSpawn(
			{ task: "apply the spec", outputSchema: schema },
			{ tools: ["read", "edit"], projectTrusted: false, pair: true },
		);
		try {
			const toolsFlag = prepared.args.indexOf("--tools");
			expect(prepared.args[toolsFlag + 1]).toBe([`read`, `edit`, PI_EXEC_RETURN_TOOL, ...WIKI_TOOL_NAMES].join(","));
			expect(prepared.args).toContain("--no-extensions");
			expect(prepared.args).toContain("--no-approve");
			expect(prepared.args.filter((_, index, args) => args[index - 1] === "--extension")).toEqual([
				AUTO_COMPACT_EXTENSION_PATH,
				VROOM_EXTENSION_PATH,
				HOME_SEARCH_GUARD_EXTENSION_PATH,
				LEDGER_EXTENSION_PATH,
				WIKI_EXTENSION_PATH,
				SESSION_SEARCH_EXTENSION_PATH,
				PAIR_EXTENSION_PATH,
				WORKER_RETURN_EXTENSION_PATH,
			]);
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
		const prepared = prepareAgentSpawn(
			{ task: "judge", outputSchema: schema },
			{ tools: ["read"], projectTrusted: false },
		);
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

	it("writes context larger than 50,000 characters under tmpdir and redacts it from traces", () => {
		const payload = { ids: [1, 2], note: "x".repeat(75_000) };
		const prepared = prepareAgentSpawn(
			{ task: "judge these rows", name: "judge", context: payload },
			{ tools: ["read", "grep"], projectTrusted: true, model: "xai/test", thinking: "low" },
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
			expect(prepared.args).toContain("--approve");
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
		const tools = new Map<string, any>();
		let resultHandler: any;
		let shutdownHandler: any;
		const handlers = new Map<string, any[]>();
		runtime({
			registerTool(value: any) {
				tools.set(value.name, value);
			},
			on(event: string, handler: any) {
				if (event === "tool_result") resultHandler = handler;
				if (event === "session_shutdown") shutdownHandler = handler;
				const list = handlers.get(event) ?? [];
				list.push(handler);
				handlers.set(event, list);
			},
		} as any);
		return {
			tools,
			tool: tools.get("pi_exec"),
			resultHandler,
			shutdownHandler,
			emit(event: string, data: any = {}, ctx: any = {}) {
				for (const h of handlers.get(event) ?? []) h(data, ctx);
			},
		};
	};

	it("rejects a wrong core-tool keyword before dispatching any host call", async () => {
		const { tool, resultHandler } = register();
		const id = "invalid-keyword";
		await expect(
			tool.execute(id, { code: 'await read(path="README.md")\nawait read(pat="README.md")' }, undefined, undefined, {
				cwd: process.cwd(),
				sessionManager: { getSessionId: () => id },
			}),
		).rejects.toThrow(/unknown-argument|pat.*argument/i);
		const failure = resultHandler({ toolName: "pi_exec", isError: true, toolCallId: id });
		expect(failure.details.trace.operations).toEqual([]);
	});

	it("type-checks against the active parent core-tool schema", async () => {
		const { tool } = register();
		let calls = 0;
		const read = {
			name: "read",
			label: "Read",
			description: "Read a location",
			parameters: Type.Object({ location: Type.String() }),
			async execute(_id: string, args: { location: string }) {
				calls++;
				return { content: [{ type: "text", text: args.location }] };
			},
		};
		const runner = Object.create(ExtensionRunner.prototype) as any;
		runner.extensions = [
			{
				tools: new Map([
					["read", { definition: read }],
					["pi_exec", { definition: { ...read, name: "pi_exec" } }],
				]),
			},
		];
		ExtensionRunner.prototype.getAllRegisteredTools.call(runner);
		try {
			expect(tool.parameters.properties.code.description).toContain("async def read(*, location: str)");
			const result = await tool.execute(
				"custom-core",
				{ code: 'await read(location="example.txt")' },
				undefined,
				undefined,
				{ cwd: process.cwd(), sessionManager: { getSessionId: () => "custom-core" } },
			);
			expect(result.content[0].text).toBe("example.txt");
			expect(calls).toBe(1);
		} finally {
			runner.extensions = [{ tools: new Map([["pi_exec", { definition: { ...read, name: "pi_exec" } }]]) }];
			ExtensionRunner.prototype.getAllRegisteredTools.call(runner);
		}
	});

	it("type-checks nested edit arguments before the preceding write", async () => {
		const dir = mkdtempSync(join(tmpdir(), "apple-pi-monty-preflight-"));
		try {
			const { tool, resultHandler } = register();
			const id = "invalid-edit";
			await expect(
				tool.execute(
					id,
					{
						code: 'await write(path="example.txt", content="before")\nawait edit(path="example.txt", edits=[{"oldText": 1, "newText": "after"}])',
					},
					undefined,
					undefined,
					{ cwd: dir, sessionManager: { getSessionId: () => id } },
				),
			).rejects.toThrow(/oldText|invalid-argument/i);
			expect(resultHandler({ toolName: "pi_exec", isError: true, toolCallId: id }).details.trace.operations).toEqual(
				[],
			);
			expect(existsSync(join(dir, "example.txt"))).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("queues gathered core calls at the configured concurrency", async () => {
		const { tool } = register();
		let active = 0;
		let peak = 0;
		const read = {
			name: "read",
			label: "Read",
			description: "Read a path",
			parameters: Type.Object({ path: Type.String() }),
			async execute(_id: string, args: { path: string }) {
				active++;
				peak = Math.max(peak, active);
				await new Promise((resolve) => setTimeout(resolve, 20));
				active--;
				return { content: [{ type: "text", text: args.path }] };
			},
		};
		const runner = Object.create(ExtensionRunner.prototype) as any;
		runner.extensions = [
			{
				tools: new Map([
					["read", { definition: read }],
					["pi_exec", { definition: { ...read, name: "pi_exec" } }],
				]),
			},
		];
		ExtensionRunner.prototype.getAllRegisteredTools.call(runner);
		const result = await tool.execute(
			"gather-core",
			{
				code: "import asyncio\nawait asyncio.gather(*[read(path=str(i)) for i in range(5)])",
				limits: { concurrency: 2 },
			},
			undefined,
			undefined,
			{ cwd: process.cwd(), sessionManager: { getSessionId: () => "gather-core" } },
		);
		expect(JSON.parse(result.content[0].text)).toEqual(["0", "1", "2", "3", "4"]);
		expect(peak).toBe(2);
		expect(result.details.trace.operations).toHaveLength(5);
		runner.extensions = [{ tools: new Map([["pi_exec", { definition: { ...read, name: "pi_exec" } }]]) }];
		ExtensionRunner.prototype.getAllRegisteredTools.call(runner);
	});

	it("cancels a pending core call even when Python catches Exception", async () => {
		const { tool, resultHandler } = register();
		const controller = new AbortController();
		const id = "cancelled-call";
		const execution = tool.execute(
			id,
			{ code: 'try:\n    await bash(command="sleep 10")\nexcept Exception:\n    "swallowed"' },
			controller.signal,
			undefined,
			{ cwd: process.cwd(), sessionManager: { getSessionId: () => id } },
		);
		setTimeout(() => controller.abort(), 100);
		await expect(execution).rejects.toThrow(/aborted/);
		const failure = resultHandler({ toolName: "pi_exec", isError: true, toolCallId: id });
		expect(failure.details.trace.outcome).toBe("aborted");
	});

	it("aborts a busy loop promptly and accepts another program", async () => {
		const { tool, resultHandler } = register();
		const controller = new AbortController();
		const ctx = { cwd: process.cwd(), sessionManager: { getSessionId: () => "busy-abort" } };
		const started = Date.now();
		const running = tool.execute(
			"busy-abort",
			{ code: "while True:\n    pass", limits: { timeoutSeconds: 5 } },
			controller.signal,
			undefined,
			ctx,
		);
		setTimeout(() => controller.abort(), 100);
		await expect(running).rejects.toThrow(/aborted/);
		expect(Date.now() - started).toBeLessThan(2_000);
		expect(resultHandler({ toolName: "pi_exec", isError: true, toolCallId: "busy-abort" }).details.trace.outcome).toBe(
			"aborted",
		);
		expect((await tool.execute("post-abort", { code: "1 + 1" }, undefined, undefined, ctx)).content[0].text).toBe("2");
	});

	it("aborting one invocation leaves a concurrent invocation running", async () => {
		const { tool } = register();
		const ctx = { cwd: process.cwd(), sessionManager: { getSessionId: () => "sibling" } };
		const sibling = tool.execute(
			"sibling",
			{ code: "import asyncio\nawait asyncio.sleep(0.5)\n42" },
			undefined,
			undefined,
			ctx,
		);
		const controller = new AbortController();
		const cancelled = tool.execute(
			"cancel-sibling",
			{ code: "while True:\n    pass", limits: { timeoutSeconds: 5 } },
			controller.signal,
			undefined,
			ctx,
		);
		setTimeout(() => controller.abort(), 100);
		await expect(cancelled).rejects.toThrow(/aborted/);
		expect((await sibling).content[0].text).toBe("42");
	});

	it("enforces the wall deadline during Monty-managed sleep", async () => {
		const { tool } = register();
		const started = Date.now();
		await expect(
			tool.execute(
				"sleep-deadline",
				{
					code: "import asyncio\nawait asyncio.sleep(0.8)\nwhile True:\n    pass",
					limits: { timeoutSeconds: 1 },
				},
				undefined,
				undefined,
				{ cwd: process.cwd(), sessionManager: { getSessionId: () => "sleep-deadline" } },
			),
		).rejects.toThrow(/timed out/);
		expect(Date.now() - started).toBeLessThan(2_500);
	});

	it("aborts a Monty-managed sleep without waiting for its timer", async () => {
		const { tool } = register();
		const controller = new AbortController();
		const started = Date.now();
		const running = tool.execute(
			"sleep-abort",
			{
				code: "import asyncio\nawait asyncio.sleep(4)\n1",
				limits: { timeoutSeconds: 5 },
			},
			controller.signal,
			undefined,
			{ cwd: process.cwd(), sessionManager: { getSessionId: () => "sleep-abort" } },
		);
		setTimeout(() => controller.abort(), 100);
		await expect(running).rejects.toThrow(/aborted/);
		expect(Date.now() - started).toBeLessThan(2_000);
	});

	it("stops runaway Python at the deadline and permits the next call", async () => {
		const { tool, resultHandler } = register();
		const ctx = { cwd: process.cwd(), sessionManager: { getSessionId: () => "runaway" } };
		await expect(
			tool.execute(
				"runaway",
				{ code: "while True:\n    pass", limits: { timeoutSeconds: 1 } },
				undefined,
				undefined,
				ctx,
			),
		).rejects.toThrow(/timed out|time limit exceeded/);
		expect(resultHandler({ toolName: "pi_exec", isError: true, toolCallId: "runaway" }).details.trace.outcome).toBe(
			"timed_out",
		);
		const next = await tool.execute("next", { code: "2 + 3" }, undefined, undefined, ctx);
		expect(next.content[0].text).toBe("5");
	});

	it("returns nested Python data as strict JSON and rejects non-JSON values", async () => {
		const { tool } = register();
		const ctx = { cwd: process.cwd(), sessionManager: { getSessionId: () => "json" } };
		const result = await tool.execute(
			"json",
			{ code: '{"a": [1, {"b": None}], "ok": True}' },
			undefined,
			undefined,
			ctx,
		);
		expect(JSON.parse(result.content[0].text)).toEqual({ a: [1, { b: null }], ok: true });
		await expect(tool.execute("set", { code: "{1, 2}" }, undefined, undefined, ctx)).rejects.toThrow(
			/not JSON-serializable/,
		);
		await expect(tool.execute("key", { code: "{1: 'value'}" }, undefined, undefined, ctx)).rejects.toThrow(
			/non-string dictionary key/,
		);
		await expect(tool.execute("negative-zero", { code: "-0.0" }, undefined, undefined, ctx)).rejects.toThrow(
			/JSON-serializable/,
		);
		await expect(
			tool.execute("function", { code: "def f():\n    return 1\nf" }, undefined, undefined, ctx),
		).rejects.toThrow(/JSON-serializable/);
		await expect(tool.execute("python-type", { code: "type(1)" }, undefined, undefined, ctx)).rejects.toThrow(
			/JSON-serializable/,
		);
		await expect(tool.execute("cycle", { code: "a = []\na.append(a)\na" }, undefined, undefined, ctx)).rejects.toThrow(
			/JSON-serializable/,
		);
	});

	it("shows schema-derived Python signatures to the model", () => {
		const { tool } = register();
		const contract = tool.parameters.properties.code.description;
		expect(contract).toContain("async def read(*, path: str");
		expect(contract).toContain("async def bash(*, command: str");
		expect(contract).toContain("asyncio.gather");
		expect(contract).not.toContain("pi.read({");
	});

	it("rejects JavaScript globals and preserves the search guard", async () => {
		const { tool } = register();
		const ctx = { cwd: process.cwd(), sessionManager: { getSessionId: () => "python-guard" } };
		await expect(
			tool.execute("js", { code: 'pi.read({"path": "README.md"})' }, undefined, undefined, ctx),
		).rejects.toThrow(/undefined|not defined|Unknown/i);
		await expect(
			tool.execute("search", { code: 'await find(pattern="*.ts", path="/")' }, undefined, undefined, ctx),
		).rejects.toThrow(/refusing to search from protected root/);
	});

	it("honors the core call budget and captures print without host calls", async () => {
		const { tool, resultHandler } = register();
		const ctx = { cwd: process.cwd(), sessionManager: { getSessionId: () => "budget" } };
		const output = await tool.execute("printed", { code: 'print("hello")\n2 + 3' }, undefined, undefined, ctx);
		expect(output.content[0].text).toBe("Logs:\nhello\n\n5");
		expect(output.details.trace.operations).toEqual([]);
		await expect(
			tool.execute(
				"over",
				{ code: 'await read(path="README.md")\nawait read(path="README.md")', limits: { callBudget: 1 } },
				undefined,
				undefined,
				ctx,
			),
		).rejects.toThrow(/call budget exhausted/);
		expect(
			resultHandler({ toolName: "pi_exec", isError: true, toolCallId: "over" }).details.trace.operations,
		).toHaveLength(1);
	});

	it("preserves captured print on a failed program", async () => {
		const { tool, resultHandler } = register();
		const id = "print-error";
		await expect(
			tool.execute(id, { code: 'print("checkpoint")\nraise ValueError("boom")' }, undefined, undefined, {
				cwd: process.cwd(),
				sessionManager: { getSessionId: () => id },
			}),
		).rejects.toThrow(/boom/);
		expect(resultHandler({ toolName: "pi_exec", isError: true, toolCallId: id }).details.logs).toEqual(["checkpoint"]);
	});

	it("returns core bash and edit failures in the documented result envelope", async () => {
		const { tool } = register();
		const result = await tool.execute(
			"core-envelope",
			{
				code: 'result = await bash(command="cat", stdin="hello")\nfailed = await edit(path="missing.txt", edits=[{"oldText": "a", "newText": "b"}])\n[result, failed]',
			},
			undefined,
			undefined,
			{ cwd: process.cwd(), sessionManager: { getSessionId: () => "core-envelope" } },
		);
		const [bashResult, editResult] = JSON.parse(result.content[0].text);
		expect(bashResult).toEqual({ ok: true, output: "hello" });
		expect(editResult.ok).toBe(false);
		expect(editResult.output).toMatch(/missing|not found|ENOENT/i);
		expect(result.details.trace.operations.map((operation: any) => operation.outcome)).toEqual(["succeeded", "failed"]);
	});

	it("resumes JSON state by ID until branch-aligned Monty sessions replace it", async () => {
		const { tool } = register();
		const ctx = { cwd: process.cwd(), sessionManager: { getSessionId: () => "state" } };
		const first = await tool.execute(
			"state-1",
			{ code: 'state["count"] = 1\nstate["count"]' },
			undefined,
			undefined,
			ctx,
		);
		expect(first.content[0].text).toBe("1");
		expect(first.details.stateId).toBeTypeOf("string");
		const second = await tool.execute(
			"state-2",
			{ code: 'state["count"] + 1', state: first.details.stateId },
			undefined,
			undefined,
			ctx,
		);
		expect(second.content[0].text).toBe("2");
	});

	it("writes and edits through the core-tool bridge with nested Python arguments", async () => {
		const dir = mkdtempSync(join(tmpdir(), "apple-pi-monty-core-"));
		try {
			const { tool } = register();
			const code =
				'await write(path="example.txt", content="before")\nawait edit(path="example.txt", edits=[{"oldText": "before", "newText": "after"}])\nawait read(path="example.txt")';
			const result = await tool.execute("write-edit", { code }, undefined, undefined, {
				cwd: dir,
				sessionManager: { getSessionId: () => "write-edit" },
			});
			expect(result.content[0].text).toBe("after");
			expect(result.details.trace.operations.map((operation: any) => operation.ref)).toEqual([
				"pi.write",
				"pi.edit",
				"pi.read",
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not advertise JavaScript saved programs under the Python runtime", () => {
		const dir = mkdtempSync(join(tmpdir(), "apple-pi-no-js-program-"));
		try {
			mkdirSync(join(dir, ".pi", "programs"), { recursive: true });
			writeFileSync(join(dir, ".pi", "programs", "legacy.js"), "/** @description Legacy */\nreturn 1;");
			const { tools, emit } = register();
			emit("session_start", {}, { cwd: dir });
			expect(tools.get("program_legacy")).toBeUndefined();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("scales the Python call envelope within package maxima", () => {
		const gather = "import asyncio\nawait asyncio.gather(read(path='a'), read(path='b'))";
		expect(deriveProgramEnvelope(gather).concurrency).toBe(16);
		expect(deriveProgramEnvelope("1 + 1", { callBudget: 12 }).callBudget).toBe(12);
		expect(deriveProgramEnvelope("1 + 1", { timeoutSeconds: 90 }).timeoutSeconds).toBe(90);
		expect(deriveProgramEnvelope(gather, { callBudget: 9_999 }).callBudget).toBe(PROGRAM_ENVELOPE_MAXIMA.callBudget);
	});
});

describe("pi_exec TUI rendering", () => {
	it("renders an objective, bounded code preview, and expansion hint", () => {
		const component = renderExecCall(
			{
				code: Array.from({ length: 12 }, (_, index) => `v${index} = ${index}`).join("\n"),
				display: { name: "Inspect release", description: "Map independent tracks" },
			},
			theme,
			{ expanded: false, isError: false },
		);
		const text = component.render(120).join("\n");
		expect(text).toContain("pi_exec Inspect release Python · 12 lines");
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
								ref: "agent.run",
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
								ref: "agent.run",
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
