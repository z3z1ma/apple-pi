const MAX_FETCH_BODY_BYTES = 10 * 1_024 * 1_024;

export function traceFetchUrl(value: unknown): string {
	const raw = typeof value === "string" ? value : String(value ?? "");
	try {
		const url = new URL(raw);
		url.username = "";
		url.password = "";
		if (url.search) url.search = "?[redacted]";
		if (url.hash) url.hash = "#[redacted]";
		return url.href;
	} catch {
		return raw;
	}
}

export function fetchOperationArgs(args: Record<string, unknown>): Record<string, unknown> {
	const headers = Array.isArray(args.headers)
		? args.headers
				.filter((header): header is unknown[] => Array.isArray(header) && header.length > 0)
				.map((header) => String(header[0]))
		: [];
	return {
		url: traceFetchUrl(args.url),
		method: typeof args.method === "string" ? args.method : "GET",
		...(headers.length > 0 ? { headerNames: headers } : {}),
		...(typeof args.body === "string" ? { bodyBytes: Buffer.byteLength(args.body, "base64") } : {}),
	};
}

async function fetchResponseBody(response: Response): Promise<Uint8Array> {
	if (!response.body) return new Uint8Array();
	const declaredLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(declaredLength) && declaredLength > MAX_FETCH_BODY_BYTES) {
		await response.body.cancel();
		throw new Error(`fetch response exceeds ${MAX_FETCH_BODY_BYTES.toLocaleString()} bytes`);
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_FETCH_BODY_BYTES) {
			await reader.cancel();
			throw new Error(`fetch response exceeds ${MAX_FETCH_BODY_BYTES.toLocaleString()} bytes`);
		}
		chunks.push(value);
	}
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

export async function executeFetch(
	args: Record<string, unknown>,
	signal: AbortSignal,
): Promise<Record<string, unknown>> {
	if (typeof args.url !== "string" || args.url.trim() === "") {
		throw new TypeError("fetch requires an absolute URL");
	}
	if (
		args.headers !== undefined &&
		(!Array.isArray(args.headers) ||
			args.headers.some(
				(header) => !Array.isArray(header) || header.length !== 2 || header.some((value) => typeof value !== "string"),
			))
	) {
		throw new TypeError("fetch headers must be [name, value] string pairs");
	}
	if (args.body !== undefined && typeof args.body !== "string") {
		throw new TypeError("fetch body must be base64-encoded");
	}
	const redirect = args.redirect === undefined ? "follow" : String(args.redirect);
	if (!new Set(["follow", "error", "manual"]).has(redirect)) {
		throw new TypeError("fetch redirect must be follow, error, or manual");
	}
	if (typeof args.body === "string" && args.body.length > Math.ceil((MAX_FETCH_BODY_BYTES * 4) / 3) + 4) {
		throw new Error(`fetch request exceeds ${MAX_FETCH_BODY_BYTES.toLocaleString()} bytes`);
	}
	const body = typeof args.body === "string" ? Buffer.from(args.body, "base64") : undefined;
	if (body && body.byteLength > MAX_FETCH_BODY_BYTES) {
		throw new Error(`fetch request exceeds ${MAX_FETCH_BODY_BYTES.toLocaleString()} bytes`);
	}
	const response = await fetch(args.url, {
		method: typeof args.method === "string" ? args.method : "GET",
		headers: args.headers as Array<[string, string]> | undefined,
		...(body !== undefined ? { body } : {}),
		redirect: redirect as RequestRedirect,
		signal,
	});
	const responseBody = await fetchResponseBody(response);
	const headers: Array<[string, string]> = [];
	response.headers.forEach((value, name) => {
		headers.push([name, value]);
	});
	return {
		status: response.status,
		statusText: response.statusText,
		headers,
		url: response.url,
		redirected: response.redirected,
		type: response.type,
		body: Buffer.from(responseBody).toString("base64"),
		bodyBytes: responseBody.byteLength,
	};
}
