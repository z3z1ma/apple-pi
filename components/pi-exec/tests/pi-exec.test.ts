import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { aggregateUsage } from "../../shared/src/model-results.js";
import { deriveProgramEnvelope, PROGRAM_ENVELOPE_MAXIMA } from "../src/envelope.js";
import runtime from "../src/index.js";
import { listSkills, readSkillBody } from "../src/skills.js";
import { renderExecCall, renderExecResult } from "../src/ui.js";

const theme = {
	fg: (_color: string, value: string) => value,
	bold: (value: string) => value,
} as any;

describe("pi_exec usage", () => {
	it("aggregates every model turn's usage", () => {
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
			expect(names).not.toContain("ralph");
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
			expect(body.startsWith("# Code review")).toBe(true);
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

/** Pi's tool context: the callable tools and a nested-call pipeline that never rejects for tool failures. */
function toolContext(ctx: any, calls: string[] = []) {
	const tools = ctx.tools ?? [];
	return {
		...ctx,
		tools,
		executeTool:
			ctx.executeTool ??
			(async (name: string, args: Record<string, unknown>) => {
				calls.push(name);
				const toolCall = { type: "toolCall", id: `nested-${calls.length}`, name, arguments: args };
				const tool = tools.find((candidate: any) => candidate.name === name);
				if (!tool)
					return { toolCall, result: { content: [{ type: "text", text: `Tool ${name} not found` }] }, isError: true };
				try {
					const result = await tool.execute(toolCall.id, args);
					return { toolCall, result, isError: result.isError === true };
				} catch (error) {
					return { toolCall, result: { content: [{ type: "text", text: (error as Error).message }] }, isError: true };
				}
			}),
	};
}

describe("pi_exec tool", () => {
	const register = () => {
		const tools = new Map<string, any>();
		const manager = SessionManager.inMemory(process.cwd());
		let resultHandler: any;
		let shutdownHandler: any;
		const handlers = new Map<string, any[]>();
		runtime({
			appendEntry(type: string, data: unknown) {
				manager.appendCustomEntry(type, data);
			},
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
		const tool = tools.get("pi_exec");
		const execute = tool.execute.bind(tool);
		tool.execute = (id: string, params: unknown, signal: AbortSignal | undefined, onUpdate: unknown, ctx: any) =>
			execute(id, params, signal, onUpdate, toolContext({ ...ctx, sessionManager: manager }));
		return {
			tools,
			tool,
			resultHandler,
			shutdownHandler,
			emit(event: string, data: any = {}, ctx: any = {}) {
				for (const h of handlers.get(event) ?? []) h(data, { ...ctx, sessionManager: manager });
			},
		};
	};

	it("compiles strict schema shorthand inside a Python program", async () => {
		const { tool } = register();
		const result = await tool.execute(
			"schema-shape",
			{
				code: 'schema(shape={"id": "int", "label?": "str", "tags": ["str"]})',
			},
			undefined,
			undefined,
			{ cwd: process.cwd(), sessionManager: { getSessionId: () => "schema-shape" } },
		);
		expect(JSON.parse(result.content[0].text)).toEqual({
			type: "object",
			properties: {
				id: { type: "integer" },
				label: { type: "string" },
				tags: { type: "array", items: { type: "string" } },
			},
			required: ["id", "tags"],
			additionalProperties: false,
		});
	});

	it("compiles repeated schemas locally without consuming host suspensions", async () => {
		const { tool } = register();
		const result = await tool.execute(
			"local-schema",
			{
				code: 'for i in range(20):\n    value = schema({"id": "int"})\nvalue',
				limits: { callBudget: 1 },
			},
			undefined,
			undefined,
			{ cwd: process.cwd(), sessionManager: { getSessionId: () => "local-schema" } },
		);
		expect(JSON.parse(result.content[0].text)).toEqual({
			type: "object",
			properties: { id: { type: "integer" } },
			required: ["id"],
			additionalProperties: false,
		});
		expect(result.details.trace.operations).toEqual([]);
	});

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

	it("type-checks callable extension tools before any host call", async () => {
		const { tool, resultHandler } = register();
		let calls = 0;
		const mirror = {
			name: "mirror",
			label: "Mirror",
			description: "Echo a value",
			parameters: Type.Object({ value: Type.String() }),
			async execute(_id: string, args: { value: string }) {
				calls++;
				return { content: [{ type: "text", text: `echo:${args.value}` }] };
			},
		};
		expect(tool.parameters.properties.code.description).toContain("tools_describe");
		expect(tool.parameters.properties.code.description).not.toContain("async def mirror(");
		const ctx = { cwd: process.cwd(), tools: [mirror], sessionManager: { getSessionId: () => "mirror" } };
		await expect(
			tool.execute(
				"mirror-invalid",
				{ code: 'await mirror(value="first")\nawait mirror(vlaue="second")' },
				undefined,
				undefined,
				ctx,
			),
		).rejects.toThrow(/unknown-argument/);
		expect(
			resultHandler({ toolName: "pi_exec", isError: true, toolCallId: "mirror-invalid" }).details.trace.operations,
		).toEqual([]);
		expect(calls).toBe(0);
		const result = await tool.execute(
			"mirror-valid",
			{ code: 'response = await mirror(value="ok")\nresponse["text"]' },
			undefined,
			undefined,
			ctx,
		);
		expect(result.content[0].text).toBe("echo:ok");
		expect(calls).toBe(1);
	});

	it("discovers and calls an extension tool through the dynamic tool API", async () => {
		const { tool } = register();
		const mirror = {
			name: "mirror",
			label: "Mirror",
			description: "Echo a value",
			parameters: Type.Object({ value: Type.String() }),
			async execute(_id: string, args: { value: string }) {
				return { content: [{ type: "text", text: `echo:${args.value}` }] };
			},
		};
		const code =
			'names = [t["name"] for t in await tools_search(query="Echo a value")]\nfound = await tools_describe(name="mirror")\nreply = await tools_call(name="mirror", args={"value": "dynamic"})\n[names, found["name"] if found is not None else "", reply["text"]]';
		const result = await tool.execute("dynamic-tools", { code }, undefined, undefined, {
			cwd: process.cwd(),
			tools: [mirror],
			sessionManager: { getSessionId: () => "dynamic-tools" },
		});
		expect(JSON.parse(result.content[0].text)).toEqual([["mirror"], "mirror", "echo:dynamic"]);
	});

	it("returns structured data and error state, and raises for failures without data", async () => {
		const { tool } = register();
		const lookup = {
			name: "lookup",
			label: "Lookup",
			description: "Look up rows",
			parameters: Type.Object({ key: Type.String() }),
			async execute(_id: string, args: { key: string }) {
				if (args.key === "missing")
					return { content: [{ type: "text", text: "no rows" }], structuredContent: [], isError: true };
				if (args.key === "broken") throw new Error("lookup backend down");
				return { content: [{ type: "text", text: "1 row" }], structuredContent: [{ key: args.key }] };
			},
		};
		const code = [
			'found = await lookup(key="a")',
			'missing = await lookup(key="missing")',
			"try:",
			'    await lookup(key="broken")',
			'    raised = ""',
			"except Exception as error:",
			"    raised = str(error)",
			'[found["structuredContent"], found["isError"], missing["structuredContent"], missing["isError"], raised]',
		].join("\n");
		const result = await tool.execute("structured", { code }, undefined, undefined, {
			cwd: process.cwd(),
			tools: [lookup],
			sessionManager: { getSessionId: () => "structured" },
		});
		expect(JSON.parse(result.content[0].text)).toEqual([[{ key: "a" }], false, [], true, "lookup backend down"]);
		expect(result.details.trace.operations.map((operation: any) => operation.outcome)).toEqual([
			"succeeded",
			"failed",
			"failed",
		]);
	});

	it("rejects root-only reminders at the Python type-check boundary", async () => {
		const { tool, resultHandler } = register();
		const id = "excluded-tools";
		await expect(
			tool.execute(id, { code: 'await remind_me(delay_seconds=1, text="later")' }, undefined, undefined, {
				cwd: process.cwd(),
				sessionManager: { getSessionId: () => id },
			}),
		).rejects.toThrow(/unresolved-reference/);
		expect(resultHandler({ toolName: "pi_exec", isError: true, toolCallId: id }).details.trace.operations).toEqual([]);
	});

	it("type-checks and runs an active core tool through Pi's tool pipeline with its registered schema", async () => {
		const { tool } = register();
		const nested: string[] = [];
		const read = {
			name: "read",
			label: "Read",
			description: "Read a location",
			parameters: Type.Object({ location: Type.String() }),
			async execute(_id: string, args: { location: string }) {
				return { content: [{ type: "text", text: `native:${args.location}` }] };
			},
		};
		const ctx = toolContext(
			{ cwd: process.cwd(), tools: [read], sessionManager: { getSessionId: () => "native-core" } },
			nested,
		);
		const result = await tool.execute(
			"native-core",
			{ code: 'await read(location="example.txt")' },
			undefined,
			undefined,
			ctx,
		);
		expect(result.content[0].text).toBe("native:example.txt");
		expect(nested).toEqual(["read"]);
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
		const result = await tool.execute(
			"gather-core",
			{
				code: "import asyncio\nawait asyncio.gather(*[read(path=str(i)) for i in range(5)])",
				limits: { concurrency: 2 },
			},
			undefined,
			undefined,
			{ cwd: process.cwd(), tools: [read], sessionManager: { getSessionId: () => "gather-core" } },
		);
		expect(JSON.parse(result.content[0].text)).toEqual(["0", "1", "2", "3", "4"]);
		expect(peak).toBe(2);
		expect(result.details.trace.operations).toHaveLength(5);
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

	it("aborting one root session leaves another running", async () => {
		const { tool: siblingTool } = register();
		const { tool: cancelledTool } = register();
		const ctx = { cwd: process.cwd(), sessionManager: { getSessionId: () => "sibling" } };
		const sibling = siblingTool.execute(
			"sibling",
			{ code: "import asyncio\nawait asyncio.sleep(0.5)\n42" },
			undefined,
			undefined,
			ctx,
		);
		const controller = new AbortController();
		const cancelled = cancelledTool.execute(
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

	it("cancels gathered host work when Python raises an ordinary exception", async () => {
		let disconnected = false;
		const server = createServer((request, response) => {
			request.on("close", () => {
				disconnected = true;
			});
			setTimeout(() => response.end("late"), 1_500).unref();
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("Expected a local HTTP port");
			const { tool, resultHandler } = register();
			const code = `import asyncio\nasync def fail():\n    await asyncio.sleep(0.2)\n    raise ValueError("boom")\nawait asyncio.gather(fail(), fetch("http://127.0.0.1:${address.port}/slow"))`;
			await expect(
				tool.execute("gather-failure", { code }, undefined, undefined, { cwd: process.cwd() }),
			).rejects.toThrow(/boom/);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(disconnected).toBe(true);
			const trace = resultHandler({ toolName: "pi_exec", isError: true, toolCallId: "gather-failure" }).details.trace;
			expect(trace.operations.find((operation: any) => operation.ref === "fetch")?.outcome).toBe("aborted");
		} finally {
			server.closeAllConnections();
			server.close();
		}
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

	it("reads model-invocable skill bodies without frontmatter and rejects human-only skills", async () => {
		const { tool } = register();
		const ctx = { cwd: process.cwd(), sessionManager: { getSessionId: () => "skills" } };
		const result = await tool.execute(
			"skills",
			{
				code: 'names = [item["name"] for item in await skills_list()]\nbody = await skills_body(name="code-review")\n["code-review" in names, body.startswith("---"), "review board" in body]',
			},
			undefined,
			undefined,
			ctx,
		);
		expect(JSON.parse(result.content[0].text)).toEqual([true, false, true]);
		await expect(
			tool.execute("human-skill", { code: 'await skills_body("implement")' }, undefined, undefined, ctx),
		).rejects.toThrow(/unknown|not available|model-invocable/i);
	});

	it("fetches a local response without tracing header or body values and cancels in flight", async () => {
		const server = createServer((request, response) => {
			if (request.url?.startsWith("/wait")) {
				const timer = setTimeout(() => response.end("late"), 5_000);
				response.on("close", () => clearTimeout(timer));
				return;
			}
			response.setHeader("content-type", "text/plain");
			response.setHeader("x-source", "local");
			response.end("pong");
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("no listening port");
			const origin = `http://127.0.0.1:${address.port}`;
			const { tool, resultHandler } = register();
			const ctx = { cwd: process.cwd(), sessionManager: { getSessionId: () => "fetch" } };
			const code = `response = await fetch(url=${JSON.stringify(`${origin}/text?token=private`)}, method="POST", headers={"authorization": "Bearer secret"}, body="private")\n[response["status"], response["headers"]["x-source"], response["text"]]`;
			const result = await tool.execute("fetch", { code }, undefined, undefined, ctx);
			expect(JSON.parse(result.content[0].text)).toEqual([200, "local", "pong"]);
			expect(JSON.stringify(result.details.trace.operations)).not.toMatch(/secret|private/);
			const controller = new AbortController();
			const running = tool.execute(
				"fetch-abort",
				{ code: `await fetch(${JSON.stringify(`${origin}/wait`)})` },
				controller.signal,
				undefined,
				ctx,
			);
			setTimeout(() => controller.abort(), 100);
			await expect(running).rejects.toThrow(/aborted/);
			expect(
				resultHandler({ toolName: "pi_exec", isError: true, toolCallId: "fetch-abort" }).details.trace.outcome,
			).toBe("aborted");
		} finally {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
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
