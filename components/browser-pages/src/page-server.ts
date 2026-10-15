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
 * session token (query `t` for the page, header `x-page-token` for the submission) and address the server by
 * its loopback host, so other local origins cannot read the page or answer for the reviewer.
 */
export async function openPageSession<R>(
	html: string,
	token: string,
	parse: (body: unknown) => R | undefined,
	signal?: AbortSignal,
): Promise<PageSession<R>> {
	let settle: { resolve: (value: R) => void; reject: (error: Error) => void } | undefined;
	const result = new Promise<R>((resolve, reject) => {
		settle = { resolve, reject };
	});
	// A session closed before anyone awaits it must not surface as an unhandled rejection.
	result.catch(() => {});
	let done = false;
	let host = "";

	const server = createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		if (req.headers.host !== host) return send(res, 403, "Forbidden");
		if (req.method === "GET" && url.pathname === "/") {
			if (url.searchParams.get("t") !== token) return send(res, 403, "Forbidden");
			return send(res, 200, html, "text/html; charset=utf-8");
		}
		if (req.method === "POST" && url.pathname === "/result") {
			if (req.headers["x-page-token"] !== token) return send(res, 403, "Forbidden");
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
			return;
		}
		send(res, 404, "Not found");
	});

	const close = () => {
		if (!done) {
			done = true;
			settle?.reject(new Error("The page was closed before the reviewer submitted."));
		}
		signal?.removeEventListener("abort", close);
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
