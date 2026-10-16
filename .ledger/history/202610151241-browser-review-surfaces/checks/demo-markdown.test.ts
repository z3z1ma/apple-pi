// LOCAL CHECK, not part of the suite: serves a demo Markdown review, waits for a browser to submit, and writes
// the model-facing result. Run: DEMO_OUT=/tmp/bpm npx vitest run <this file>
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { it } from "vitest";

import { buildMarkdownPage, formatMarkdownResult, markdownTemplate, parseMarkdownQuestion, parseMarkdownResult } from "../src/markdown-review.js";
import { openPageSession } from "../src/page-server.js";
import { embedPage } from "../src/saved-page.js";

const out = process.env.DEMO_OUT ?? "/tmp/bpm";
const SOURCE = `# Retry transient HTTP failures

The billing sync fails a few times a day when the upstream API sheds load. This spec adds retries to \`HttpClient\` for responses that are safe and useful to retry, without hiding real errors.

## Goals

- Recover from 429, 502, 503 and 504 without the caller noticing.
- Follow \`Retry-After\` when the server sends it.
- Never repeat a request that is unsafe to repeat.

## Non-goals

Circuit breaking, request hedging, and retries for streaming bodies are out of scope. They need their own design.

## Behaviour

\`\`\`mermaid
flowchart LR
  A[Send request] --> B{Response ok?}
  B -- yes --> Z[Return response]
  B -- no --> C{Retryable and idempotent?}
  C -- no --> E[Throw HttpError]
  C -- yes --> D{Budget left?}
  D -- no --> E
  D -- yes --> W[Wait with jitter] --> A
\`\`\`

### Which responses

Retry 408, 429, 502, 503 and 504. Never retry 500: it usually means a bug on their side, and retrying would hide it from our alerts.

### Waiting

Wait with **full jitter**: a random delay between zero and a ceiling that doubles with each attempt, starting at 250 ms and capped at 8 s. A \`Retry-After\` header wins over the computed delay.

### Budget

Stop after 4 attempts or 30 seconds in total, whichever comes first. The budget includes the waits, so a fully retried request stays inside the job runner's 60-second step timeout.

## Idempotency

\`GET\`, \`HEAD\`, \`OPTIONS\`, \`PUT\` and \`DELETE\` are retried. A \`POST\` or \`PATCH\` is retried only when the caller sends an \`Idempotency-Key\`, because the server then promises to deduplicate it.

> [!WARNING]
> The payments client already sends \`POST /charges\` with an \`Idempotency-Key\`. Charges will start to retry.

## API

\`\`\`ts
export interface ClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  // Tune the policy, or pass false to turn retries off.
  retry?: Partial<RetryPolicy> | false;
}
\`\`\`

## Rollout

| Step | Owner | Gate |
| --- | --- | --- |
| Ship with retries off by default | Billing | Tests green |
| Turn on for the billing sync | Billing | Error rate flat for two days |
| Turn on for everyone | Platform | No duplicate charges in the ledger |

## Tasks

- [x] Retry policy module
- [x] Abortable \`sleep\`
- [ ] Idempotency rule in \`request()\`
- [ ] Runbook entry ([billing runbook](https://example.com/runbook))

## Risks

A retried \`POST\` without real deduplication creates duplicates. Long budgets can hold a worker for 30 seconds.

## Hostile input

This section must render as text: <script>window.pwned = 1</script> and <img src=x onerror="window.pwned = 2">.

A [bad link](javascript:window.pwned=3), an ![image](javascript:x), and a [good link](https://example.com).

## Appendix 1

Filler paragraph 1 keeps the document long enough to test jumps between sections and scroll-spy in the outline.
## Appendix 2

Filler paragraph 2 keeps the document long enough to test jumps between sections and scroll-spy in the outline.
## Appendix 3

Filler paragraph 3 keeps the document long enough to test jumps between sections and scroll-spy in the outline.
## Appendix 4

Filler paragraph 4 keeps the document long enough to test jumps between sections and scroll-spy in the outline.
## Appendix 5

Filler paragraph 5 keeps the document long enough to test jumps between sections and scroll-spy in the outline.
## Appendix 6

Filler paragraph 6 keeps the document long enough to test jumps between sections and scroll-spy in the outline.
## Appendix 7

Filler paragraph 7 keeps the document long enough to test jumps between sections and scroll-spy in the outline.
## Appendix 8

Filler paragraph 8 keeps the document long enough to test jumps between sections and scroll-spy in the outline.
`;

it("serves a demo Markdown review and records the submission", { timeout: 600_000 }, async () => {
	const dir = mkdtempSync(join(tmpdir(), "bpm-demo-"));
	writeFileSync(join(dir, "retry-spec.md"), SOURCE);
	mkdirSync(out, { recursive: true });
	const { page } = await buildMarkdownPage(
		{ path: "retry-spec.md", note: "I added the Idempotency section since your last pass; the rest is unchanged." },
		dir,
		"demo-token",
	);
	page.session.ask = true;
	const template = await markdownTemplate(page);
	const session = await openPageSession(embedPage(template, page), "demo-token", (body) => parseMarkdownResult(body, page), {
		ask: async (body) => {
			if (!parseMarkdownQuestion(body, page)) return undefined;
			await new Promise((resolve) => setTimeout(resolve, 600));
			return "Because the server **deduplicates** a request that carries an `Idempotency-Key`, so a retry cannot charge twice.";
		},
	});
	writeFileSync(join(out, "url.txt"), session.url);
	const result = await session.result;
	session.close();
	writeFileSync(join(out, "result.txt"), formatMarkdownResult(page, result, "/tmp/saved.html"));
	writeFileSync(join(out, "saved.html"), embedPage(template, { ...page, session: { token: "", live: false, ask: false }, result }));
});
