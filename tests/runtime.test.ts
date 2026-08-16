import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import { ExtensionRunner } from "@earendil-works/pi-coding-agent";

import runtime, { aggregateUsage, deriveProgramEnvelope, executeProgram } from "../extensions/runtime.js";
import { renderExecCall, renderExecResult } from "../extensions/runtime-ui.js";
import { runInChildSessionContext } from "../components/subagents/src/child-context.js";

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
});
