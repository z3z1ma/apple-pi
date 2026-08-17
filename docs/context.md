# Context and memory

Normal `/compact`, automatic compaction, overflow recovery, and explicit `/pi-vcc` all pass through one `session_before_compact` owner:

1. VCC selects a conversational cut and builds a deterministic summary without a model call.
2. Observational memory folds ledger records up to the same cut and injects current law plus remaining working evidence.
3. The two summaries and their metadata are returned as one compaction result.

The metadata is intentionally flat: `details.compactor === "pi-vcc"` and `details.type === "om.folded"` coexist so both recall systems recognize the same compaction.

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

## Where memory persists

Observations, reflections, drop records, and reflection retirements are custom entries in Pi's append-only session JSONL. With Pi's default session directory, files are grouped by working directory under:

```text
~/.pi/agent/sessions/--<cwd>--/*.jsonl
```

Thus memory is durable and project-associated through Pi's session location, but it is **not project-local repository state** and is not shared through Git.

apple-pi intentionally does not create a `.pi/memory` mirror. A mirror would introduce a second source of truth, merge semantics, generated repository noise, and a privacy decision without improving current runtime behavior. If cross-session or team-shared memory becomes a concrete requirement, it should be designed as an explicit store and migration rather than an automatic copy.
