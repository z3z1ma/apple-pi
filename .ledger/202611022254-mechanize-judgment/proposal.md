# What apple-pi takes from poteto's 4-day game

The source: one developer and agents shipped about 1,150 PRs in 4 days on a custom game. The point is not the game. Each
practice turns a judgment into a fast, deterministic check the agent hits immediately, so agents can move at that speed
without a human or a reviewer catching the same mistake twice.

apple-pi does the opposite in most places. It stores lessons as prose that every session must read and remember:

- `.pi/LEARNINGS.md` (79 dense lines),
- 397 `.context` files,
- `AGENTS.md` (301 lines),
- notebook learnings,

then pays agent reviewers to catch what the prose did not prevent. Prose costs tokens on every turn and is followed
probabilistically. A rule costs nothing until it fires and is followed every time.

## The concepts, one by one

| Thread practice | General harness idea | apple-pi today | Verdict |
|---|---|---|---|
| Every issue found becomes a lint rule | A lesson becomes a mechanical check, not prose | Lessons go to LEARNINGS, `.context` files and the notebook; reviewers re-find them | **Adopt: the core idea** |
| Context in file paths (`.hot.ts`) plus a lint rule scoped to that path | A file's execution context is declared in its name and enforced | Context is in prose sidecars, enforced by a read gate | **Adopt** for execution contexts |
| Build fails over a size budget (124 KB) | Hard budgets in the build for what silently grows | None; we measured DM and search latency by hand, after the fact | **Adopt** |
| 60 fps with 500 enemies on a mid-range phone | Explicit performance bars on named representative loads | Ad hoc; Kofi's latency gate was a one-off | **Adopt** as budget tests |
| TLA+ per major state machine, one skill each | Model-check the lifecycles where crashes and interleavings hide bugs | Bugs found late by reviewers: provisional hire, crash between snapshot and event, accepted-command replay | **Adopt, second wave** |
| Fully deterministic simulation; the server replays a run to verify it | Record and replay agent sessions; verify claims by re-running them | Kofi's replay harness reproduced tool outputs byte for byte; "tests pass" claims are taken on trust | **Adopt, second wave** |
| Headless bots tune difficulty to target survival rates | Agents run headlessly to tune prompts, tool descriptions and skills to target rates | Recall sets and skill-selection probes exist, run by hand | **Adopt, second wave** |
| Comments banned; a better name or a test instead | Rationale lives in tests, names and `.context`, not comments | AGENTS.md already says comments are for extreme cases; there are 1,327 comment lines | **Option**: ban new comments, rationale goes to `.context` |
| All art and music as code, one shared palette | Everything an agent may change is text, and design tokens are the only colors | Themes are now data; CSS still had hard-coded colors (swept by hand today) | Covered by rule (1) |
| Music continues the melody across biome changes | Context transitions carry the thread forward | Compaction packet, task focus | Low; the notebook already does this |
| Custom engine, localized OG images, runs inside an X post | Own the core where control matters; responsive under constraints | Already ours | Not new |

## Proposal, in build order

### 1. A lesson compiler: issues become rules, not prose

- Write rules as Biome 2.5 GritQL plugins under `lint/rules/`, run by the existing `npm run lint`.
- Reflection, review and the pair change one instruction: when a finding is mechanizable, the fix includes a rule, and
  the prose learning is retired.
- Seed with lessons we already paid for:
  - Workplace CSS colors only through `--wp-*` variables, with no `#fff` on fills.
  - No native `<select>` or `<datalist>` in Workplace.
  - No `\u` escapes in JSX text.
  - No TypeScript parameter properties or enums in files the runtime loads under strip-only Node.
  - No `readFileSync` of a transcript in runtime or recall code (the per-call whole-file parse that made search slow).
  - No `edit` / `display: flex` pairs without a `[hidden]` rule.
  - `useExhaustiveDependencies`-style misses we keep suppressing.
- **Agent actions are lintable too.** Several of our worst repeats are behaviors, not code:
  - an edit and its commit in one parallel batch;
  - `sed -i ''`;
  - `git rm`;
  - perl or heredoc edits of context-gated files;
  - `pkill -f`.

  A `tool_call` policy hook can refuse or warn on these exactly as a lint rule refuses code. The context gate proves the
  pattern works.

### 2. Budgets the build enforces

Each budget is a test that fails when exceeded, measured on representative fixtures:

- **Prompt budget:** system prompt plus tool schemas per execution context (root, intern, peer, `/btw`). This is the
  harness's "124 KB first download": it silently grows with every skill, tool and learning, and is paid on every turn.
- **Workplace first-load bundle size.**
- **Latency budgets:**
  - DM open on a large transcript;
  - indexed search p95;
  - runtime request handling;
  - the 1 s Workplace snapshot.

  Today these were found by the operator noticing slowness.

### 3. File paths that declare where code runs

Suffixes such as `.runtime.ts` (strip-only Node daemon), `.worker.ts`, `.web.tsx` (renderer) and `.hot.ts` (per-request
or per-frame paths: socket handlers, relay, tick timers), each with path-scoped rules:

- erasable-only TypeScript;
- no Electron or React imports in the runtime;
- no allocation-heavy or whole-file work in hot paths.

This moves part of what `.context` files explain in prose into names a rule can enforce.

### 4. Models of our lifecycles (TLA+, TLC; Java 21 is installed)

- A `formal-verification` skill.
- `specs/<system>.tla` models, starting with the command journal:
  - accepted, delivered, applied;
  - startup replay;
  - a crash at any step.
- Then departures, review attempts and focus spans.
- A test runs TLC on each spec.

### 5. Replay and verified claims

- Record a session's model responses and tool results so harness changes (context hooks, compaction, routing, recall)
  can be replayed against real sessions deterministically.
- A `verifies` link carrying a command can be re-run by the runtime when a task finishes. A claim like "tests pass"
  becomes checked, not asserted.

### 6. Headless tuning loops

Peers run fixed task sets headlessly to tune tool descriptions, skills and prompts against target rates:

- tool selection;
- recall sufficiency;
- review defect yield.

These replace the one-off gates run by hand.

## Not taking

- A custom engine, localized OG images and X embedding: the thread's product specifics.
- Banning all existing comments at once: optional; deciding it is the operator's call.
