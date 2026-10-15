// LOCAL CHECK, not part of the suite: builds a real page from a demo repository, serves it, waits for a
// browser to submit, and writes the model-facing result. Run: DEMO_OUT=/tmp/bp npx vitest run <this file>
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { it } from "vitest";

import { buildCodeReviewPage, formatReviewResult, parseQuestion, parseReviewResult } from "../src/code-review.js";
import { openPageSession } from "../src/page-server.js";
import { embedPage, readTemplate } from "../src/saved-page.js";

const out = process.env.DEMO_OUT ?? "/tmp/bp";

it("serves a demo review and records the submission", { timeout: 600_000 }, async () => {
	const repo = mkdtempSync(join(tmpdir(), "bp-demo-"));
	const write = (path: string, text: string) => {
		mkdirSync(dirname(join(repo, path)), { recursive: true });
		writeFileSync(join(repo, path), text);
	};
	const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
	git("init", "-q", "-b", "main");
	git("config", "user.email", "t@e.com");
	git("config", "user.name", "T");
	write(
		"src/http/client.ts",
		`import { HttpError } from "./errors.js";\n\nexport interface ClientOptions {\n  baseUrl: string;\n  timeoutMs?: number;\n}\n\nexport class HttpClient {\n  constructor(private readonly options: ClientOptions) {}\n\n  async request(path: string, init: RequestInit = {}): Promise<Response> {\n    const response = await fetch(this.url(path), { ...init, signal: this.signal(init) });\n    if (!response.ok) throw new HttpError(response);\n    return response;\n  }\n\n  private url(path: string): string {\n    return new URL(path, this.options.baseUrl).toString();\n  }\n}\n`,
	);
	write(
		"src/util/sleep.ts",
		"export function sleep(ms: number): Promise<void> {\n  return new Promise((resolve) => setTimeout(resolve, ms));\n}\n",
	);
	write(
		"src/util/format.ts",
		"export function formatBytes(bytes: number): string {\n  const units = ['B', 'KB', 'MB', 'GB'];\n  let value = bytes;\n  return `${value} ${units[0]}`;\n}\n",
	);
	write(
		"docs/http.md",
		"# HTTP client\n\n## Options\n\n- `baseUrl`: the API root.\n- `timeoutMs`: abort a single attempt after this many milliseconds.\n",
	);
	git("add", ".");
	git("commit", "-q", "-m", "base");
	write(
		"src/http/client.ts",
		`import { HttpError } from "./errors.js";\nimport { backoffMs, defaultRetryPolicy, isRetryable, retryAfterMs, type RetryPolicy } from "./retry.js";\nimport { sleep } from "../util/sleep.js";\n\nexport interface ClientOptions {\n  baseUrl: string;\n  timeoutMs?: number;\n  retry?: Partial<RetryPolicy> | false;\n}\n\nexport class HttpClient {\n  constructor(private readonly options: ClientOptions) {}\n\n  async request(path: string, init: RequestInit = {}): Promise<Response> {\n    const policy = this.retryPolicy();\n    const started = Date.now();\n    for (let attempt = 0; ; attempt++) {\n      const response = await fetch(this.url(path), { ...init, signal: this.signal(init) });\n      if (response.ok) return response;\n      const last = !policy || attempt + 1 >= policy.maxAttempts || !isRetryable(response) || !isIdempotent(init);\n      if (last) throw new HttpError(response);\n      const delay = retryAfterMs(response) ?? backoffMs(attempt, policy);\n      if (Date.now() - started + delay > policy.budgetMs) throw new HttpError(response);\n      await sleep(delay, init.signal ?? undefined);\n    }\n  }\n\n  private url(path: string): string {\n    return new URL(path, this.options.baseUrl).toString();\n  }\n\n  private retryPolicy(): RetryPolicy | undefined {\n    if (this.options.retry === false) return undefined;\n    return { ...defaultRetryPolicy, ...this.options.retry };\n  }\n}\n\nconst IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);\n\nfunction isIdempotent(init: RequestInit): boolean {\n  const method = (init.method ?? "GET").toUpperCase();\n  if (IDEMPOTENT_METHODS.has(method)) return true;\n  return new Headers(init.headers).has("idempotency-key");\n}\n`,
	);
	write(
		"src/http/retry.ts",
		`export interface RetryPolicy {\n  maxAttempts: number;\n  baseDelayMs: number;\n  maxDelayMs: number;\n  budgetMs: number;\n}\n\nexport const defaultRetryPolicy: RetryPolicy = {\n  maxAttempts: 4,\n  baseDelayMs: 250,\n  maxDelayMs: 8_000,\n  budgetMs: 30_000,\n};\n\nconst RETRYABLE_STATUS = new Set([408, 429, 502, 503, 504]);\n\nexport function isRetryable(response: Response): boolean {\n  return RETRYABLE_STATUS.has(response.status);\n}\n\nexport function retryAfterMs(response: Response, now = Date.now()): number | undefined {\n  const header = response.headers.get("retry-after");\n  if (!header) return undefined;\n  const seconds = Number(header);\n  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);\n  const date = Date.parse(header);\n  return Number.isNaN(date) ? undefined : Math.max(0, date - now);\n}\n\nexport function backoffMs(attempt: number, policy: RetryPolicy, random = Math.random): number {\n  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);\n  return Math.round(random() * ceiling);\n}\n`,
	);
	write(
		"src/util/sleep.ts",
		`export function sleep(ms: number, signal?: AbortSignal): Promise<void> {\n  return new Promise((resolve, reject) => {\n    if (signal?.aborted) return reject(signal.reason);\n    const timer = setTimeout(resolve, ms);\n    signal?.addEventListener(\n      "abort",\n      () => {\n        clearTimeout(timer);\n        reject(signal.reason);\n      },\n      { once: true },\n    );\n  });\n}\n`,
	);
	write(
		"src/util/format.ts",
		'export function formatBytes(bytes: number): string {\n  const units = ["B", "KB", "MB", "GB"];\n  let value = bytes;\n  return `${value} ${units[0]}`;\n}\n',
	);
	write(
		"docs/http.md",
		"# HTTP client\n\n## Options\n\n- `baseUrl`: the API root.\n- `timeoutMs`: abort a single attempt after this many milliseconds.\n- `retry`: override the retry policy, or `false` to turn retries off.\n\n## Retries\n\nResponses with status 408, 429, 502, 503 or 504 are retried with jittered\nexponential backoff, up to 4 attempts and 30 seconds in total.\n",
	);
	write(
		"tests/http/retry.test.ts",
		`import { describe, expect, it } from "vitest";\nimport { backoffMs, defaultRetryPolicy, retryAfterMs } from "../../src/http/retry.js";\n\ndescribe("retry", () => {\n  it("waits for Retry-After given in seconds", () => {\n    const response = new Response(null, { status: 429, headers: { "retry-after": "2" } });\n    expect(retryAfterMs(response)).toBe(2000);\n  });\n\n  it("caps backoff at maxDelayMs", () => {\n    expect(backoffMs(10, defaultRetryPolicy, () => 1)).toBe(8000);\n  });\n});\n`,
	);

	const { page } = await buildCodeReviewPage(
		{
			title: "Retry transient HTTP failures with backoff",
			intent:
				"The billing sync fails a few times a day when the upstream API sheds load with 429 and 503. The HTTP client now retries those responses with jittered exponential backoff, follows `Retry-After`, and never repeats a request that is unsafe to repeat.",
			focus: {
				text: "Read the request loop and the idempotency rule first. Everything else follows from those two.",
				refs: [
					{ file: "src/http/client.ts", lines: "14-24" },
					{ file: "src/http/client.ts", lines: "38-44" },
				],
			},
			verification: [
				{ status: "pass", label: "`npm test`", detail: "52 passed, 2 new" },
				{ status: "pass", label: "`npm run typecheck`", detail: "Clean" },
				{ status: "unverified", label: "A real 429 from the billing API", detail: "Only simulated with a stub server" },
			],
			chapters: [
				{
					title: "A retry policy that listens to the server",
					kind: "core",
					attention: "high",
					brief:
						"Everything about *when* to retry lives in one new module, `retry.ts`. The client only asks three questions: is this response retryable, how long should I wait, and is there budget left?\n\nWaits use **full jitter**: a random delay between zero and a ceiling that doubles with each attempt. If the server sends `Retry-After`, it wins over the computed delay.",
					changes: [
						{
							summary: "New module: which responses to retry, how long to wait, and the total budget.",
							file: "src/http/retry.ts",
						},
					],
				},
				{
					title: "Only retry what is safe to repeat",
					kind: "core",
					attention: "high",
					brief:
						"`request()` becomes a loop. Before each wait it checks four things: attempts are left, the status is retryable, the request is idempotent, and the wait fits in the budget.\n\nA `POST` or `PATCH` is retried only when the caller sent an `Idempotency-Key`.",
					callouts: [
						{
							title: "Behaviour change",
							text: "The payments client already sends `POST /charges` with an `Idempotency-Key`. Charges will now be retried.",
						},
					],
					changes: [
						{
							summary:
								"`request()` becomes a loop: retry while the response is retryable, the request is idempotent, and budget remains.",
							file: "src/http/client.ts",
							lines: "14-25",
						},
						{
							summary:
								"GET, HEAD, OPTIONS, PUT and DELETE repeat safely; anything else only with an `Idempotency-Key`.",
							file: "src/http/client.ts",
							lines: "37-44",
						},
						{
							summary: "New `retry` option: tune the policy, or pass `false` to turn retries off.",
							file: "src/http/client.ts",
							lines: "1-9",
							attention: "medium",
						},
					],
				},
				{
					title: "Cancelling a request also cancels its wait",
					kind: "consequence",
					attention: "medium",
					brief:
						"Before this change, `sleep` could not be interrupted. It now takes an optional `AbortSignal` and rejects as soon as it fires.",
					changes: [
						{ summary: "`sleep` accepts an `AbortSignal` and rejects with its reason.", file: "src/util/sleep.ts" },
					],
				},
				{
					title: "Tests and documentation",
					kind: "support",
					attention: "low",
					brief: "The tests use a stub server and never actually wait.",
					changes: [
						{ summary: "Tests for Retry-After and the backoff cap.", file: "tests/http/retry.test.ts" },
						{ summary: "Documents the `retry` option and which requests are retried.", file: "docs/http.md" },
					],
				},
			],
			notes: [
				{
					file: "src/http/retry.ts",
					line: 12,
					text: "The budget includes the waits. 30 s keeps a fully retried request inside the job runner's 60 s step timeout.",
				},
				{
					file: "src/http/client.ts",
					line: 20,
					text: "One condition per reason to stop. I kept them on one line so the four rules read together.",
				},
			],
			decisions: [
				{
					file: "src/http/retry.ts",
					line: 32,
					question: "How should waits be randomised?",
					context: "This decides how retries from many workers spread out.",
					options: [
						{ label: "Full jitter", detail: "`random(0, ceiling)`" },
						{ label: "Equal jitter", detail: "`ceiling/2 + random(0, ceiling/2)`" },
					],
					chosen: 0,
				},
				{
					file: "src/http/client.ts",
					line: 43,
					question: "Should payment charges be retried?",
					options: [{ label: "Yes, retry them" }, { label: "No, exclude `/charges`" }],
				},
			],
		},
		repo,
		"demo-token",
	);
	mkdirSync(out, { recursive: true });
	const template = await readTemplate("code-review");
	writeFileSync(join(out, "warnings.json"), JSON.stringify(page.warnings, null, 2));
	page.session.ask = true;
	const session = await openPageSession(embedPage(template, page), "demo-token", (body) => parseReviewResult(body, page), {
		// A canned answer stands in for the read-only fork that answers in a live session.
		ask: async (body) => {
			if (!parseQuestion(body, page)) return undefined;
			await new Promise((resolve) => setTimeout(resolve, 600));
			return "The loop stops for four reasons:\n\n1. No attempts are left.\n2. The status is not retryable.\n3. The request is not idempotent.\n4. The wait would overrun `budgetMs`.\n\n```ts\nif (Date.now() - started + delay > policy.budgetMs) throw new HttpError(response);\n```";
		},
	});
	writeFileSync(join(out, "url.txt"), session.url);
	const result = await session.result;
	session.close();
	writeFileSync(join(out, "result.txt"), formatReviewResult(page, result, "/tmp/saved.html"));
	writeFileSync(join(out, "saved.html"), embedPage(template, { ...page, session: { token: "", live: false, ask: false }, result }));
});
