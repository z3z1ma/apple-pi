import { channel } from "node:diagnostics_channel";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import install from "../src/index.js";
import { acquireWatchdog } from "../src/watchdog.js";

const releases: (() => void)[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	for (const release of releases.splice(0)) release();
	vi.useRealTimers();
});
function acquire() {
	releases.push(acquireWatchdog());
}
function request(overrides: object = {}) {
	return { origin: "https://api.anthropic.com", path: "/v1/messages", method: "POST", abort: vi.fn(), ...overrides };
}
function headers(req: ReturnType<typeof request>, statusCode = 200, extra: string[] = []) {
	channel("undici:request:headers").publish({
		request: req,
		response: { statusCode, headers: ["content-type", "text/event-stream; charset=utf-8", ...extra] },
	});
}
function body(req: ReturnType<typeof request>, chunk: Uint8Array | string) {
	channel("undici:request:bodyChunkReceived").publish({
		request: req,
		chunk: typeof chunk === "string" ? Buffer.from(chunk) : chunk,
	});
}
function end(req: ReturnType<typeof request>, kind = "trailers") {
	channel(`undici:request:${kind}`).publish({ request: req });
}

test("the initial deadline is45s and complete non-ping events switch to15min", () => {
	acquire();
	const req = request();
	headers(req);
	vi.advanceTimersByTime(44_999);
	body(req, "event: ping\ndata: {}\n\n");
	expect(req.abort).not.toHaveBeenCalled();
	vi.advanceTimersByTime(1);
	expect(req.abort).toHaveBeenCalledOnce();
	expect(req.abort.mock.calls[0][0].message).toContain("timed out");
	expect(vi.getTimerCount()).toBe(0);

	const next = request();
	headers(next);
	body(next, "event: message_start\ndata: {}\n\n");
	vi.advanceTimersByTime(899_999);
	body(next, "event: ping\ndata: {}\n\n");
	expect(next.abort).not.toHaveBeenCalled();
	vi.advanceTimersByTime(1);
	expect(next.abort).toHaveBeenCalledOnce();
});

test("split CRLF frames, comments, multiline data and UTF8 payloads preserve progress without treating partial frames as events", () => {
	acquire();
	const req = request();
	headers(req);
	const bytes = Buffer.from(
		": comment\r\nevent: ping\r\ndata: {}\r\n\r\nevent: thinking_delta\r\ndata: \u754c\r\ndata: more\r\n\r\n",
	);
	for (const byte of bytes) body(req, Uint8Array.of(byte));
	vi.advanceTimersByTime(899_999);
	body(req, "event: tool_delta\ndata: not complete");
	expect(req.abort).not.toHaveBeenCalled();
	vi.advanceTimersByTime(1);
	expect(req.abort).toHaveBeenCalledOnce();
});

test.each([
	{ origin: "https://other.invalid" },
	{ origin: "http://api.anthropic.com" },
	{ origin: "https://api.anthropic.com.evil.invalid" },
	{ path: "/v1/messages/count_tokens" },
	{ path: "/v1/messages/" },
	{ method: "GET" },
])("other endpoints are not watched: %j", (override) => {
	acquire();
	const req = request(override);
	headers(req);
	vi.advanceTimersByTime(1_000_000);
	expect(req.abort).not.toHaveBeenCalled();
	expect(vi.getTimerCount()).toBe(0);
});

test.each([101, 301, 429, 500])("HTTP%s is outside successful streaming enforcement", (status) => {
	acquire();
	const req = request();
	headers(req, status);
	vi.advanceTimersByTime(1_000_000);
	expect(req.abort).not.toHaveBeenCalled();
	expect(vi.getTimerCount()).toBe(0);
});

test("non-SSE responses have no deadline; a query on the messages path remains in scope", () => {
	acquire();
	const json = request();
	channel("undici:request:headers").publish({
		request: json,
		response: { statusCode: 200, headers: ["Content-Type", "application/json"] },
	});
	const sse = request({ path: "/v1/messages?beta=true" });
	headers(sse);
	vi.advanceTimersByTime(45_000);
	expect(json.abort).not.toHaveBeenCalled();
	expect(sse.abort).toHaveBeenCalledOnce();
});

test.each(["trailers", "error"])("request %s releases its deadline and ignores later bytes", (kind) => {
	acquire();
	const req = request();
	headers(req);
	end(req, kind);
	body(req, "event: message_start\ndata: {}\n\n");
	vi.advanceTimersByTime(1_000_000);
	expect(req.abort).not.toHaveBeenCalled();
	expect(vi.getTimerCount()).toBe(0);
});

test("concurrent requests have independent deadlines and termination", () => {
	acquire();
	const stalled = request();
	const healthy = request();
	headers(stalled);
	headers(healthy);
	body(healthy, "event: message_start\ndata: {}\n\n");
	vi.advanceTimersByTime(45_000);
	expect(stalled.abort).toHaveBeenCalledOnce();
	expect(healthy.abort).not.toHaveBeenCalled();
	expect(vi.getTimerCount()).toBe(1);
	end(healthy);
	expect(vi.getTimerCount()).toBe(0);
});

test("separately loaded module graphs share one enforcer until the last owner leaves", async () => {
	const first = acquireWatchdog();
	releases.push(first);
	vi.resetModules();
	const other = await import("../src/watchdog.js");
	const second = other.acquireWatchdog();
	releases.push(second);
	const req = request();
	headers(req);
	expect(vi.getTimerCount()).toBe(1);
	first();
	first();
	expect(vi.getTimerCount()).toBe(1);
	second();
	expect(vi.getTimerCount()).toBe(0);
	vi.advanceTimersByTime(1_000_000);
	expect(req.abort).not.toHaveBeenCalled();
	headers(request());
	expect(vi.getTimerCount()).toBe(0);
});

test("session shutdown and reload release and reacquire diagnostics ownership", () => {
	const handlers = new Map<string, () => void>();
	install({
		on: (name: string, handler: () => void) => {
			handlers.set(name, handler);
		},
	} as unknown as ExtensionAPI);
	const shutdown = handlers.get("session_shutdown")!;
	releases.push(shutdown);
	const inactive = request();
	headers(inactive);
	expect(vi.getTimerCount()).toBe(0);
	handlers.get("session_start")!();
	const old = request();
	headers(old);
	expect(vi.getTimerCount()).toBe(1);
	shutdown();
	shutdown();
	expect(vi.getTimerCount()).toBe(0);
	handlers.get("session_start")!();
	const current = request();
	headers(current);
	vi.advanceTimersByTime(45_000);
	expect(old.abort).not.toHaveBeenCalled();
	expect(current.abort).toHaveBeenCalledOnce();
});

test("actual SDK reload releases old requests and installs the fresh session subscription", async () => {
	const run = await fauxSession([install], [fauxAssistantMessage("ok")], []);
	try {
		const errors: unknown[] = [];
		await run.session.bindExtensions({
			onError: (error) => {
				errors.push(error);
			},
		});
		await run.session.prompt("Bind the local lifecycle fixture.");
		const old = request();
		headers(old);
		await run.session.reload();
		const current = request();
		headers(current);
		vi.advanceTimersByTime(45_000);
		expect(old.abort).not.toHaveBeenCalled();
		expect(current.abort).toHaveBeenCalledOnce();
		expect(errors).toEqual([]);
	} finally {
		await run.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		run.dispose();
	}
});

test("decoder failure releases the timer while the native HTTP reader owns its error", async () => {
	acquire();
	const req = request();
	headers(req, 200, ["content-encoding", "gzip"]);
	body(req, "invalid compressed bytes");
	await vi.waitFor(() => expect(vi.getTimerCount()).toBe(0));
	vi.advanceTimersByTime(1_000_000);
	expect(req.abort).not.toHaveBeenCalled();
});

test("stacked compressed streams decode incrementally and shutdown discards pending decoder work", async () => {
	const delays: number[] = [];
	releases.push(
		acquireWatchdog({
			setTimeout: (callback, ms) => {
				delays.push(ms);
				return setTimeout(callback, ms);
			},
			clearTimeout,
		}),
	);
	const req = request();
	headers(req, 200, ["content-encoding", "gzip, br"]);
	const wire = brotliCompressSync(gzipSync("event: message_start\ndata: {}\n\n"));
	for (const byte of wire) body(req, Uint8Array.of(byte));
	await vi.waitFor(() => expect(delays).toContain(900_000));
	vi.advanceTimersByTime(45_000);
	expect(req.abort).not.toHaveBeenCalled();
	body(req, wire);
	end(req);
	vi.advanceTimersByTime(1_000_000);
	expect(req.abort).not.toHaveBeenCalled();
	expect(vi.getTimerCount()).toBe(0);
});
