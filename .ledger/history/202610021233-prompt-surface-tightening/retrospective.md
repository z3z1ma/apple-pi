Status: complete
Created: 2026-10-02
Updated: 2026-10-02

# Retrospective

## What Mattered

Measuring the real rendered prompt (Pi loader + `ExtensionRunner.emitBeforeAgentStart`) exposed issues no source reading showed: a sticky `forceSystemPrompt` from string-returning hooks, and children losing every tool rule because a custom preamble drops Pi's `tools`/`rules` sections.

## Learnings

- In Pi, `before_agent_start` returning `systemPrompt` forces an opaque prompt for the whole run; use `systemPromptOptions.sections`.
- `customPrompt` (SDK `systemPromptOverride`, or `DefaultResourceLoader` `systemPrompt`) suppresses tool snippets and guidelines; the pair session has the same property.
- Several skill descriptions are pinned by tests as upstream triggers; check before rewording.

## Improvements

Keep `tests/system-prompt-sections.test.ts` as the place to assert prompt structure end to end.
