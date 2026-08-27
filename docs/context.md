# Context and memory

Compaction has one hook owner. On an xAI model using `openai-responses`, [`extensions/xai-context-compaction.ts`](../extensions/xai-context-compaction.ts) handles `/compact`, automatic compaction, and overflow recovery by calling xAI's `POST /responses/compact`. Other models leave `session_before_compact` unset so Pi's default summarizer runs.

[`extensions/auto-compact.ts`](../extensions/auto-compact.ts) prevents an oversized post-tool continuation from reaching the provider. When context usage reaches Pi's model-specific native `context window - reserve` boundary, it arms the active provider stream. The next request containing that tool batch receives a local synthetic context-overflow response instead of an upstream call. The response remains a benign completion at the event and UI boundary, while a process-local adapter classifies it as overflow only during Pi's recovery check. Pi then uses its native overflow path to compact and retry the same agent run without adding a user message or rendering a synthetic assistant error. The guard is loaded in root sessions, ordinary subagents, the internal BTW child, and `pi_exec` workers; it follows Pi's effective `compaction.enabled` setting and the observational-memory `passive` setting. Once over threshold, failure to install the provider wrapper aborts the run rather than allowing an unguarded oversized request.

After any compaction entry exists, observational memory appends its current fold to the **tail** of the live conversation via the `context` event. That packet is the same for xAI compaction, Pi default summarization, and any compact-hook fallback that still writes a compaction entry.

The curator pipeline, `/om:*` commands, and `memory_source` register only on the **root** session. Ordinary subagents and `pi_exec` workers load `session_search` without starting observer/reflector/curator work; the internal BTW child loads only Codex fast mode and the overflow guard. The Sentinel session also does not run observational memory: after its own compaction summary it inserts a **read-only** copy of the parent fold, and its `memory_source` / `session_search` tools stay bound to the primary session. Episodic Advisor consultations use the same primary-bound recall tools without starting another curator.

## xAI server-side compaction

When the active model is `provider === "xai"` and `api === "openai-responses"`:

1. The hook converts the messages being summarized with pi-ai's Responses converter (tool calls, results, reasoning, and images stay in the request).
2. If a previous xAI compaction item is stored on the latest compaction entry, that item is prepended so successive compact calls chain.
3. Auth comes from `ctx.modelRegistry.getApiKeyAndHeaders(model)`. Existing headers are spread; `Authorization: Bearer` is added only when an API key exists. The endpoint is `{model.baseUrl || https://api.x.ai/v1}/responses/compact`.
4. A successful response stores `{ type: "compaction", id, encrypted_content }` in `details.xaiCompaction` and keeps a real text summary (recent serialized tail) so a later 4xx can drop the opaque item without leaving an empty history.
5. Later xAI Responses requests inject only that newest item after a leading system/developer prompt.
6. Auth failure, HTTP errors, or a missing compaction item return `undefined` so Pi's default summarizer runs.
7. `after_provider_response` is `{ status, headers }` only. If a request that carried an injected item gets a 4xx, injection is disabled for the rest of the session and a warning is shown. That failing turn itself still errors; 400s are not retried.

Completions-routed Grok is left to Pi default compaction.

## Observational memory packet

`registerMemoryContextPacket` runs on every context rebuild after a compaction entry exists. It projects the ledger to the latest compaction's `firstKeptEntryId` and appends one custom message (`om.memory.packet`) at the end of `event.messages`. The injection is idempotent for that rebuild. The ledger itself stays in Pi session JSONL.

A single curator pass starts after a root-session `turn_end`, not at `agent_start`, so it does not share the provider with the opening completion of a user turn. It launches when uncovered source tokens reach `observeAfterTokens` (default 20,000), then observes, reflects, retires, and drops in one model call. `reflectAfterTokens` remains in settings as unused compatibility and does not launch work. The observation-pool target is an inner drop budget, not a second clock. A new `agent_start` aborts an in-flight memory run. The provider guard is the primary same-turn trigger after tool results. Observational memory retains a source-token fallback on `agent_settled` for contexts where provider usage was unavailable, and skips when the live branch already ends at a compaction entry.

Commands and tools:

- `session_search` — model-facing search of this session's compacted transcript and file operations:
  - `mode:"touched"` groups write/edit operations by path and entry index.
  - `mode:"file"` searches only write/edit payloads.
  - `query:"#N:path"` recovers a file payload; append `:offset:limit` to page or `:full` for up to 50 KB.
  - `expand:[N]` returns a complete transcript entry.
- `/om:status` and `/om:view` — observational-memory state
- `memory_source` — exact source lookup by observation or reflection ID

Observational-memory operational settings use the `observational-memory` key in global `~/.pi/agent/settings.json` or project `.pi/settings.json`; project values override global values. Its model and thinking level come from the user-global `background` model profile. Missing, invalid, unavailable, or unauthenticated profile selection skips consolidation with an observable failure; it never substitutes the session model. See [Model profiles](model-profiles.md) for inference policy and [`components/memory/src/config.ts`](../components/memory/src/config.ts) for the validated operational keys and defaults.

## Where memory persists

Observations, reflections, drop records, and reflection retirements are custom entries in Pi's append-only session JSONL. With Pi's default session directory, files are grouped by working directory under:

```text
~/.pi/agent/sessions/--<cwd>--/*.jsonl
```

Thus memory is durable and project-associated through Pi's session location, but it is **not project-local repository state** and is not shared through Git.

apple-pi intentionally does not create a `.pi/memory` mirror. A mirror would introduce a second source of truth, merge semantics, generated repository noise, and a privacy decision without improving current runtime behavior. If cross-session or team-shared memory becomes a concrete requirement, it should be designed as an explicit store and migration rather than an automatic copy.

## Sidecar usage records

Sentinel reviews, Advisor consultations, and observational-memory curator (and any remaining isolated stage) runs write one NDJSON line per model call to:

```text
~/.pi/agent/sidecar-usage/<session-id>.ndjson
```

Calls without a usable session id go to `sidecar-usage/unscoped.ndjson`. Records are identifiers and counters only: provider, model, input, cacheRead, cacheWrite, output, cost, duration, trigger, and status. They are not session-JSONL custom entries, so they do not affect compaction or memory projection.

To extend the baseline spend table with sidecars, aggregate those files the same way session JSONL assistant messages are aggregated:

```python
from collections import defaultdict
from pathlib import Path
import json

rows = defaultdict(lambda: {"calls": 0, "input": 0, "cacheRead": 0, "output": 0, "cost": 0.0})
for path in Path.home().joinpath(".pi/agent/sidecar-usage").glob("*.ndjson"):
    for line in path.read_text().splitlines():
        rec = json.loads(line)
        key = f"{rec.get('provider', '')}/{rec.get('model', '')}"
        row = rows[key]
        row["calls"] += 1
        row["input"] += rec.get("input", 0)
        row["cacheRead"] += rec.get("cacheRead", 0)
        row["output"] += rec.get("output", 0)
        row["cost"] += rec.get("cost", 0)
```

A write failure is ignored. Instrumentation never changes review or consolidation results.
