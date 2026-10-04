import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer, type ServerResponse } from "node:http";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventBus } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/event-bus.js";
import {
	createExtensionRuntime,
	loadExtensions,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
import { fakeCustom, fakeTui } from "./helpers/fake-tui.js";
import { resultText } from "../components/pi-exec/src/results.js";
import { registerWorkSection } from "../components/shared/src/work-manager.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	vi.restoreAllMocks();
});

async function harness(setup?: (cwd: string) => void) {
	const cwd = mkdtempSync(join(tmpdir(), "apple-pi-exec-panel-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = cwd;
	let shutdown = async () => {};
	cleanups.push(async () => {
		try {
			await shutdown();
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
			rmSync(cwd, { recursive: true, force: true });
		}
	});
	setup?.(cwd);
	const manager = SessionManager.inMemory(cwd);
	const runtime = createExtensionRuntime();
	runtime.appendEntry = (type, data) => {
		manager.appendCustomEntry(type, data);
	};
	const manifest = JSON.parse(readFileSync("package.json", "utf8"));
	const paths = manifest.pi.extensions
		.filter((path: string) => ["./extensions/pi-exec.ts", "./extensions/work.ts"].includes(path))
		.map((path: string) => join(process.cwd(), path));
	const events = createEventBus();
	const loaded = await loadExtensions(paths, cwd, events, runtime);
	expect(loaded.errors).toEqual([]);
	const screen = fakeTui(200, 50);
	const ctx = {
		cwd,
		sessionManager: manager,
		hasUI: true,
		mode: "tui",
		isProjectTrusted: () => true,
		ui: { custom: fakeCustom(screen).custom, notify: vi.fn(), setStatus: vi.fn(), setWidget: vi.fn() },
	} as any;
	const emit = async (event: string) => {
		for (const extension of loaded.extensions)
			for (const handler of extension.handlers.get(event) ?? []) await handler({ type: event }, ctx);
	};
	shutdown = () => emit("session_shutdown");
	await emit("session_start");
	const command = (name: string) =>
		loaded.extensions
			.flatMap((extension) => [...extension.commands.values()])
			.find((command) => command.name === name)!;
	const shortcut = (key: string) =>
		loaded.extensions
			.flatMap((extension) => [...extension.shortcuts.values()])
			.find((shortcut) => shortcut.shortcut === key)!;
	return {
		cwd,
		ctx,
		screen,
		emit,
		addTab: () =>
			registerWorkSection({ events } as any, {
				key: "other",
				label: "Other",
				create: () => ({ focused: false, rowBudget: 0, render: () => ["Other detail"], invalidate: () => {} }),
			}),
		open: () => command("work").handler("", ctx),
		toggle: () => shortcut("ctrl+w").handler(ctx),
		focus: () => shortcut("alt+g").handler(ctx),
		text: () => screen.stack.map((entry) => screen.layout(entry).lines.join("\n")).join("\n"),
		input: (data: string) => screen.stack[0]!.component.handleInput(data),
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
	cleanups.push(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	const address = server.address() as { port: number };
	return { url: `http://127.0.0.1:${address.port}`, responses };
}

describe("Pi Exec work panel", () => {
	it("opens an empty Pi Exec tab through the package load sequence without taking editor input", async () => {
		const h = await harness();
		await h.open();
		expect(h.text()).toContain("Pi Exec");
		expect(h.text()).toContain("no programs");
		expect(h.screen.focused()).toBe(h.screen.editor);
		await h.open();
		expect(h.screen.stack).toHaveLength(1);
		await h.toggle();
		expect(h.screen.stack).toHaveLength(0);
		await h.toggle();
		expect(h.text()).toContain("Pi Exec");
	});

	it("shows a live program and distinguishes running calls from queued calls", async () => {
		const gate = await gateServer();
		const h = await harness();
		await h.open();
		const code = `import asyncio\nawait asyncio.gather(fetch(url="${gate.url}/first"), fetch(url="${gate.url}/second"))`;
		const run = h
			.tool()
			.execute(
				"live",
				{ code, display: { name: "Inspect release", description: "Check both endpoints" }, limits: { concurrency: 1 } },
				undefined,
				undefined,
				h.ctx,
			);
		void run.catch(() => {});
		await vi.waitFor(() => expect(gate.responses.has("/first")).toBe(true));
		expect(h.text()).toContain("Inspect release");
		expect(h.text()).toContain("Check both endpoints");
		expect(h.text()).toContain("1 running");
		expect(h.text()).toContain("1 queued");
		const now = Date.now();
		vi.spyOn(Date, "now").mockReturnValue(now + 10_000);
		expect(h.text()).toMatch(/Execution: 10\./);
		h.input("]");
		expect(h.text()).toMatch(/Queued: 10\./);
		expect(h.text()).toContain("Status: queued");
		vi.restoreAllMocks();
		h.input("[");
		h.input("v");
		expect(h.text()).toContain("import asyncio");
		h.input("v");
		h.input("v");
		h.input("v");
		gate.responses.get("/first")!.end("first result");
		await vi.waitFor(() => expect(gate.responses.has("/second")).toBe(true));
		expect(h.text()).toContain("1 completed");
		gate.responses.get("/second")!.end("second result");
		const result = await run;
		expect(resultText(result)).toContain("second result");
		expect(h.text()).toContain("succeeded");
		expect(h.text()).toContain("2 completed");
	});

	it("keeps saved-program source and results inspectable after reopening", async () => {
		const gate = await gateServer();
		const source = `"""Check saved output."""\nawait fetch(url="${gate.url}/saved")\nprint("saved log")\n{"answer": 42}`;
		const h = await harness((cwd) => {
			mkdirSync(join(cwd, ".pi", "programs"), { recursive: true });
			writeFileSync(join(cwd, ".pi", "programs", "sample.py"), source);
		});
		const run = h.tool("program_sample").execute("saved", {}, undefined, undefined, h.ctx);
		void run.catch(() => {});
		await vi.waitFor(() => expect(gate.responses.has("/saved")).toBe(true));
		await h.open();
		expect(h.text()).toContain("sample");
		expect(h.text()).toContain("Check saved output.");
		expect(h.text()).toContain("running");
		h.input("v");
		expect(h.text()).toContain('print("saved log")');
		gate.responses.get("/saved")!.end("saved response");
		const result = await run;
		h.input("v");
		expect(h.text()).toContain("saved log");
		expect(h.text()).toContain('"answer": 42');
		expect(resultText(result)).toContain("saved log");
		await h.toggle();
		await h.toggle();
		expect(h.text()).toContain("saved log");
		expect(h.text()).toContain("succeeded");
	});

	it("keeps a handled call failure separate from a successful program outcome", async () => {
		const h = await harness();
		await h
			.tool()
			.execute(
				"handled",
				{ code: 'try:\n    await read(path="missing.txt")\nexcept Exception:\n    pass\n"recovered"' },
				undefined,
				undefined,
				h.ctx,
			);
		await h.open();
		expect(h.text()).toContain("succeeded");
		expect(h.text()).toContain("1 failed");
		expect(h.text()).toContain("missing.txt");
		expect(h.text()).toContain("Error:");
		h.input("v");
		h.input("v");
		expect(h.text()).toContain("recovered");
		h.input("v");
		expect(h.text()).toContain('"outcome": "failed"');
	});

	it.each(["failed", "aborted", "timed_out"])("retains %s program detail after settlement", async (outcome) => {
		const h = await harness();
		const controller = new AbortController();
		const gate = outcome === "failed" ? undefined : await gateServer();
		const run = h
			.tool()
			.execute(
				outcome,
				{ code: gate ? `await fetch(url="${gate.url}/pending")` : "1 / 0", limits: { timeoutSeconds: 1 } },
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
		await h.open();
		expect(h.text()).toContain(outcome);
		h.input("v");
		h.input("v");
		expect(h.text()).toMatch(outcome === "failed" ? /division by zero/ : /pi_exec (aborted|timed out)/);
		await h.toggle();
		await h.toggle();
		expect(h.text()).toContain(outcome);
	});

	it("preserves selected invocation and source scroll through tabs, resize, focus, and reopen", async () => {
		const h = await harness();
		h.addTab();
		const code = `${Array.from({ length: 60 }, (_, index) => `# source marker ${index}`).join("\n")}\n"long result"`;
		await h.tool().execute("long", { code, display: { name: "Long source" } }, undefined, undefined, h.ctx);
		await h.open();
		h.focus();
		h.input("v");
		h.text();
		for (let index = 0; index < 10; index++) h.input("j");
		const marker = "source marker 10";
		expect(h.text()).toContain(marker);
		expect(h.text()).not.toContain("source marker 0");
		h.input("\x1b[C");
		expect(h.text()).toContain("Other detail");
		h.input("\x1b[D");
		expect(h.text()).toContain(marker);
		h.screen.tui.terminal.columns = 100;
		expect(h.text()).toContain(marker);
		expect(h.screen.layout(h.screen.stack[0]!).anchor).toBe("top-center");
		h.screen.tui.terminal.columns = 200;
		expect(h.text()).toContain(marker);
		h.input("\x1b");
		expect(h.screen.focused()).toBe(h.screen.editor);
		expect(h.screen.editor.text).toBe("draft to main agent");
		await h.toggle();
		await h.toggle();
		expect(h.text()).toContain(marker);
		await h
			.tool()
			.execute("short", { code: '"short result"', display: { name: "Short program" } }, undefined, undefined, h.ctx);
		expect(h.text()).toContain("Long source");
		h.input("\t");
		expect(h.text()).toContain("Short program");
		h.input("\t");
		expect(h.text()).toContain(marker);
		h.screen.stack[0]!.component.handleMouse({ type: "wheel", wheelDelta: -10 });
		expect(h.text()).toContain("source marker 0");
	});

	it("clears old program detail on branch changes and refuses late old-run updates", async () => {
		const gate = await gateServer();
		const h = await harness();
		const run = h
			.tool()
			.execute(
				"old",
				{ code: `await fetch(url="${gate.url}/old")`, display: { name: "Old context" } },
				undefined,
				undefined,
				h.ctx,
			);
		void run.catch(() => {});
		await vi.waitFor(() => expect(gate.responses.has("/old")).toBe(true));
		await h.open();
		expect(h.text()).toContain("Old context");
		await h.emit("session_tree");
		await expect(run).rejects.toThrow();
		expect(h.text()).toContain("no programs");
		expect(h.text()).not.toContain("Old context");
		gate.responses.get("/old")!.end("late response");
		await h
			.tool()
			.execute("new", { code: '"new result"', display: { name: "New context" } }, undefined, undefined, h.ctx);
		expect(h.text()).toContain("New context");
		expect(h.text()).not.toContain("Old context");
	});

	it("registers a fresh tab after session replacement reloads the extension runtime", async () => {
		const old = await harness();
		await old
			.tool()
			.execute(
				"old-session",
				{ code: '"old result"', display: { name: "Previous session" } },
				undefined,
				undefined,
				old.ctx,
			);
		await old.open();
		await old.emit("session_shutdown");
		expect(old.screen.stack).toHaveLength(0);
		const next = await harness();
		await next.open();
		expect(next.text()).toContain("Pi Exec");
		expect(next.text()).toContain("no programs");
		expect(next.text()).not.toContain("Previous session");
	});

	it("keeps the inspected passage visible when source lines rewrap across the responsive breakpoint", async () => {
		const h = await harness();
		const code = `${Array.from({ length: 60 }, (_, index) => `# marker ${index} ${"x".repeat(70)}`).join("\n")}\n"done"`;
		await h.tool().execute("wrapped", { code }, undefined, undefined, h.ctx);
		await h.open();
		h.input("v");
		h.text();
		for (let index = 0; index < 21; index++) h.input("j");
		expect(h.text()).toContain("# marker 11");
		h.screen.tui.terminal.columns = 100;
		expect(h.text()).toContain("# marker 11");
		h.screen.tui.terminal.columns = 200;
		expect(h.text()).toContain("# marker 11");
	});

	it("retains captured diagnostic output alongside a failed program's error after reopening", async () => {
		const h = await harness();
		await expect(
			h
				.tool()
				.execute("diagnostic", { code: 'print("diagnostic-before-failure")\n1 / 0' }, undefined, undefined, h.ctx),
		).rejects.toThrow();
		await h.open();
		h.input("v");
		h.input("v");
		expect(h.text()).toContain("diagnostic-before-failure");
		expect(h.text()).toContain("division by zero");
		await h.toggle();
		await h.toggle();
		expect(h.text()).toContain("diagnostic-before-failure");
	});

	it("shows an empty string result as settled rather than waiting for output", async () => {
		const h = await harness();
		const result = await h.tool().execute("empty-output", { code: '""' }, undefined, undefined, h.ctx);
		expect(resultText(result)).toBe("");
		await h.open();
		h.input("v");
		h.input("v");
		expect(h.text()).toContain("succeeded");
		expect(h.text()).not.toContain("Program is still running");
	});

	it("can inspect a legal long single-line print result without overflowing the renderer", async () => {
		const h = await harness();
		await h
			.tool()
			.execute("long-output", { code: 'print("x" * 10000000)\n"long-output-finished"' }, undefined, undefined, h.ctx);
		await h.open();
		h.input("v");
		h.input("v");
		expect(h.text()).toContain("xxxxxxxxxxxxxxxx");
		h.input("\x1b[F");
		expect(h.text()).toContain("long-output-finished");
	}, 30_000);

	it("uses redacted host-call arguments in detail and trace views", async () => {
		const gate = await gateServer();
		const h = await harness();
		const run = h.tool().execute(
			"redacted",
			{
				code: `await fetch(url="${gate.url}/public?token=private-query", headers={"Authorization": "private-header"}, body="private-body", method="POST")`,
			},
			undefined,
			undefined,
			h.ctx,
		);
		void run.catch(() => {});
		await vi.waitFor(() => expect(gate.responses.size).toBe(1));
		await h.open();
		expect(h.text()).toContain("/public");
		expect(h.text()).not.toContain("private-");
		h.input("v");
		h.input("v");
		h.input("v");
		expect(h.text()).not.toContain("private-");
		[...gate.responses.values()][0]!.end("public response");
		await run;
		expect(h.text()).not.toContain("private-");
	});
});
