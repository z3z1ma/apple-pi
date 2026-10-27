import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as httpServer } from "node:http";
import { createServer as httpsServer } from "node:https";
import type { AddressInfo, Socket } from "node:net";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	constants,
	createBrotliCompress,
	createDeflate,
	createDeflateRaw,
	createGzip,
	createZstdCompress,
} from "node:zlib";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import {
	createAgentSession,
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getGlobalDispatcher } from "undici";
import { configureHttpDispatcher } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/http-dispatcher.js";
import { fauxModelBackend } from "../../../tests/helpers/faux-model.js";
import { acquireWatchdog } from "../src/watchdog.js";

const certDir = process.argv[2];
const cwd = mkdtempSync(join(tmpdir(), "anthropic-watchdog-trial-"));
const mode = process.argv[3] ?? "initial";
const encoding =
	mode === "initial-zstd"
		? "zstd"
		: mode === "healthy-deflate-raw"
			? "deflate"
			: mode.startsWith("healthy-")
				? mode.slice(8)
				: "identity";
const usesTool = mode === "tools" || mode === "post-tool-stall";
const retainedToolResults: boolean[] = [];
let requests = 0;
let toolCalls = 0;
const timersDuringTool: number[] = [];
const liveTimers = new Set<ReturnType<typeof setTimeout>>();
const sockets = new Set<Socket>();
function track(socket: Socket) {
	sockets.add(socket);
	socket.on("close", () => sockets.delete(socket));
}
let firstHeaders!: () => void;
const sawFirstHeaders = new Promise<void>((resolve) => {
	firstHeaders = resolve;
});
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const completed = () => [
	frame("message_start", {
		type: "message_start",
		message: {
			id: "msg_test",
			type: "message",
			role: "assistant",
			model: "test",
			content: [],
			stop_reason: null,
			usage: { input_tokens: 2, output_tokens: 0 },
		},
	}),
	frame("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
	frame("content_block_delta", {
		type: "content_block_delta",
		index: 0,
		delta: { type: "text_delta", text: "recovered" },
	}),
	frame("content_block_stop", { type: "content_block_stop", index: 0 }),
	frame("message_delta", {
		type: "message_delta",
		delta: { stop_reason: "end_turn", stop_sequence: null },
		usage: { output_tokens: 1 },
	}),
	frame("message_stop", { type: "message_stop" }),
];
const server = httpsServer(
	{ key: readFileSync(join(certDir, "key.pem")), cert: readFileSync(join(certDir, "cert.pem")) },
	(req, res) => {
		requests++;
		const index = requests - 1;
		let requestBody = "";
		req.setEncoding("utf8");
		req.on("data", (chunk: string) => {
			requestBody += chunk;
		});
		req.on("end", () => {
			const payload = JSON.parse(requestBody) as {
				messages: { content: string | { type: string; tool_use_id?: string }[] }[];
			};
			retainedToolResults[index] = payload.messages.some(
				(message) =>
					Array.isArray(message.content) &&
					message.content.some((part) => part.type === "tool_result" && part.tool_use_id === "call_local"),
			);
		});
		if (requests === 1) firstHeaders();
		res.writeHead(200, {
			"content-type": "text/event-stream",
			...(encoding === "identity" ? {} : { "content-encoding": encoding }),
		});
		res.flushHeaders();
		const compressor =
			encoding === "gzip"
				? createGzip()
				: encoding === "br"
					? createBrotliCompress()
					: encoding === "deflate"
						? mode === "healthy-deflate-raw"
							? createDeflateRaw()
							: createDeflate()
						: encoding === "zstd"
							? createZstdCompress()
							: undefined;
		compressor?.pipe(res);
		const output = compressor ?? res;
		const write = (text: string) => {
			output.write(text);
			compressor?.flush(
				encoding === "br"
					? constants.BROTLI_OPERATION_FLUSH
					: encoding === "zstd"
						? constants.ZSTD_e_flush
						: constants.Z_SYNC_FLUSH,
			);
		};
		if (usesTool && requests === 1) {
			const parts = [
				completed()[0],
				frame("content_block_start", {
					type: "content_block_start",
					index: 0,
					content_block: { type: "thinking", thinking: "" },
				}),
				frame("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "thinking_delta", thinking: "checking" },
				}),
				frame("content_block_stop", { type: "content_block_stop", index: 0 }),
				frame("content_block_start", {
					type: "content_block_start",
					index: 1,
					content_block: { type: "tool_use", id: "call_local", name: "record", input: {} },
				}),
				frame("content_block_delta", {
					type: "content_block_delta",
					index: 1,
					delta: { type: "input_json_delta", partial_json: '{"value":"done"}' },
				}),
				frame("content_block_stop", { type: "content_block_stop", index: 1 }),
				frame("message_delta", {
					type: "message_delta",
					delta: { stop_reason: "tool_use", stop_sequence: null },
					usage: { output_tokens: 1 },
				}),
				frame("message_stop", { type: "message_stop" }),
			];
			write(parts.shift()!);
			const interval = setInterval(() => {
				if (parts.length) write(parts.shift()!);
				else {
					clearInterval(interval);
					output.end();
				}
			}, 40);
			res.on("close", () => clearInterval(interval));
			return;
		}
		if (mode.startsWith("healthy-") || (mode === "concurrent" && requests === 2)) {
			const parts = completed();
			write(parts[0]);
			write(parts[1]);
			let count = 0;
			const interval = setInterval(() => {
				write(parts[2]);
				if (++count === 8) {
					clearInterval(interval);
					output.end(parts.slice(3).join(""));
				}
			}, 40);
			res.on("close", () => {
				clearInterval(interval);
				compressor?.destroy();
			});
			return;
		}
		if (requests > 1 && mode !== "exhaust" && !(mode === "post-tool-stall" && requests === 2))
			return output.end(completed().join(""));
		if (mode === "midstream") write(completed()[0]);
		if (mode === "cancel")
			setTimeout(() => {
				void session.abort();
			}, 40);
		const ping = setInterval(() => write(frame("ping", { type: "ping" })), 15);
		res.on("close", () => {
			clearInterval(ping);
			compressor?.destroy();
		});
	},
);
server.on("connection", track);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const proxy = httpServer();
proxy.on("connection", track);
proxy.on("connect", (_req, socket, head) => {
	const upstream = connect((server.address() as AddressInfo).port, "127.0.0.1", () => {
		socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
		if (head.length) upstream.write(head);
		socket.pipe(upstream).pipe(socket);
	});
	socket.on("error", () => upstream.destroy());
	upstream.on("error", () => socket.destroy());
	socket.on("close", () => upstream.destroy());
});
await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
for (const key of [
	"HTTP_PROXY",
	"http_proxy",
	"HTTPS_PROXY",
	"https_proxy",
	"ALL_PROXY",
	"all_proxy",
	"NO_PROXY",
	"no_proxy",
])
	delete process.env[key];
process.env.HTTPS_PROXY = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
process.env.ANTHROPIC_API_KEY = "local-test-key";
process.env.PI_CODING_AGENT_DIR = join(cwd, "agent");
configureHttpDispatcher(5000);
const release = acquireWatchdog({
	setTimeout: (callback, ms) => {
		const timer = setTimeout(
			() => {
				liveTimers.delete(timer);
				callback();
			},
			ms === 45_000 ? 100 : 200,
		);
		liveTimers.add(timer);
		return timer;
	},
	clearTimeout: (timer) => {
		if (timer) liveTimers.delete(timer);
		clearTimeout(timer);
	},
});
const model: Model<string> = {
	id: "claude-test",
	name: "Local Anthropic",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://api.anthropic.com",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100_000,
	maxTokens: 1000,
};
const { modelRuntime } = fauxModelBackend(model);
const settingsManager = SettingsManager.inMemory({
	compaction: { enabled: false },
	retry: { enabled: mode !== "disabled", maxRetries: 1, baseDelayMs: 1, provider: { maxRetries: 0 } },
});
const loader = new DefaultResourceLoader({
	cwd,
	agentDir: join(cwd, "agent"),
	settingsManager,
	noExtensions: true,
	noSkills: true,
	noPromptTemplates: true,
	noContextFiles: true,
	systemPrompt: "test",
});
await loader.reload();
const { session } = await createAgentSession({
	cwd,
	model,
	modelRuntime: modelRuntime as never,
	resourceLoader: loader,
	settingsManager,
	sessionManager: SessionManager.inMemory(cwd),
	tools: usesTool ? ["record"] : [],
	customTools: [
		{
			name: "record",
			label: "record",
			description: "Local test tool",
			parameters: Type.Object({ value: Type.String() }),
			async execute() {
				toolCalls++;
				timersDuringTool.push(liveTimers.size);
				await new Promise((resolve) => setTimeout(resolve, 400));
				timersDuringTool.push(liveTimers.size);
				return { content: [{ type: "text", text: "done" }], details: {} };
			},
		},
	],
});
await session.bindExtensions({});
const retryEvents: string[] = [];
session.subscribe((event) => {
	if (event.type.startsWith("auto_retry")) retryEvents.push(event.type);
});
const safety = setTimeout(() => {
	void session.abort();
}, 3000);
try {
	const prompt = session.prompt("Complete the local transport test.");
	let parallel: AssistantMessage | undefined;
	if (mode === "concurrent") {
		await sawFirstHeaders;
		parallel = await streamSimple(model, {
			messages: [{ role: "user", content: "Independent local request", timestamp: Date.now() }],
		}).result();
	}
	await prompt;
	console.log(
		JSON.stringify({
			requests,
			text: session.getLastAssistantText(),
			stopReason: session.messages.findLast((message) => message.role === "assistant")?.stopReason,
			error: session.messages.findLast((message) => message.role === "assistant")?.errorMessage,
			retryEvents,
			toolCalls,
			timersDuringTool,
			retainedToolResults,
			pendingTimers: liveTimers.size,
			parallelStop: parallel?.stopReason,
			parallelText: parallel?.content
				.filter((item) => item.type === "text")
				.map((item) => item.text)
				.join(""),
		}),
	);
} finally {
	clearTimeout(safety);
	release();
	session.dispose();
	for (const socket of sockets) socket.destroy();
	await getGlobalDispatcher().destroy();
	server.closeAllConnections();
	await Promise.all([
		new Promise<void>((resolve) => server.close(() => resolve())),
		new Promise<void>((resolve) => proxy.close(() => resolve())),
	]);
	rmSync(cwd, { recursive: true, force: true });
}
