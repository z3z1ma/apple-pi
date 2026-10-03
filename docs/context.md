# Context and notebook

Compaction has one hook owner, [`extensions/server-compaction.ts`](../extensions/server-compaction.ts). It handles `/compact`, automatic compaction, and overflow recovery on the server of every provider that offers it: OpenAI with an API key, Codex sign-in, xAI, and Anthropic. Every other route, including Amazon Bedrock, returns no result from the hook, so Pi's default summarizer (`generateSummaryWithUsage`) asks the session model to summarize the conversation. Pi has no server-side compaction of its own, and its provider requests do not ask for provider-side context management. Verify provider behavior against the installed Pi version and the provider's documentation before you change this. [`docs/research/server-side-compaction.md`](research/server-side-compaction.md) records the provider APIs and the evidence on quality.

Pi checks context after tool results and compacts before the next assistant provider request in the same run, including when oversized trailing tool results require an older valid cut point. [`extensions/auto-compact.ts`](../extensions/auto-compact.ts) keeps that continuation fail-closed: a failed or cancelled automatic compaction aborts the active run before provider dispatch. It is loaded in root sessions, ordinary subagents, the internal BTW child, and `pi_exec` workers. Pi's `compaction.enabled` setting controls compaction.

Right after each compaction (`session_compact`), the notebook appends one packet of open learnings as a persisted custom message. It follows the compacted history directly, so it sits near the start of the new context, where the model is likely to notice and recall it. Nothing rewrites request context per turn: provider prompt caches match on an exact prefix, and a message that moves or changes between requests forces the whole history to be re-sent at cache-write prices. Ordinary compaction remains responsible for conversation history and task progress.

## Server-side compaction

| Provider and API | How it compacts | What the compaction entry keeps |
| --- | --- | --- |
| xAI, `openai-responses` | `POST {baseUrl}/responses/compact` with the converted messages | The opaque output items, and a bounded text projection of the compacted history as the readable summary |
| OpenAI API key (`openai`, `openai-responses`) and Codex sign-in (`openai-codex`, `openai-codex-responses`) | As Codex does: an ordinary Responses request through Pi's adapter with the session's instructions and tools and a `{"type": "compaction_trigger"}` item last. The server answers with one compaction item. Codex sign-in reaches `chatgpt.com/backend-api/codex/responses` through Pi's Codex adapter, which sets the account headers. | The opaque compaction item, and the same text projection |
| Anthropic, `anthropic-messages` | An ordinary Messages request through Pi's adapter with `"compaction": {"type": "summarize"}` and the `compact-2026-09-04` beta. The request carries the session's system prompt and active tools, as the API requires. | The signed `compaction` block; its readable text is the summary |

OpenAI, Codex, and Anthropic go through Pi's own adapters, so authentication, headers, and request shape match ordinary turns. The OpenAI subscription sign-in (`openai` provider with a ChatGPT login, recognized by a key without the `sk-` prefix) refused both `compaction_trigger` and `/responses/compact` on api.openai.com in October 2026, but accepted `context_management`. For that login the hook sends `context_management: [{ type: "compaction", compact_threshold: 1000 }]`, the documented minimum, keeps the newest compaction item, and discards the model's reply. A conversation shorter than the threshold produces no item, so Pi's summarizer runs. The refusal comes from that route's input-item allowlist, which also rejects `configuration_update` ([openai/codex#42996](https://github.com/openai/codex/issues/42996#issuecomment-5911395320)); compaction items are on the allowlist, so replay works, and `context_management` is a request field rather than an input item. OpenAI may add trigger support for subscription logins later: retest `compaction_trigger` with that login and drop the `context_management` branch when it is accepted. Anthropic's summarize request ends with stop reason `compaction`, which Pi's adapter reports as an error; the hook reads the block from the raw stream event instead.

The result is stored in `details.serverCompaction` with its `provider` and `api`. The compaction input starts with the previous result from the same provider, so successive compactions chain. When the previous compaction came from another provider or from Pi, its text summary leads the input instead.

On later requests to the same provider and API, the replay hook puts the stored result at the start of the context: Responses items after a leading system or developer prompt, and the Anthropic block as the first assistant message with the beta added. When the entry's text summary is only a copy of that result (`replacesSummary`), the summary message is left out, so the model reads the server result alone. Only the newest compaction entry counts; an older server result never outlives a later Pi summary. After a model switch to another provider, Pi's text summary is all that remains.

Failures, refusals, and responses without a result notify the user and return no result, so Pi's summarizer runs. A `/compact` focus instruction is ignored on the server path. Replay is disabled for the rest of the session only when a 4xx can be attributed to an isolated request where this extension injected the result. Results already in the payload and ambiguous concurrent requests do not disable replay.

The pair programmer's session keeps its own reseed summary and attaches the server result without `replacesSummary`, so both reach its model.

## Pair programmer notebook

The notebook holds **learnings** from this session: things found out the hard way and what to do differently now. Examples are a tool call or pattern that failed and what worked instead, a working way to reach an environment or service, a harness pitfall, and a user correction. Status, plans, and decisions belong to the ledger, docs, and git.

Learnings last for one session. Each ends placed in a durable owner (a wiki page, a task retrospective, `AGENTS.md`, a skill, a saved program in `.pi/programs/`, or a test or doc) after the user approves, or deliberately dropped. The main agent records learnings when surprised, proposes where they belong, and retires them once placed. The pair coaches: it records learnings the main agent missed, merges duplicates, and reminds the main agent to capture a surprise.

At run end, once 500,000 new tokens (input, cache write, and output) have passed since the last reflection, the main agent is asked to reflect: record what it learned, using the failed or surprising tool calls of that stretch as evidence, and propose a home for each open learning. A `bash` failure the agent predicted with [`expect: "failure"`](tasks.md#bash-extended) is left out; a success it predicted would fail is included. `/reflect` asks for the same reflection at any time and restarts the spacing. The spacing was chosen from the median run of about 144,000 new tokens and should be tuned from use.

The input card shows `learnings:N` while learnings are open, because they end with the session. When the main agent first moves a ledger task to `done` or `cancelled` while learnings are open, the call is held once with a reminder: propose a home for each (the task's `retrospective.md` by default), write what the user approves, retire the rest, then close again. `/distill` reads open learnings first and retires each one it places or the user rejects.

The tool adds learnings, supersedes existing learnings, or retires them immediately. New learnings cite primary source entry IDs. The main agent may omit those IDs to cite the current user turn; the pair supplies IDs from its sourced trajectory or recall. Both use the same validation and append path. Main changes commit immediately; pair changes commit only after a successful review, and a stale pair update is rejected if the shared learnings changed meanwhile.

Full pair maintenance becomes due at `notebookAfterTokens` (default 20,000 uncovered source tokens). The pair lists every open learning in `retainReflectionIds`; existing learnings not listed are retired, so it omits only duplicates it merged. This field is required for a full review. Targeted updates leave other learnings alone. Completed reviews advance coverage even when there is nothing to add. Reviews without new learnings use the existing bounded retry backoff. If the pair is disabled or unavailable, automatic maintenance pauses; the main agent can still curate the notebook.

Only open learnings enter the post-compaction packet, pair reseed, and maintenance prompt. New learnings link directly to source entries. Earlier observations and retired learnings remain retrievable through `revisit_note`, but are not live guidance. The append-only session archive can grow; active retention is an explicit model decision rather than a token quota or age-based eviction policy.

`registerNotebookCompactionPacket` appends the typed `notebook.packet` once after each compaction and skips it when the notebook is empty. Learnings recorded between compactions reach the main context at the next compaction; the pair receives them through its reseed summary. The `notebook.*` names are persistent session-record formats, not separate actors.

Commands and tools:

- `/pair status` — pair programmer state, notebook coverage, and pair programmer and consultant usage
- `/pair notebook [full]` — open learnings; `full` also shows archived evidence and retired learnings
- `/reflect` — ask the main agent to record what it learned and propose where each learning belongs
- `update_notebook` — jointly record, supersede, or retire sourced learnings
- `search_session` — progressive search of this session's transcript and file-operation history; regex-like queries use a bounded safe subset and reject ambiguous grouped or repeated patterns
- `revisit_note` — exact source lookup by a known observation or reflection ID

The pair programmer's operational settings use the `pair` key in global `~/.pi/agent/settings.json` or trusted project `.pi/settings.json`; project values override global values. The pair programmer's model and thinking policy come from the user-global `pair` model profile. `PI_PAIR_NOTEBOOK_PASSIVE` disables pair programmer notebook automatic maintenance while preserving reads and explicit main-agent updates; it does not disable Pi's native compaction or automatic-compaction failure safety. See [Model profiles](model-profiles.md) and [`components/notebook/src/config.ts`](../components/notebook/src/config.ts).

The pair programmer binds `revisit_note` to the primary session and uses handle-bound `expand_receipt` for folded trajectory content. It does not receive `search_session`. The episodic consultant retains primary-bound `search_session`, `revisit_note`, and read-only repository tools for independent investigation. Ordinary subagents and `pi_exec` workers load `search_session` but do not keep a pair programmer notebook. The internal BTW child loads only vroom (fast mode), compaction failure safety, and the search root guard.

## Where the notebook persists

Notebook records remain in Pi's append-only session JSONL, normally under:

```text
~/.pi/agent/sessions/--<cwd>--/*.jsonl
```

They are project-associated through Pi's session location, but they are not repository state and are not shared through Git. apple-pi intentionally does not create a `.pi/notebook` mirror because that would create a second source of truth and an implicit privacy policy.

## Pair programmer and consultant usage records

Pair programmer reviews and consultant consultations write one NDJSON line per model call to:

```text
~/.pi/agent/sidecar-usage/<session-id>.ndjson
```

Calls without a usable session ID go to `sidecar-usage/unscoped.ndjson`. Records contain identifiers and counters only: actor, provider, model, input, cache read/write, output, cost, duration, trigger, and status. They do not contain prompts or findings and do not affect compaction or notebook projection. A write failure is ignored so instrumentation cannot change pair programmer or consultant behavior.
