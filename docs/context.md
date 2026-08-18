# Context and memory

Normal `/compact`, automatic compaction, overflow recovery, and explicit `/pi-vcc` all pass through one `session_before_compact` owner:

1. VCC selects a conversational cut and builds a deterministic summary without a model call.
2. Observational memory folds ledger records up to the same cut and injects current law plus remaining working evidence.
3. The two summaries and their metadata are returned as one compaction result.

The metadata is intentionally flat: `details.compactor === "pi-vcc"` and `details.type === "om.folded"` coexist so both recall systems recognize the same compaction.

A single curator pass starts after a root-session `turn_end`, not at `agent_start`, so it does not share the provider with the opening completion of a user turn. It launches when uncovered source tokens reach `observeAfterTokens` (default 20,000), then observes, reflects, retires, and drops in one model call. `reflectAfterTokens` remains in settings as unused compatibility and does not launch work. The observation-pool target is an inner drop budget, not a second clock. A new `agent_start` aborts an in-flight memory run. Auto-compaction still uses `agent_settled` and skips when VCC has already requested compact.

Commands and tools:

- `/pi-vcc` — explicit deterministic compaction
- `/pi-vcc-recall` — interactive history and file-operation search
- `session_search` — model-facing search of this session's compacted transcript and file operations:
  - `mode:"touched"` groups write/edit operations by path and entry index.
  - `mode:"file"` searches only write/edit payloads.
  - `query:"#N:path"` recovers a file payload; append `:offset:limit` to page or `:full` for up to 50 KB.
  - `expand:[N]` returns a complete transcript entry.
- `/om:status` and `/om:view` — observational-memory state
- `memory_source` — exact source lookup by observation or reflection ID

VCC settings remain at `~/.pi/agent/pi-vcc-config.json`. Observational-memory operational settings use the `observational-memory` key in global `~/.pi/agent/settings.json` or project `.pi/settings.json`; project values override global values. Its model and thinking level use the `observational-memory` entry in `modes.json` instead, following the same trusted-project then global lookup as other named modes. See [`components/memory/src/config.ts`](../components/memory/src/config.ts) for the validated operational keys and defaults.

## When compaction fires

VCC requests compaction when provider-reported context usage exceeds a fraction of the **active model's configured `contextWindow`**. The default is 68% (`compactPercent: 68`) whenever `pi-vcc-config.json` omits both `globalThreshold` and `defaultThreshold`. That default is applied at load time and is not written into the file.

The configured window is the cost lever. Pi already uses `models.json` / `modelOverrides.contextWindow` to keep requests inside a provider's short-context pricing tier; this package reads that same window and does not encode provider names or price tiers in TypeScript. Lowering a model's `contextWindow` to the tier boundary lowers the billed context at which compaction fires.

Override the waterline in `~/.pi/agent/pi-vcc-config.json`:

```json
{
  "overrideDefaultCompaction": true,
  "globalThreshold": { "compactPercent": 60 }
}
```

`reserveTokens` and `compactAtTokens` on `globalThreshold` or `modelThresholds` take precedence over `compactPercent` when set. An empty `"globalThreshold": {}` opts out of the package default. Observational memory then keeps its estimated-source-token gate (`compactAfterTokens`, default 81,000) as a fallback for turns where VCC cannot read usage or cannot resolve a window.

## Where memory persists

Observations, reflections, drop records, and reflection retirements are custom entries in Pi's append-only session JSONL. With Pi's default session directory, files are grouped by working directory under:

```text
~/.pi/agent/sessions/--<cwd>--/*.jsonl
```

Thus memory is durable and project-associated through Pi's session location, but it is **not project-local repository state** and is not shared through Git.

apple-pi intentionally does not create a `.pi/memory` mirror. A mirror would introduce a second source of truth, merge semantics, generated repository noise, and a privacy decision without improving current runtime behavior. If cross-session or team-shared memory becomes a concrete requirement, it should be designed as an explicit store and migration rather than an automatic copy.

## Sidecar usage records

Advisor reviews and observational-memory curator (and any remaining isolated stage) runs write one NDJSON line per model call to:

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
