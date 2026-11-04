# The system prompt

apple-pi writes the whole system prompt itself. The composer in `components/system-prompt` runs as the last apple-pi extension, on every `before_agent_start`, and turns the sections that components contribute into one document.

## What the composer writes

The prompt is an operating frame: one story in which the agent's role and its environment are the same thing, so every tool has a place and composing them follows from the story.

- **The operating model** (`src/preamble.ts`) replaces Pi's preamble: who the agent is (a person in an organization on this machine), and how we know things here (seen, reported, told, believed). Every later part refers back to these four kinds of evidence. Interns get a short intern preamble instead; the intern runner passes `--intern`. `/btw` uses the same composer with its own side-conversation preamble and no docs pointer.
- **The place** (`src/toolbox.ts`, the `toolbox` section) replaces Pi's tool list, rules and docs. It describes the environment room by room (your bench, the record, help you can call, the people, the review board, the proving ground, the operator's door, the operator's desk), and every active tool appears in the room where it belongs. A room appears only when one of its tools is active, and a line that names an inactive tool is left out. The ledger and the wiki are taught here too, the wiki only in a project that has `.wiki/`.
- **How a goal moves** (`GOAL_FLOW`, root sessions only): the path from a goal to a finished, proven result, through the rooms. A tool no group knows, such as an MCP tool, is listed with its own snippet and guidelines.
- **Skills, project context and a pointer to Pi's docs**, which Pi would otherwise write in its own order.

Setting the preamble turns off Pi's own tool list, rules and docs. The composer never sends a whole replacement prompt (`forceSystemPrompt`), so a changed section still reaches the model as a delta and the cached prefix survives.

## Order

Sections run from most stable to most personal, so the longest prefix stays identical across sessions and turns: the operating model, `cwd` (Pi writes it), the toolbox and capability sections, skills, project context and project rules, then the person (`org`, `manager`, `role`, `specialization`, `self`). `SECTION_ORDER` in `src/index.ts` holds the order; an unknown section goes after the known ones. Two parts stay outside the composer: Pi's MCP extension adds `mcp_servers` last, and the Anthropic provider adds its identity line first.

## Writing it

Follow the model vendors' prompting guides ([OpenAI GPT-6](https://developers.openai.com/api/docs/guides/latest-model#gpt-6-astra-prompting-best-practices), [Claude Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5)) and [writing for agents](https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL.md):

- State the behavior you want, positively; keep a prohibition only for a hard guardrail.
- Put what every session needs in the prompt and what only some need in a skill, behind a pointer that names when to load it.
- Delete a sentence that changes nothing for the current models: a default behavior, a duplicate, a workaround for an older model.
- Newer models follow loaded instructions closely, so instructions in the prompt, `AGENTS.md` and skills must not conflict.

## Changing the prompt

- **How to use a tool**: change its toolbox group. Keep exact arguments in the tool's own description.
- **What the agent is and how it works**: change the operating model.
- **Facts about the person, the project or the session**: change the component that owns them; it contributes a section with `setSystemPromptSection`. A section holds facts and norms, not tool instructions the toolbox already gives.
- **A new section**: add its name to `SECTION_ORDER` where its stability belongs.

Then check:

- `components/system-prompt/tests/system-prompt.test.ts` runs a real root session and checks that every active tool is taught and no taught tool is absent, and the order.
- `tests/prompt-budgets.test.ts` measures each context's prompt. Lower its ceiling to the new measured size when the prompt shrinks.
- `npm run audit:cache` checks prefix caching in real session logs.
- To see the exact prompt a real request carries, run `capture.mjs` and `render.mjs` in `.ledger/202611032038-custom-system-prompt/current-prompt/`. The capture never sends the request.
