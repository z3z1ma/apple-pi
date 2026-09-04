# Context and notebook

Compaction has one hook owner. On an xAI model using `openai-responses`, [`extensions/xai-context-compaction.ts`](../extensions/xai-context-compaction.ts) handles `/compact`, automatic compaction, and overflow recovery by calling xAI's `POST /responses/compact`. Other models leave `session_before_compact` unset so Pi's default summarizer runs.

Pi 0.84.4 checks context after tool results and normally compacts before the next assistant provider request in the same run. [`extensions/auto-compact.ts`](../extensions/auto-compact.ts) keeps that continuation fail-closed: a failed or cancelled automatic compaction aborts the active run, and a narrow compatibility gate stops Pi 0.84.4 before provider dispatch.

The extension retains one fallback for a native cut-point gap. When an over-budget tool-result batch reaches Pi's `keepRecentTokens` budget, Pi 0.84.4 can detect that compaction is due but produce no preparation or failure event because tool results are not valid cut points. The fallback appends an empty hidden custom-message cut point after the result, then Pi's native threshold compaction proceeds normally. A `context` hook filters the durable marker before provider serialization, including after session reload. No provider registration or synthetic assistant response is replaced. The extension is loaded in root sessions, ordinary subagents, the internal BTW child, and `pi_exec` workers. Pi's `compaction.enabled` setting controls compaction; the pair programmer notebook `passive` setting disables only fallback marker insertion and notebook maintenance.

After any compaction entry exists, the deterministic notebook ledger appends its current fold to the tail of the live conversation through the `context` event. That packet is the same for xAI compaction, Pi default summarization, and any compact-hook fallback that still writes a compaction entry.

## xAI server-side compaction

When the active model is `provider === "xai"` and `api === "openai-responses"`:

1. The hook converts the messages being summarized with pi-ai's Responses converter.
2. A previous xAI compaction item is prepended so successive compact calls chain.
3. Auth comes from `ctx.modelRegistry.getApiKeyAndHeaders(model)`. The endpoint is `{model.baseUrl || https://api.x.ai/v1}/responses/compact`.
4. A successful response stores `{ type: "compaction", id, encrypted_content }` in `details.xaiCompaction` and keeps a bounded whole-history text projection, including prior compacted context, as a usable fallback.
5. Later xAI Responses requests inject only that newest item after a leading system or developer prompt.
6. Auth failure, HTTP errors, or a missing compaction item return `undefined` so Pi's default summarizer runs.
7. Injection is disabled for the rest of the session only when a 4xx can be attributed to an isolated request where this extension injected the item. Pre-existing items and ambiguous concurrent requests do not disable replay.

Completions-routed Grok is left to Pi default compaction.

## Pair programmer notebook

The pair programming partner is the only persistent model actor. It follows the main session as a shared-screen navigator, keeps a second line of thought while the main agent works, and periodically maintains sourced observations and reflections about the pair's current shared understanding through its private `update_notebook` tool. The tool proposes a typed update; deterministic root code validates source IDs, supporting observation IDs, supersession, coverage advancement, and drop guardrails before appending the complete maintenance result as one atomic session entry. It has no repository or general transcript-search tools; `expand_receipt` can reveal only historical content folded behind a handle already present in its trajectory, including user images returned through Pi's normal tool-result image path.

Full maintenance becomes due when uncovered source tokens reach `notebookAfterTokens` (default 20,000). Explicit pivots can be recorded earlier during normal pair programmer review. Empty full-maintenance results use a bounded retry backoff. If the pair programmer is disabled or unavailable, note-taking pauses; existing observations, reflections, compaction packets, `search_session`, and `revisit_note` remain readable. No hidden notebook actor starts.

The ledger keeps source-addressed observations, reflections, retirement records, drop records, and coverage markers in Pi's append-only session JSONL. `registerNotebookContextPacket` projects the ledger to the latest compaction boundary and appends one idempotent `notebook.packet` custom message during each context rebuild. The `notebook.*` names are persistent session-record formats, not commands or model actors.

Commands and tools:

- `/pair status` — pair programmer state, notebook coverage, and pair programmer and consultant usage
- `/pair notebook [full]` — visible or complete notebook projection
- `search_session` — progressive search of this session's transcript and file-operation history; regex-like queries use a bounded safe subset and reject ambiguous grouped or repeated patterns
- `revisit_note` — exact source lookup by a known observation or reflection ID

The pair programmer's operational settings use the `pair` key in global `~/.pi/agent/settings.json` or trusted project `.pi/settings.json`; project values override global values. The pair programmer's model and thinking policy come from the user-global `pair` model profile. `PI_PAIR_NOTEBOOK_PASSIVE` can disable the exceptional overflow fallback and pair programmer notebook maintenance while preserving reads; it does not disable Pi's native compaction or automatic-compaction failure safety. See [Model profiles](model-profiles.md) and [`components/notebook/src/config.ts`](../components/notebook/src/config.ts).

The pair programmer binds `revisit_note` to the primary session and uses handle-bound `expand_receipt` for folded trajectory content. It does not receive `search_session`. The episodic consultant retains primary-bound `search_session`, `revisit_note`, and read-only repository tools for independent investigation. Ordinary subagents and `pi_exec` workers load `search_session` but do not keep a pair programmer notebook. The internal BTW child loads only vroom (fast mode), compaction safety/fallback, and the search root guard.

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
