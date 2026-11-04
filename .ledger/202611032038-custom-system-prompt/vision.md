# Owning the system prompt

**Goal:** apple-pi writes the whole prompt a session receives as one deliberate document: its words, its order, and which tools are declared. Pi keeps doing what it does well: recording the prompt as sections, appending changes so the cache survives, and loading deferred tools on demand.

**Evidence:** everything below was checked against apple-pi's source, Pi 1.4.0's source (`pi-coding-agent/dist/core/system-prompt.js`, `agent-session.js`, `extensions/tool-search/tool.js`, `pi-ai/dist/utils/transcript.js`), the captured prompt in [current-prompt/](current-prompt/README.md), and 14 days of tool calls across all of the operator's session transcripts.

## 1. What Pi gives us

| Lever | What it does | Evidence |
|---|---|---|
| `systemPromptOptions` in `before_agent_start` | Every handler can edit, in place, the inputs Pi builds the prompt from: `customPrompt`, `sections`, `selectedTools`, `toolSnippets`, `toolGuidelines`, `promptGuidelines`, `skills`, `contextFiles`. | `normalizeBuildSystemPromptOptions`; `_prepareRun` builds the prompt from the edited object. |
| `customPrompt` | Replaces Pi's preamble and drops Pi's `tools`, `rules` and `docs` sections. `project_context`, `skills`, `cwd` and every extension section stay. | `buildSystemPromptSections`. |
| A section with a Pi name | Extension sections are applied after Pi's, so a section named `skills`, `project_context` or `cwd` replaces Pi's own. Only `preamble` is reserved. | Same function: `promptSections[name] = content` after the base sections. |
| Section deltas | The prompt lives in the transcript as a system message with named sections. When a section changes, Pi appends only the change. Both of the operator's models accept system messages mid-conversation (`supportsMidConvoSystemMessages` is true for `claude-opus-5-5` and `gpt-6.1-sol`), so the request's head stays byte-identical and cached. | `diffSystemPromptSections`, `renderSystemMessageUpdate`, `resolveTranscript`; `pi-ai` model data. |
| `forceSystemPrompt` | Sends one opaque text instead. The head then changes whenever anything changes, which defeats the cache; `tests/system-prompt-sections.test.ts` already asserts apple-pi never does this. | `_installAgentForcedPromptProjection`. |
| Tool `exposure` | `direct` tools are declared up front. `deferred` tools are not declared; Pi's `tool_search` finds them by BM25 over their metadata and declares the matches for the next call. This works for extension tools as well as MCP tools. `prepareLoadout` can change exposure per session. | `ToolExposure` in `extensions/types.d.ts`; `isSearchable` in `tool-search/tool.js`. |

**Conclusion:** owning the prompt needs no fork of Pi and no opaque prompt. One apple-pi component sets `customPrompt` and writes every section itself; Pi's section machinery keeps caching and deltas working.

**Two parts stay outside our control, by design:**
- **The Anthropic identity line** ("You are Claude Code…") is added by `pi-ai`'s Anthropic provider for OAuth requests. It is 14 tokens and must stay.
- **Each repository's `AGENTS.md`** belongs to that repository. We decide where it sits and how it is introduced, not what it says.

## 2. What the prompt costs today

From the capture (a fresh unroled root in this repository; the operator's pair programmer is switched off):

| Part | ~Tokens | Note |
|---|---:|---|
| Pi base (`preamble`, `tools`, `rules`, `docs`, `cwd`) | 5,900 | `tools` repeats the name and one-liner of tools whose full definitions are sent anyway. `rules` has 77 bullets from 30-odd tools in registration order. |
| `project_context` (both `AGENTS.md`) | 12,600 | Repository-owned. |
| `skills` | 3,600 | 32 skills. |
| apple-pi sections | 13,800 | `project-learnings` is now about 860 (it was 7,400 at capture); `org` 2,190; `role-catalog` 1,370. |
| **Tool definitions** (87 tools) | **29,300** | The largest single cost, and the one the earlier analysis did not measure. |

**Tool use over 14 days (all sessions):**
- The top six tools take 85% of calls: `bash` 12,958, `edit` 1,416, `read` 1,169, `reply`/mail ≈1,935, `write` 383.
- 38 of the 87 tools were never called: about 11,200 tokens of definitions.
- 13 more were called one to four times: about 6,000 tokens.
- Some heavy ones are rare. `sign_off_code` is 1,872 tokens and was called twice; `economics` is 1,212 tokens and was called never.

**Caveats:**
- Some tools are new (`tlc_check`, `tla_symbolic_check`) or used only by one role (the coordinator's desk tools).
- A tool that is never called may be unused because it is buried. Usage shows where cost goes, not what is worthless.

## 3. The earlier analysis, checked

The analyst's twenty loops, each read against the code:

| # | Claim | Verdict | What it means for the design |
|---|---|---|---|
| 1 | Open notebook learnings hold `ledger_status done`, and the prompt never says so. | **True.** `open-learnings.ts` blocks the call with a reminder. | Say it in the memory map, once. |
| 2 | `pi_exec` reads neither inject `.context` files nor satisfy the edit gate, and cut at 50 KB. | **True.** It is in apple-pi's `AGENTS.md` and `LEARNINGS.md`, which other repositories never see. | Part of the operating model. |
| 3 | `expect`, surprise and `update_notebook` are one loop, taught apart. | **True.** | Teach it as one loop. |
| 4 | Interns read `.wiki`, `.ledger`, `.context` and use `search_session`; their descriptions do not say so. | **True** (`runner.ts`). | One line in the delegation map. |
| 5 | Saved `.pi/programs` become `program_<name>` tools. | **True.** It is taught, but as rule 31 of 77. | Group it with `pi_exec`. |
| 6 | `tlc_check` reports actions that never stepped, the formal twin of a test that cannot fail. | **True.** | One "no vacuous proof" principle in the evidence section. |
| 7 | `search_branches` judges can score anything numeric. | **True.** Never called in 14 days, likely because nothing teaches when to reach for it. | Teach it in the evidence section. |
| 8 | The pair programmer is never introduced outside apple-pi. | **Wrong.** `<pair-protocol>` introduces it whenever the pair is on; on this machine it is off (`.pair-state.json`). **Real defect found instead:** `acknowledge_pair_findings` and its rule ship while the pair is off. | Project the pair tool and its text only while the pair is on. |
| 9 | `channel_charter`, `follow_external` and `schedule_mail` have no guidance. | **True for `<rules>` and `<org>`.** The coordinator's role charter teaches part of it. | Teach them where the person's posture uses them. |
| 10 | `focus`, `finish_task` and `promote_task` are missing from `<tools>`. | **True but by design.** They have no `promptSnippet` and are taught in `<org>`. Pi lists a tool only if it has a snippet. | An owned prompt groups tools by job, so the split between "listed" and "taught elsewhere" goes away. |
| 11 | Manager tools are missing from `<tools>`. | **True and deliberate** (operator's correction). They are activated only for managing roles and unroled roots (`managesPeople`), and taught in `<org>`. | Keep the gating, and make it visible as a projection table (section 5). |
| 12 | Nothing says when to use `pi_exec` `agent(role)` and when to `hire`. | **True.** | One distinction in the delegation map. |
| 13 | `sign_off_code`/`explain_change` accept `review` to bridge machine review into human sign-off. | **True.** | One line in the review workflow. |
| 14 | Browser-page guidelines are about 21 bullets that repeat `cwd`, `target`, `note` and "apply the annotations". | **True** (seen in this session's own prompt). | One shared contract plus one line per tool; detail stays in the tool schemas and the existing skills. |
| 15 | Desk, notes and canvas tools have no guidance. | **True.** They are gated to managers and the scout (`mayUseActivity`), so every unroled operator session gets them, unexplained. | Unroled roots keep them (decision 3); the toolbox teaches them. |
| 16 | `experience`/`bottlenecks` are underused before staffing. | **True** (0 and 0 calls; `hire` 22). | One line in the staffing story. |
| 17 | Reflection runs automatically and the agent is not told. | **True.** | One line in the operating model. |
| 18 | `.context`, `.wiki` and `notes` form one knowledge graph, taught in three places. | **True.** | One memory map. |
| 19 | Seven engineering skills are missing from `package.json`. | **Wrong.** All seven set `disable-model-invocation: true`; they are explicit-entry skills, which the loader test lists. | No change. |
| 20 | The harness's mental model lives only in apple-pi's `AGENTS.md`, so it vanishes in other repositories. | **True, and the heart of the problem.** | The operating model moves into the runtime prompt. |

The analysis also missed three things:
- **Tool definitions cost more than the whole apple-pi section set.** The `<tools>` section restates what the definitions already send.
- **Caching already works per section**, so cohesion need not cost cache hits, provided stable text comes first.
- **The `org` section is long because it is legalistic, not because of SQLite detail:** access versus following versus attention, catch-up cursors, attempt handles. Most of it is true and needed; it is written as a specification rather than as instructions.

## 4. The design

### One composer, one document

A new component, `components/system-prompt/`, installs one `before_agent_start` handler that runs after every other extension. It:

1. **Sets `customPrompt`** to apple-pi's own preamble: who the agent is and how this harness works. Pi's generic preamble, `tools`, `rules` and `docs` go away.
2. **Writes every section itself, in a fixed order**, from one authored document plus live data:
   - Authored text lives in `components/system-prompt/src/prompt/*.md` (or one module), reviewed as prose.
   - Live data comes from the components that own it: role, manager and organization from `organization`; the learnings file; the self; whether `.wiki` or `.pi/rules` exist; the pair's on/off state; active tools; skills; context files.
3. **Removes the sections other extensions added**, folding their data into its own document. Their `setSystemPromptSection` calls become data providers: exported functions that return facts, not prose.

**Section order follows stability**, so the longest possible prefix is identical across sessions and repositories:
1. Preamble and operating model (the same for every root session).
2. Toolbox (the same for every session with the same posture).
3. Skills.
4. Project: `cwd`, `AGENTS.md`, learnings, repo rules, wiki (the same within one repository).
5. Person: `org`, `role`, `self` (changes per person and over time; changes append as deltas).

### The document's parts

- **`preamble`:** the identity and operating model. Everything the earlier loops found trapped in apple-pi's `AGENTS.md`, written once for every repository:
  - **Execution tiers:** direct, interns, `pi_exec`, colleagues, with the `agent(role)` versus `hire` distinction and what interns can read.
  - **The memory map:** `.context` and its gate (including the `pi_exec` boundary), `.wiki`, the ledger, the notebook as a staging queue with the close hold, `notes`, and `search_session`.
  - **The evidence standard:** `expect` → surprise → notebook; verified versus believed; no vacuous proof, whether a test that cannot fail or a model action that never steps.
  - **The background helpers:** passive reflection and, when on, the pair.
- **`toolbox`:** replaces Pi's `tools` and `rules`. Tools are grouped by the job they serve (files and shell, delegation, memory, organization, review, formal checking, browser pages, scheduling), with routing guidance written once per group. It is built from the active tool set, so a tool that is not active (a manager tool for a non-manager, the pair tool when the pair is off) is not mentioned. A tool from outside apple-pi (MCP, another package) still appears, rendered from its own snippet and guidelines.
- **`skills`:** re-rendered more compactly from `options.skills`.
- **`project`:** `cwd`, `AGENTS.md` files, `.pi/LEARNINGS.md`, repo rules, wiki: the current sections, introduced as one block.
- **`person`:** `org`, `role`, `manager`, `specialization`, `self` and, for people who manage, the role catalog grouped by posture. `org` is rewritten as instructions.

### Tool surface

The tool definitions get the same ownership:

- **Exposure by posture.** Every tool the session's posture can use stays declared (core work tools for everyone; staffing, inspection and the desk for people who manage, including unroled roots). Low usage is not a reason to hide a tool: today's usage reflects today's prompt (operator's note). Tokens come down through cohesion and concise definitions instead, and usage is measured again after the new prompt ships.
- **Short descriptions, detail on demand.** A long tool description (`sign_off_code` 1,872 tokens, `explain_change` 1,017, `read_review` 902) shrinks to what the call needs. The procedure moves to the skill the toolbox points at (`operator-sign-off`, `explain-change`, `code-review`), which ship to every repository and already hold most of it.
- **One mechanism.** Exposure is decided in one place, the composer's projection table, through `prepareLoadout`, not scattered across components.

### Contexts

Interns, `/btw` and the pair sidecar each have their own small prompt today. They become rows of the same projection table and get their variant of the document in the same pass (decision 4).

## 5. The projection, made visible

One table in the composer decides, for each context and posture, which sections and which tools are declared. Today this logic is spread across `organization/install.ts`, `coordinator.ts`, `work-tools.ts`, `activity-tools.ts`, `pi-exec/index.ts`, `ask-user-question` and `pair-programmer`. The components keep their authorization checks at call time; the table decides only what the model is told and shown.

| Dimension | Values |
|---|---|
| Context | root, intern, `/btw`, pair sidecar, program peer |
| Posture | unroled root, managing role, writing role, advising role, coordinator, scout |
| Environment | UI or none, pair on or off, `.pi/rules` present, `.wiki` present, RTK on, MCP servers connected |

A test renders the prompt for each combination that exists and checks two things: the tool set and the prompt agree (no active tool unmentioned, no mention of an absent tool), and the total stays within the prompt-budgets ratchet.

## 6. Build order

Each step lands on main with focused tests, and the capture in `current-prompt/` is re-run after each one to show the real result.

1. **Composer skeleton.** The component takes over the section order and writes the current text unchanged, except that order is grouped by stability. Proof: the re-captured prompt differs only in order. This makes every later step a content change in one place.
2. **Preamble and toolbox.** Write the operating model; replace Pi's `tools`/`rules` with the grouped toolbox; drop the repeated browser-page and TLA+ guidance in favor of one line each plus their skills. Gate the pair tool on the pair being on.
3. **Person.** Rewrite `org` as instructions, group the role catalog by posture, add the missing staffing, desk and channel lines where each posture uses them.
4. **Tool surface.** Projection table and shorter descriptions with detail in skills.

Interns, `/btw`, the pair sidecar and program peers are rows of the same projection table from step 1, so the work is one pass over every context (decision 4).

**Measured after each step:**
- the re-captured prompt and tool tokens;
- `npm run audit:cache` on real sessions, for prefix caching;
- `tests/prompt-budgets.test.ts`, whose budget ratchets down to the new measured value.

There is no evaluation gate. The operator validates through use.

## 7. Decisions (operator, 2026-11-04)

1. **Authoring model: one authored document** with live data; components stop writing prose and provide facts.
2. **No deferral by usage.** Tools unused today are unused because the prompt does not teach them. Every tool the posture allows stays declared; the goal is maximum cohesion and minimum tokens for salience, reached through the document and concise definitions. Usage is measured again after the new prompt ships.
3. **Unroled roots keep the full manager posture.** An unroled session is a generalist that edits code and also disperses work to a team, so it keeps staffing, inspection and the desk tools. The coordinator is the role that manages an organization more exclusively. The toolbox teaches each desk tool in a line, so none is unexplained.
4. **One pass over every context**, through the projection table, since that is simpler than two implementations.
5. **The projection is a test matrix, not a central table** (2026-11-04). Each component keeps its own activation gate; one real-session test across unroled root, hired worker, coordinator, scout, pair on and off, interns and `/btw` checks that the toolbox teaches exactly the active tools.
6. **The pair sidecar keeps its own prompt** (2026-11-04). It is already one authored, user-overridable document that teaches its own tools; composing it would only duplicate that text.
