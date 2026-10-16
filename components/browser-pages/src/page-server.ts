import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface PageSession<R> {
	url: string;
	/** Settles with the reviewer's submission, or rejects when the session is aborted or closed first. */
	result: Promise<R>;
	close(): void;
}

async function readBody(req: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString("utf8");
}

function send(res: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8"): void {
	res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
	res.end(body);
}

/**
 * Serves one page on 127.0.0.1 until the reviewer submits or the session closes. Every request must carry the
 * session token (query `t` for the page, header `x-page-token` for posts) and address the server by its
 * loopback host, so other local origins cannot read the page or answer for the reviewer.
 *
 * `ask` answers questions posted to `/ask` while the page is open. It returns the answer, or undefined for a
 * malformed question; its signal aborts when the page stops waiting or the session closes. `file` answers
 * `GET /file?path=…` with JSON, or undefined for a path the page may not read. `note` takes what the page posts
 * to `/note`. `GET /health` answers `health()` while the server runs, so a page knows whether its agent features can work. A page
 * without `parse` takes no submission, and its `result` never settles.
 */
export async function openPageSession<R>(
	html: string,
	token: string,
	parse: ((body: unknown) => R | undefined) | undefined,
	options: {
		signal?: AbortSignal;
		ask?: (body: unknown, signal: AbortSignal) => Promise<string | undefined>;
		file?: (path: string) => Promise<unknown | undefined>;
		note?: (body: unknown) => void;
		health?: () => unknown;
	} = {},
): Promise<PageSession<R>> {
	const { signal, ask, file, note, health } = options;
	const asking = new AbortController();
	let settle: { resolve: (value: R) => void; reject: (error: Error) => void } | undefined;
	const result = new Promise<R>((resolve, reject) => {
		settle = { resolve, reject };
	});
	// A session closed before anyone awaits it must not surface as an unhandled rejection.
	result.catch(() => {});
	let done = false;
	let host = "";

	const settleWith = async (req: IncomingMessage, res: ServerResponse, parse: (body: unknown) => R | undefined) => {
		if (done) return send(res, 409, "This review was already closed.");
		let value: R | undefined;
		try {
			value = parse(JSON.parse(await readBody(req)));
		} catch {
			value = undefined;
		}
		if (value === undefined) return send(res, 400, "Invalid review.");
		done = true;
		send(res, 200, "{}", "application/json");
		settle?.resolve(value);
	};

	const answer = async (
		req: IncomingMessage,
		res: ServerResponse,
		ask: (body: unknown, signal: AbortSignal) => Promise<string | undefined>,
	) => {
		if (done) return send(res, 409, "This review was already closed.");
		const stop = new AbortController();
		const abort = () => stop.abort();
		asking.signal.addEventListener("abort", abort, { once: true });
		res.on("close", () => {
			if (!res.writableFinished) abort();
			asking.signal.removeEventListener("abort", abort);
		});
		let body: unknown;
		try {
			body = JSON.parse(await readBody(req));
		} catch {
			return send(res, 400, "Invalid question.");
		}
		try {
			const reply = await ask(body, stop.signal);
			if (reply === undefined) return send(res, 400, "Invalid question.");
			return send(res, 200, JSON.stringify({ answer: reply }), "application/json");
		} catch (error) {
			return send(res, 502, error instanceof Error ? error.message : String(error));
		}
	};

	const serveFile = async (res: ServerResponse, path: string, file: (path: string) => Promise<unknown | undefined>) => {
		try {
			const value = await file(path);
			if (value === undefined) return send(res, 404, "Not found");
			return send(res, 200, JSON.stringify(value), "application/json");
		} catch (error) {
			return send(res, 500, error instanceof Error ? error.message : String(error));
		}
	};

	const server = createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		if (req.headers.host !== host) return send(res, 403, "Forbidden");
		if (req.method === "GET" && url.pathname === "/") {
			if (url.searchParams.get("t") !== token) return send(res, 403, "Forbidden");
			return send(res, 200, html, "text/html; charset=utf-8");
		}
		if (req.headers["x-page-token"] !== token) return send(res, 403, "Forbidden");
		if (req.method === "GET" && url.pathname === "/health")
			return send(res, 200, JSON.stringify(health?.() ?? {}), "application/json");
		if (req.method === "POST" && url.pathname === "/result" && parse) return settleWith(req, res, parse);
		if (req.method === "POST" && url.pathname === "/note" && note) {
			try {
				note(JSON.parse(await readBody(req)));
			} catch {
				return send(res, 400, "Invalid note.");
			}
			return send(res, 200, "{}", "application/json");
		}
		if (req.method === "POST" && url.pathname === "/ask" && ask) return answer(req, res, ask);
		if (req.method === "GET" && url.pathname === "/file" && file)
			return serveFile(res, url.searchParams.get("path") ?? "", file);
		send(res, 404, "Not found");
	});

	const close = () => {
		if (!done) {
			done = true;
			settle?.reject(new Error("The page was closed before the reviewer submitted."));
		}
		signal?.removeEventListener("abort", close);
		asking.abort();
		server.close();
		server.closeAllConnections();
	};

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const { port } = server.address() as AddressInfo;
	host = `127.0.0.1:${port}`;
	if (signal?.aborted) close();
	else signal?.addEventListener("abort", close, { once: true });
	return { url: `http://${host}/?t=${token}`, result, close };
}
