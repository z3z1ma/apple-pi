Status: in-progress
Created: 2026-10-02
Updated: 2026-10-02

# Tighten the system prompt surface across hooks, tools, children, and skills

## Intent

Act on the prompt-surface audit: make every model-visible instruction minimal, clear, and coherent, following the OpenAI GPT-6 Astra guidance (short skill triggers, contextual pointers, no over-strong boundaries, defined completion) and the Claude Opus 5.5 prompting guide.

Acceptance:
- No apple-pi `before_agent_start` hook returns `systemPrompt`; all add named sections (`tests/system-prompt-sections.test.ts`).
- Replace-mode children receive `<tools>`/`<rules>` for their own tools; append-mode children do not repeat inherited sections.
- Duplicated or contradictory rules removed; full `npm test`, lint, format, typecheck, pack check pass.

## Current State

Implemented and validated (`npm test` 1116 unit + 120 pair + loader, lint, format, typecheck, pack). Awaiting operator review.

Deferred: the pair session uses a custom preamble, so the `promptSnippet`/`promptGuidelines` on pair-only tools (`expand_receipt`, `set_pair_attention`, pair `revisit_note`/`search_session`) never render; the pair prompt already covers them.

## Outcome

- `components/shared/src/system-prompt-section.ts` — one shared section setter; pair, subagents, ledger, wiki, RTK use it.
- Wiki section only when `.wiki/` exists.
- Child prompts: Pi-style tool guidance sections; contradictory `<sub_agent_context>` tool list and advisory tool recipe removed; role prompts rewritten positively with a completion criterion.
- Rules: 26 → 20; hook sections 7.8K → 5.0K chars; pi_exec `code` text no longer lists captured tool names (stable under MCP changes).
- Profiles and teammate descriptions shortened; compact catalogs.
- `update_notebook` main schema drops pair-only `retainReflectionIds`.
- Skills: `ralph` operator-invoked; `domain-modeling`/`llm-wiki` triggers no longer overlap; `skill-authoring` description rule aligned with the guidance.
