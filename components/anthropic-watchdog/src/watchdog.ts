import { channel } from "node:diagnostics_channel";
import type { Transform } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate, createInflateRaw, createZstdDecompress } from "node:zlib";
import { SseProgress } from "./sse-progress.js";

export type WatchdogTimers = {
	setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
	clearTimeout(timer: ReturnType<typeof setTimeout> | undefined): void;
};

interface Request {
	origin: string;
	path: string;
	method: string;
	abort(error: Error): void;
}
interface HeadersEvent {
	request: Request;
	response: { statusCode: number; headers: (Buffer | string)[] };
}
interface RequestEvent {
	request: Request;
}
interface BodyEvent extends RequestEvent {
	chunk: Uint8Array;
}

const SHARED = Symbol.for("apple-pi.anthropic-watchdog");
const processState = globalThis as Record<PropertyKey, unknown>;
type Service = { owners: number; dispose(): void };

function header(headers: (Buffer | string)[], name: string): string {
	for (let i = 0; i < headers.length; i += 2) {
		if (String(headers[i]).toLowerCase() === name) return String(headers[i + 1]);
	}
	return "";
}

function start(timers: WatchdogTimers): Service {
	const requests = new Map<Request, { write(chunk: Uint8Array): void; dispose(): void }>();
	const finish = (message: unknown) => {
		const { request } = message as RequestEvent;
		requests.get(request)?.dispose();
	};
	const headers = (message: unknown) => {
		const { request, response } = message as HeadersEvent;
		if (
			request.origin !== "https://api.anthropic.com" ||
			request.path.split("?")[0] !== "/v1/messages" ||
			request.method !== "POST" ||
			typeof request.abort !== "function" ||
			response.statusCode < 200 ||
			response.statusCode >= 300 ||
			header(response.headers, "content-type").split(";")[0].trim().toLowerCase() !== "text/event-stream"
		)
			return;
		const encodings = header(response.headers, "content-encoding")
			.toLowerCase()
			.split(",")
			.map((coding) => coding.trim())
			.filter((coding) => coding && coding !== "identity");
		if (encodings.some((coding) => !["gzip", "x-gzip", "br", "deflate", "zstd"].includes(coding))) return;
		const decoders: Transform[] = [];
		let timer: ReturnType<typeof setTimeout> | undefined;
		let disposed = false;
		const dispose = () => {
			if (disposed) return;
			disposed = true;
			timers.clearTimeout(timer);
			requests.delete(request);
			for (const decoder of decoders) decoder.destroy();
		};
		const arm = (ms: number) => {
			timers.clearTimeout(timer);
			timer = timers.setTimeout(() => {
				dispose();
				request.abort(new Error("Anthropic response timed out waiting for a non-ping SSE event"));
			}, ms);
			timer.unref?.();
		};
		const parser = new SseProgress(() => {
			if (!disposed) arm(15 * 60_000);
		});
		let write = (chunk: Uint8Array) => parser.write(chunk);
		for (const encoding of encodings) {
			const next = write;
			let decoder: Transform | undefined;
			write = (chunk) => {
				if (disposed || chunk.length === 0) return;
				if (!decoder) {
					decoder =
						encoding === "br"
							? createBrotliDecompress()
							: encoding === "zstd"
								? createZstdDecompress()
								: encoding === "deflate"
									? (chunk[0] & 0x0f) === 0x08
										? createInflate()
										: createInflateRaw()
									: createGunzip();
					decoders.push(decoder);
					decoder.on("data", next);
					decoder.on("error", dispose);
				}
				decoder.write(chunk);
			};
		}
		requests.set(request, { write, dispose });
		arm(45_000);
	};
	const body = (message: unknown) => {
		const { request, chunk } = message as BodyEvent;
		requests.get(request)?.write(chunk);
	};
	const subscriptions: [string, (message: unknown) => void][] = [
		["undici:request:headers", headers],
		["undici:request:bodyChunkReceived", body],
		["undici:request:trailers", finish],
		["undici:request:error", finish],
	];
	for (const [name, handler] of subscriptions) channel(name).subscribe(handler);
	return {
		owners: 0,
		dispose() {
			for (const [name, handler] of subscriptions) channel(name).unsubscribe(handler);
			for (const request of requests.values()) request.dispose();
		},
	};
}

export function acquireWatchdog(timers: WatchdogTimers = { setTimeout, clearTimeout }): () => void {
	processState[SHARED] ??= start(timers);
	const service = processState[SHARED] as Service;
	service.owners++;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		if (--service.owners === 0) {
			service.dispose();
			delete processState[SHARED];
		}
	};
}
