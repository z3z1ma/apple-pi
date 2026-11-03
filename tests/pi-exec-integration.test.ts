import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	fakeBridge,
	query,
	standInProcess,
	startRuntime,
	stopRuntime,
} from "../components/session-state/tests/helpers.js";
import { resultText } from "../components/shared/src/model-results.js";
import { createEventBus } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/event-bus.js";
import {
	createExtensionRuntime,
	loadExtensions,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
import { fakeTui, plainTheme } from "./helpers/fake-tui.js";

const cleanups: Array<() => Promise<void>> = [];
const gateClosures: Array<() => Promise<void>> = [];
let peerFixture = false;
let peerFixtureRole = "coordinator";
afterEach(async () => {
	for (const close of gateClosures.splice(0)) await close();
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

async function harness(setup?: (cwd: string) => void, extensions = ["./extensions/pi-exec.ts"]) {
	const cwd = mkdtempSync(join(tmpdir(), "apple-pi-exec-integration-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = cwd;
	let shutdown = async () => {};
	let peerShutdown = async () => {};
	const running = new Set<Promise<unknown>>();
	cleanups.push(async () => {
		try {
			await shutdown();
			await Promise.allSettled([...running]);
			await peerShutdown();
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
			rmSync(cwd, { recursive: true, force: true });
		}
	});
	setup?.(cwd);
	const manager = SessionManager.inMemory(cwd);
	if (peerFixture) peerShutdown = await peerRuntime(cwd, manager.getSessionId());
	const runtime = createExtensionRuntime();
	runtime.appendEntry = (type, data) => {
		manager.appendCustomEntry(type, data);
	};
	const manifest = JSON.parse(readFileSync("package.json", "utf8"));
	const paths = manifest.pi.extensions
		.filter((path: string) => extensions.includes(path))
		.map((path: string) => join(process.cwd(), path));
	if (peerFixture) {
		const roleExtension = join(cwd, "manager-extension.ts");
		writeFileSync(
			roleExtension,
			`import { installSessionRole } from ${JSON.stringify(join(process.cwd(), "components/organization/src/session-role.ts"))};
export default function(pi) {
	pi.registerFlag("role", { type: "string", description: "Fixture role" });
	const getFlag = pi.getFlag.bind(pi);
	pi.getFlag = (name) => name === "role" ? ${JSON.stringify(peerFixtureRole)} : getFlag(name);
	installSessionRole(pi);
}`,
		);
		paths.push(roleExtension);
	}
	const events = createEventBus();
	const loaded = await loadExtensions(paths, cwd, events, runtime);
	expect(loaded.errors).toEqual([]);
	const screen = fakeTui(200, 50);
	const widgets = new Map<string, { factory: any; instance?: { render(): string[] } }>();
	const statuses = new Map<string, string>();
	const ctx = {
		cwd,
		sessionManager: manager,
		hasUI: true,
		mode: "tui",
		isProjectTrusted: () => true,
		modelRegistry: { find: () => undefined },
		tools: [],
		ui: {
			notify: vi.fn(),
			setStatus: (key: string, text: string | undefined) => {
				if (text === undefined) statuses.delete(key);
				else statuses.set(key, text);
			},
			setWidget: (key: string, factory: unknown) => {
				if (factory === undefined) widgets.delete(key);
				else widgets.set(key, { factory });
			},
		},
	} as any;
	const passive = () =>
		[...widgets.entries()].map(([key, widget]) => {
			widget.instance ??= widget.factory(screen.tui, plainTheme);
			return { key, lines: widget.instance!.render() };
		});
	const emit = async (event: string) => {
		for (const extension of loaded.extensions)
			for (const handler of extension.handlers.get(event) ?? []) await handler({ type: event }, ctx);
	};
	shutdown = () => emit("session_shutdown");
	await emit("session_start");
	for (const extension of loaded.extensions)
		for (const { definition } of extension.tools.values()) {
			const execute = definition.execute;
			definition.execute = (...args) => {
				const result = execute(...args);
				running.add(result);
				void result.then(
					() => running.delete(result),
					() => running.delete(result),
				);
				return result;
			};
		}
	return {
		cwd,
		ctx,
		screen,
		emit,
		passive,
		passiveText: () =>
			passive()
				.flatMap((widget) => widget.lines)
				.join("\n"),
		statuses,
		failure: async (toolCallId: string): Promise<unknown> => {
			for (const extension of loaded.extensions)
				for (const handler of extension.handlers.get("tool_result") ?? []) {
					const patch = await handler({ type: "tool_result", toolName: "pi_exec", toolCallId, isError: true }, ctx);
					if (patch !== undefined) return patch;
				}
			return undefined;
		},
		tool: (name = "pi_exec") =>
			loaded.extensions
				.flatMap((extension) => [...extension.tools.values()])
				.find((tool) => tool.definition.name === name)!.definition,
	};
}

async function gateServer() {
	const responses = new Map<string, ServerResponse>();
	const server = createServer((request, response) => {
		response.setHeader("Content-Type", "text/plain");
		responses.set(request.url!, response);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	let closing: Promise<void> | undefined;
	const close = () =>
		(closing ??= (async () => {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		})());
	gateClosures.push(close);
	cleanups.push(close);
	const address = server.address() as { port: number };
	return { url: `http://127.0.0.1:${address.port}`, responses };
}

function enablePeerFixture(role = "coordinator") {
	peerFixture = true;
	peerFixtureRole = role;
	cleanups.push(async () => {
		peerFixture = false;
		peerFixtureRole = "coordinator";
	});
}

async function peerRuntime(cwd: string, caller: string): Promise<() => Promise<void>> {
	const bin = join(cwd, "bin");
	mkdirSync(bin);
	const fixture = join(process.cwd(), "tests", "fixtures", "peer-pi.mjs");
	writeFileSync(join(bin, "pi"), `#!/bin/sh\nexec '${process.execPath}' '${fixture}' "$@"\n`, { mode: 0o700 });
	vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
	vi.stubEnv("PI_SESSION_STATE_DISABLED", "");
	vi.stubEnv("TMUX", "");
	vi.stubEnv("TMUX_PANE", "");
	vi.stubEnv("TMUX_TMPDIR", join(cwd, "tmux"));
	const socket = join(cwd, "state", "apple-pi.sock");
	await startRuntime(socket);
	const parent = standInProcess();
	const bridge = await fakeBridge(socket, caller, parent.pid, parent.startedAt, {
		session: { cwd },
		facts: { ...(peerFixtureRole ? { role: peerFixtureRole } : {}), manages: peerFixtureRole === "coordinator" },
	});
	await vi.waitFor(() =>
		expect(query(join(cwd, "state", "apple-pi.db"), "select id from sessions where id = ?", caller)).toHaveLength(1),
	);
	return async () => {
		bridge.socket.destroy();
		parent.child.kill();
		await stopRuntime({ agentDir: cwd, pidPath: join(cwd, "state", "apple-pi-runtime.pid") });
	};
}

const gatedTask = (gate: string, tool: string, args: Record<string, unknown>, holdTerm = false) =>
	JSON.stringify(JSON.stringify({ gate, tool, args, ...(holdTerm ? { holdTerm } : {}) }));

async function mixedHarness() {
	const h = await harness(undefined, ["./extensions/pi-exec.ts", "./extensions/tasks.ts"]);
	const scheduleTask = () =>
		h.tool("remind_me").execute("task", { text: "Deferred check", delay_seconds: 600 }, undefined, undefined, h.ctx);
	return { ...h, scheduleTask };
}

describe("Pi Exec loaded execution", () => {
	it("distinguishes queued and running calls without opening a panel", async () => {
		const gate = await gateServer();
		const h = await harness();
		const updates: unknown[] = [];
		const run = h.tool().execute(
			"live",
			{
				code: `import asyncio\nawait asyncio.gather(fetch(url="${gate.url}/first"), fetch(url="${gate.url}/second"))`,
				display: { name: "Inspect release", description: "Check both endpoints" },
				limits: { concurrency: 1 },
			},
			undefined,
			(update) => updates.push(update),
			h.ctx,
		);
		void run.catch(() => {});
		await vi.waitFor(() => expect(gate.responses.has("/first")).toBe(true));
		expect(gate.responses.has("/second")).toBe(false);
		expect(updates.at(-1)).toMatchObject({
			details: {
				activity: {
					calls: [
						{ ref: "fetch", status: "running" },
						{ ref: "fetch", status: "queued" },
					],
				},
			},
		});
		expect(h.passiveText()).toContain("1 queued");
		expect(h.screen.stack).toHaveLength(0);
		gate.responses.get("/first")!.end("first result");
		await vi.waitFor(() => expect(gate.responses.has("/second")).toBe(true));
		gate.responses.get("/second")!.end("second result");
		const result = await run;
		expect(resultText(result)).toContain("second result");
		expect(result).toMatchObject({
			details: { trace: { outcome: "succeeded", operations: [{ outcome: "succeeded" }, { outcome: "succeeded" }] } },
		});
	});

	it("keeps saved-program output and handled call failures in native results", async () => {
		const h = await harness((cwd) => {
			mkdirSync(join(cwd, ".pi", "programs"), { recursive: true });
			writeFileSync(
				join(cwd, ".pi", "programs", "sample.py"),
				'"""Check saved output."""\nprint("saved log")\n{"answer": 42}',
			);
		});
		const saved = await h.tool("program_sample").execute("saved", {}, undefined, undefined, h.ctx);
		expect(resultText(saved)).toContain("saved log");
		expect(resultText(saved)).toContain('"answer": 42');
		const result = await h.tool().execute(
			"handled",
			{
				code: 'try:\n    await read(path="missing.txt")\nexcept Exception:\n    pass\n"recovered"',
			},
			undefined,
			undefined,
			h.ctx,
		);
		expect(resultText(result)).toBe("recovered");
		expect(result).toMatchObject({
			details: {
				trace: {
					outcome: "succeeded",
					operations: [{ ref: "pi.read", outcome: "failed", args: { path: "missing.txt" }, error: expect.any(String) }],
				},
			},
		});
	});

	it.each(["failed", "aborted", "timed_out"])(
		"retains %s failure detail through the tool-result hook",
		async (outcome) => {
			const h = await harness();
			const controller = new AbortController();
			const gate = outcome === "failed" ? undefined : await gateServer();
			const run = h.tool().execute(
				outcome,
				{
					code: gate ? `await fetch(url="${gate.url}/pending")` : 'print("diagnostic output")\n1 / 0',
					limits: { timeoutSeconds: 1 },
				},
				controller.signal,
				undefined,
				h.ctx,
			);
			void run.catch(() => {});
			if (outcome === "aborted") {
				await vi.waitFor(() => expect(gate!.responses.has("/pending")).toBe(true));
				controller.abort();
			}
			await expect(run).rejects.toThrow();
			expect(await h.failure(outcome)).toMatchObject({
				details: {
					trace: { outcome },
					logs: outcome === "failed" ? ["diagnostic output"] : [],
				},
			});
			expect(await h.failure(outcome)).toBeUndefined();
			expect(h.passive()).toEqual([]);
		},
	);

	it("returns both empty and long strings without a panel-owned output record", async () => {
		const h = await harness();
		for (const code of ['""', '"x" * 5000']) {
			const result = await h.tool().execute(code, { code }, undefined, undefined, h.ctx);
			expect(resultText(result)).toBe(code === '""' ? "" : "x".repeat(5000));
		}
	});

	it("rejects nonmanaging peer creation through the actual extension loader", async () => {
		enablePeerFixture("implementation-engineer");
		const h = await harness();
		await expect(
			h.tool().execute(
				"denied",
				{
					code: 'await agent(role="implementation-engineer", task="Denied")',
				},
				undefined,
				undefined,
				h.ctx,
			),
		).rejects.toThrow("managing role");
		const db = join(h.cwd, "state", "apple-pi.db");
		expect(query(db, "select * from program_scopes")).toEqual([]);
		expect(query(db, "select * from program_peers")).toEqual([]);
		expect(query(db, "select id from sessions")).toEqual([{ id: h.ctx.sessionManager.getSessionId() }]);
	});

	it.each(["", "coordinator"])("runs and cleans a peer for a root with role=%s", async (role) => {
		enablePeerFixture(role);
		const gate = await gateServer();
		const h = await harness();
		const task = gatedTask(`${gate.url}/alpha`, "read", { path: "alpha.txt" });
		const run = h.tool().execute(
			"peer",
			{
				code: `await agent_run(role="implementation-engineer", task=${task}, name="alpha")`,
			},
			undefined,
			undefined,
			h.ctx,
		);
		void run.catch(() => {});
		await vi.waitFor(() => expect(gate.responses.has("/alpha")).toBe(true));
		gate.responses.get("/alpha")!.end("alpha contents");
		const result = await run;
		expect(JSON.parse(resultText(result))).toMatchObject({ status: "completed", text: "done:alpha contents" });
		expect(result).toMatchObject({
			details: {
				trace: { operations: [{ args: { name: "alpha" }, children: [{ ref: "pi.read", outcome: "succeeded" }] }] },
			},
		});
		expect(query(join(h.cwd, "state", "apple-pi.db"), "select * from program_scopes")).toEqual([]);
		expect(query(join(h.cwd, "state", "apple-pi.db"), "select * from program_peers")).toEqual([]);
	});

	it("correlates interleaved peer results and child traces", async () => {
		enablePeerFixture();
		const gate = await gateServer();
		const h = await harness();
		const alpha = gatedTask(`${gate.url}/alpha`, "read", { path: "alpha.txt" });
		const beta = gatedTask(`${gate.url}/beta`, "grep", { pattern: "beta-pattern" });
		const run = h.tool().execute(
			"parallel",
			{
				code: `import asyncio\nawait asyncio.gather(agent_run(role="implementation-engineer", task=${alpha}, name="alpha"), agent_run(role="implementation-engineer", task=${beta}, name="beta"))`,
				limits: { agentBudget: 2, concurrency: 2 },
			},
			undefined,
			undefined,
			h.ctx,
		);
		void run.catch(() => {});
		await vi.waitFor(() => expect(gate.responses.size).toBe(2));
		gate.responses.get("/beta")!.end("error: beta denied");
		await vi.waitFor(() => expect(h.passiveText()).toContain("1/2 calls"));
		expect(h.passiveText()).toContain("1 running");
		gate.responses.get("/alpha")!.end("alpha contents");
		const result = await run;
		expect(JSON.parse(resultText(result))).toMatchObject([
			{ text: "done:alpha contents" },
			{ text: "done:error: beta denied" },
		]);
		expect(result).toMatchObject({
			details: {
				trace: {
					operations: [
						{
							args: { name: "alpha" },
							children: [{ ref: "pi.read", args: { path: "alpha.txt" }, outcome: "succeeded" }],
						},
						{
							args: { name: "beta" },
							children: [{ ref: "pi.grep", args: { pattern: "beta-pattern" }, outcome: "failed" }],
						},
					],
				},
			},
		});
	});

	it("retains same-peer sibling outcomes and a handled peer failure", async () => {
		enablePeerFixture();
		const gate = await gateServer();
		const h = await harness();
		const task = JSON.stringify(
			JSON.stringify({
				tools: [
					{ gate: `${gate.url}/fast`, tool: "read", args: { path: "fast.txt" } },
					{ gate: `${gate.url}/slow`, tool: "bash", args: { command: "wait-for-slow" } },
				],
			}),
		);
		const run = h.tool().execute(
			"siblings",
			{
				code: `await agent_run(role="implementation-engineer", task=${task})`,
			},
			undefined,
			undefined,
			h.ctx,
		);
		void run.catch(() => {});
		await vi.waitFor(() => expect(gate.responses.size).toBe(2));
		gate.responses.get("/fast")!.end("error: fast denied");
		gate.responses.get("/slow")!.end("slow finished");
		expect(await run).toMatchObject({
			details: {
				trace: {
					operations: [
						{
							children: [
								{ ref: "pi.read", outcome: "failed" },
								{ ref: "pi.bash", outcome: "succeeded" },
							],
						},
					],
				},
			},
		});
		const result = await h.tool().execute(
			"handled-peer",
			{
				code: 'row = await agent_run(role="implementation-engineer", task="fail", name="broken")\n"handled " + row["status"]',
			},
			undefined,
			undefined,
			h.ctx,
		);
		expect(resultText(result)).toBe("handled failed");
		expect(result).toMatchObject({
			details: { trace: { outcome: "succeeded", operations: [{ outcome: "failed", error: "The peer failed" }] } },
		});
	});

	it.each(["aborted", "timed_out"])("cleans an unfinished peer when its program is %s", async (outcome) => {
		enablePeerFixture();
		const gate = await gateServer();
		const h = await harness();
		const controller = new AbortController();
		const task = gatedTask(`${gate.url}/stuck`, "read", { path: "stuck.txt" });
		const run = h.tool().execute(
			outcome,
			{
				code: `await agent_run(role="implementation-engineer", task=${task})`,
				limits: { timeoutSeconds: 1 },
			},
			controller.signal,
			undefined,
			h.ctx,
		);
		void run.catch(() => {});
		await vi.waitFor(() => expect(gate.responses.has("/stuck")).toBe(true));
		if (outcome === "aborted") controller.abort();
		await expect(run).rejects.toThrow();
		gate.responses.get("/stuck")!.end("late contents");
		const failure = await h.failure(outcome);
		expect(failure).toMatchObject({ details: { trace: { outcome } } });
		expect(JSON.stringify(failure)).not.toContain("late contents");
		expect(h.passive()).toEqual([]);
		expect(query(join(h.cwd, "state", "apple-pi.db"), "select * from program_peers")).toEqual([]);
	});

	it("waits for cancellation cleanup and retains a tool that finishes during cancellation", async () => {
		enablePeerFixture();
		const gate = await gateServer();
		const h = await harness();
		const controller = new AbortController();
		const task = gatedTask(`${gate.url}/held`, "read", { path: "held.txt" }, true);
		const run = h
			.tool()
			.execute(
				"held",
				{ code: `await agent_run(role="implementation-engineer", task=${task})` },
				controller.signal,
				undefined,
				h.ctx,
			);
		void run.catch(() => {});
		await vi.waitFor(() => expect(gate.responses.has("/held")).toBe(true));
		let settled = false;
		void run
			.finally(() => {
				settled = true;
			})
			.catch(() => {});
		controller.abort();
		await vi.waitFor(() =>
			expect(
				query(join(h.cwd, "state", "apple-pi.db"), "select id from program_scopes where closing = 1"),
			).toHaveLength(1),
		);
		expect(settled).toBe(false);
		gate.responses.get("/held")!.end("late contents");
		await expect(run).rejects.toThrow();
		expect(await h.failure("held")).toMatchObject({
			details: {
				trace: {
					outcome: "aborted",
					operations: [{ children: [{ ref: "pi.read", outcome: "succeeded", result: "late contents" }] }],
				},
			},
		});
		expect(query(join(h.cwd, "state", "apple-pi.db"), "select * from program_peers")).toEqual([]);
		expect(query(join(h.cwd, "state", "apple-pi.db"), "select * from program_scopes")).toEqual([]);
	});

	it("redacts bound peer inputs and host credentials from updates and terminal traces", async () => {
		enablePeerFixture();
		const gate = await gateServer();
		const h = await harness();
		const task = gatedTask(`${gate.url}/bound`, "read", { path: "bound.txt" });
		const updates: unknown[] = [];
		const run = h.tool().execute(
			"bound",
			{
				code: `await agent_run(role="implementation-engineer", task=${task}, context={"id": "public-id", "secret": inputs["secret"]}, output_schema={"type": "object", "properties": {"id": {"type": "string", "description": inputs["note"]}}})`,
				inputs: { secret: "private-context", note: "private-schema" },
			},
			undefined,
			(value) => updates.push(value),
			h.ctx,
		);
		void run.catch(() => {});
		await vi.waitFor(() => expect(gate.responses.has("/bound")).toBe(true));
		gate.responses.get("/bound")!.end("bound contents");
		const result = await run;
		expect(JSON.parse(resultText(result))).toMatchObject({ status: "completed", value: { id: "public-id" } });
		expect(JSON.stringify([updates, result])).not.toMatch(/private-(context|schema)/);
		const request = h.tool().execute(
			"redacted",
			{
				code: `await fetch(url="${gate.url}/public?token=private-query", headers={"Authorization": "private-header"}, body="private-body", method="POST")`,
			},
			undefined,
			(value) => updates.push(value),
			h.ctx,
		);
		void request.catch(() => {});
		await vi.waitFor(() => expect(gate.responses.size).toBe(2));
		[...gate.responses.values()][1]!.end("public response");
		const response = await request;
		expect(JSON.stringify([updates, response.details])).not.toContain("private-");
	});

	it("cancels old-context peer work without restoring passive activity", async () => {
		enablePeerFixture();
		const gate = await gateServer();
		const h = await harness();
		const task = gatedTask(`${gate.url}/old`, "read", { path: "old-peer.txt" });
		const run = h
			.tool()
			.execute(
				"old-peer",
				{ code: `await agent_run(role="implementation-engineer", task=${task})` },
				undefined,
				undefined,
				h.ctx,
			);
		void run.catch(() => {});
		await vi.waitFor(() => expect(gate.responses.has("/old")).toBe(true));
		await h.emit("session_tree");
		gate.responses.get("/old")!.end("late contents");
		await expect(run).rejects.toThrow();
		expect(h.passive()).toEqual([]);
		expect(query(join(h.cwd, "state", "apple-pi.db"), "select * from program_scopes")).toEqual([]);
	});
});

describe("Pi Exec shared passive activity", () => {
	it("keeps legal multiline display text within physical passive rows", async () => {
		const gate = await gateServer();
		const h = await harness();
		const run = h.tool().execute(
			"multiline",
			{
				code: `await fetch(url="${gate.url}/multiline")`,
				display: { name: "Two\nLines", description: "Line one\nLine two\nLine three" },
			},
			undefined,
			undefined,
			h.ctx,
		);
		void run.catch(() => {});
		await vi.waitFor(() => expect(gate.responses.has("/multiline")).toBe(true));
		const lines = h.passive()[0]!.lines;
		for (const line of lines) expect(line).not.toMatch(/[\r\n]/);
		expect(lines.join("\n")).toContain("Two Lines");
		gate.responses.get("/multiline")!.end("done");
		await run;
	});

	it("leaves RPC execution without TUI-only passive widgets or Pi Exec status", async () => {
		const gate = await gateServer();
		const h = await harness();
		h.ctx.mode = "rpc";
		await h.emit("session_start");
		const run = h.tool().execute("rpc", { code: `await fetch(url="${gate.url}/rpc")` }, undefined, undefined, h.ctx);
		void run.catch(() => {});
		await vi.waitFor(() => expect(gate.responses.has("/rpc")).toBe(true));
		expect(h.passive()).toEqual([]);
		expect(h.statuses.has("pi-exec")).toBe(false);
		gate.responses.get("/rpc")!.end("RPC result");
		expect(resultText(await run)).toContain("RPC result");
	});

	it("presents one multi-peer program beside a managed task, then leaves on settlement", async () => {
		enablePeerFixture();
		const gate = await gateServer();
		const h = await mixedHarness();
		await h.scheduleTask();
		const alpha = gatedTask(`${gate.url}/alpha`, "read", { path: "alpha.txt" });
		const beta = gatedTask(`${gate.url}/beta`, "grep", { pattern: "beta-pattern" });
		const code = `import asyncio\nawait asyncio.gather(agent_run(role="implementation-engineer", task=${alpha}, name="alpha-peer"), agent_run(role="implementation-engineer", task=${beta}, name="beta-peer"))`;
		const run = h
			.tool()
			.execute(
				"mixed",
				{ code, display: { name: "Mixed program" }, limits: { agentBudget: 2, concurrency: 2 } },
				undefined,
				undefined,
				h.ctx,
			);
		void run.catch(() => {});
		await vi.waitFor(() => expect(gate.responses.size).toBe(2));

		await vi.waitFor(() => expect(h.passiveText()).toContain("2 running"));
		expect(h.passive().map((widget) => widget.key)).toEqual(["active-work"]);
		const active = h.passiveText();
		expect(active).toContain("● Active work");
		expect(active).toContain("Mixed program");
		expect(active).toContain("Deferred check");
		expect(active.match(/Mixed program/g)).toHaveLength(1);
		expect(h.statuses.get("tasks")).toBe("tasks:1");
		expect(h.statuses.get("pi-exec")).toBe("exec:1");
		for (const line of h.passive()[0]!.lines) expect(visibleWidth(line)).toBeLessThanOrEqual(200);
		expect(h.screen.stack).toHaveLength(0);

		const now = Date.now();
		vi.spyOn(Date, "now").mockReturnValue(now + 12_000);
		expect(h.passiveText()).toMatch(/Mixed program.*1[23]\.\ds/);
		vi.restoreAllMocks();
		gate.responses.get("/beta")!.end("beta contents");
		await vi.waitFor(() => expect(h.passiveText()).toContain("1/2 calls"));
		expect(h.passiveText()).toContain("1 running");

		gate.responses.get("/alpha")!.end("alpha contents");
		await run;
		const settled = h.passiveText();
		expect(settled).not.toContain("Mixed program");
		expect(settled).toContain("Deferred check");
		expect(h.statuses.has("pi-exec")).toBe(false);
		expect(h.screen.stack).toHaveLength(0);
	});

	it("shows a saved program while it runs without opening the panel, and leaves no stale entry", async () => {
		const gate = await gateServer();
		const source = `"""Check saved output."""\nawait fetch(url="${gate.url}/saved")\n"saved done"`;
		const h = await harness((cwd) => {
			mkdirSync(join(cwd, ".pi", "programs"), { recursive: true });
			writeFileSync(join(cwd, ".pi", "programs", "sample.py"), source);
		});
		expect(h.passive()).toEqual([]);
		const run = h.tool("program_sample").execute("saved", {}, undefined, undefined, h.ctx);
		void run.catch(() => {});
		await vi.waitFor(() => expect(gate.responses.has("/saved")).toBe(true));
		await vi.waitFor(() => expect(h.passiveText()).toContain("1 running"));
		expect(h.passive().map((widget) => widget.key)).toEqual(["active-work"]);
		expect(h.passiveText()).toContain("sample");
		expect(h.passiveText()).toMatch(/\u23bf {2}fetch/);
		expect(h.screen.stack).toHaveLength(0);
		gate.responses.get("/saved")!.end("saved response");
		await run;
		expect(h.passive()).toEqual([]);
		expect(h.statuses.size).toBe(0);
	});

	it.each(["failed", "aborted", "timed_out"])("removes a %s program from passive activity", async (outcome) => {
		const gate = await gateServer();
		const h = await harness();
		const controller = new AbortController();
		const code =
			outcome === "failed" ? `await fetch(url="${gate.url}/pending")\n1 / 0` : `await fetch(url="${gate.url}/pending")`;
		const run = h
			.tool()
			.execute(
				outcome,
				{ code, display: { name: "Settling program" }, limits: { timeoutSeconds: 1 } },
				controller.signal,
				undefined,
				h.ctx,
			);
		void run.catch(() => {});
		await vi.waitFor(() => expect(gate.responses.has("/pending")).toBe(true));
		expect(h.passiveText()).toContain("Settling program");
		if (outcome === "aborted") controller.abort();
		if (outcome === "failed") gate.responses.get("/pending")!.end("ok");
		await expect(run).rejects.toThrow();
		expect(h.passive()).toEqual([]);
	});

	it("clears passive activity on branch change and keeps late old-context updates from restoring it", async () => {
		const gate = await gateServer();
		const h = await harness();
		const code = `import asyncio\nawait asyncio.gather(fetch(url="${gate.url}/old"), fetch(url="${gate.url}/later"))`;
		const run = h
			.tool()
			.execute(
				"old",
				{ code, display: { name: "Old context" }, limits: { concurrency: 1 } },
				undefined,
				undefined,
				h.ctx,
			);
		void run.catch(() => {});
		await vi.waitFor(() => expect(gate.responses.has("/old")).toBe(true));
		expect(h.passiveText()).toContain("Old context");
		await h.emit("session_tree");
		expect(h.passiveText()).not.toContain("Old context");
		gate.responses.get("/old")!.end("late response");
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(h.passiveText()).not.toContain("Old context");
		await run.catch(() => {});
		expect(h.passiveText()).not.toContain("Old context");
		expect(h.passive()).toEqual([]);
		expect(h.statuses.has("pi-exec")).toBe(false);
	});
});
