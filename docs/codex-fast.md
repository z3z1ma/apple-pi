# Codex fast mode

`/fast` toggles OpenAI Codex priority service tier globally. When enabled, every `openai-codex` request receives:

```json
{ "service_tier": "priority" }
```

The setting is stored at `~/.pi/agent/codex-fast.json` (or the configured Pi agent directory) and persists across sessions and restarts. The extension is loaded explicitly in the root session, interactive subagents, and `pi_exec` agents.

The command runs immediately even while an agent is streaming. The root uses the new value immediately, and already-running subagents refresh the shared setting before each provider continuation. An HTTP request already in flight cannot be changed; the next request in the same agentic run uses the new mode.

When fast mode is active on an OpenAI Codex model, the input card shows `⚡` beside the thinking level. Fast mode has no effect on other providers.

Fast mode consumes Codex credits at a higher rate than standard mode.
