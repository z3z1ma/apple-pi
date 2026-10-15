import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PAGE_DATA_MARKER } from "../src/page-data.js";
import { openPageSession } from "../src/page-server.js";
import { embedPage, savePage } from "../src/saved-page.js";

const parse = (body: unknown) =>
	typeof body === "object" && body && "ok" in body ? (body as { ok: boolean }) : undefined;
const closers: (() => void)[] = [];
afterEach(() => {
	for (const close of closers.splice(0)) close();
});

async function open(signal?: AbortSignal) {
	const session = await openPageSession("<p>page</p>", "secret", parse, signal);
	closers.push(session.close);
	return session;
}

describe("openPageSession", () => {
	it("serves the page only with the token", async () => {
		const session = await open();
		expect(await (await fetch(session.url)).text()).toBe("<p>page</p>");
		expect((await fetch(session.url.replace("t=secret", "t=wrong"))).status).toBe(403);
	});

	it("resolves with a valid submission and refuses a second one", async () => {
		const session = await open();
		const post = (token: string, body: unknown) =>
			fetch(new URL("/result", session.url), {
				method: "POST",
				headers: { "x-page-token": token, "content-type": "application/json" },
				body: JSON.stringify(body),
			});
		expect((await post("wrong", { ok: true })).status).toBe(403);
		expect((await post("secret", { nope: 1 })).status).toBe(400);
		expect((await post("secret", { ok: true })).status).toBe(200);
		await expect(session.result).resolves.toEqual({ ok: true });
		expect((await post("secret", { ok: true })).status).toBe(409);
	});

	it("rejects the result when the caller aborts", async () => {
		const controller = new AbortController();
		const session = await open(controller.signal);
		controller.abort();
		await expect(session.result).rejects.toThrow("closed before the reviewer submitted");
	});
});

describe("saved pages", () => {
	let dir: string | undefined;
	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it("embeds data so it cannot close its script element", () => {
		const html = embedPage(`<body>${PAGE_DATA_MARKER}</body>`, { text: "</script><script>alert(1)</script>" });
		expect(html).not.toContain("</script><script>alert");
		expect(html).toContain("\\u003c/script>");
	});

	it("writes a dated page under the agent directory without overwriting", async () => {
		dir = mkdtempSync(join(tmpdir(), "browser-pages-agent-"));
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = dir;
		try {
			const when = new Date("2026-10-15T12:00:00Z");
			const first = await savePage("one", "/work/apple-pi", "Retry: transient failures!", when);
			const second = await savePage("two", "/work/apple-pi", "Retry: transient failures!", when);
			expect(first).toBe(join(dir, "artifacts", "apple-pi", "2026-10-15-retry-transient-failures.html"));
			expect(second).toBe(join(dir, "artifacts", "apple-pi", "2026-10-15-retry-transient-failures-2.html"));
			expect(readFileSync(first, "utf8")).toBe("one");
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
		}
	});
});
