# Vroom (fast mode)

`/fast` toggles priority service tier globally for OpenAI and xAI. When enabled,
every `openai`, `openai-codex`, or `xai` request receives:

```json
{ "service_tier": "priority" }
```

The setting is stored at `~/.pi/agent/vroom.json` (or the configured Pi agent directory) and
persists across sessions and restarts. On first load after upgrading from the earlier
Codex-only extension, it falls back once to the legacy `codex-fast.json` so an existing
toggle is not silently reset. Every top-level session loads the extension,
including each peer and the temporary peers that `pi_exec` starts. [Interns](interns.md) and
the [`/btw`](btw.md) session load it explicitly.

The command runs immediately even while an agent is streaming. The session that ran `/fast` uses
the new value immediately. Every other running session reads the shared setting again before
each provider request. An HTTP request already in flight cannot be changed; the next request in the
same agentic run uses the new mode.

When fast mode is active on an OpenAI or xAI model, the input card shows `⚡` beside
the thinking level. Fast mode has no effect on other providers.

Fast mode bills OpenAI tokens, consumes Codex credits, or bills xAI tokens at a higher rate
than standard mode.
xAI's Grok 4.6 priority rate is 2x standard input/cached-input/output pricing; see
[docs/research/xai-grok-4.6-priority-processing.md](research/xai-grok-4.6-priority-processing.md)
for sourced pricing detail.
