Status: in-progress
Created: 2026-11-03
Updated: 2026-11-03

# A custom system prompt for the harness

## Intent

The operator wants apple-pi to own its system prompt completely, as the next step toward the strongest harness. Step one, done: understand the current prompt. The Pi base, every section apple-pi and Pi's MCP add, and every tool definition are captured from a real request and rendered in [current-prompt/](current-prompt/README.md). The design in [vision.md](vision.md) was approved on 2026-11-04 with the operator's decisions in its section 7.

Done when:
- **Composer:** a `components/system-prompt` component writes every section of the prompt for root sessions, interns, `/btw` and program peers. The pair sidecar keeps its own authored prompt (operator, vision §7.6). It works from one authored document plus live facts the owning components provide. It sets `customPrompt` (Pi's preamble, `tools`, `rules` and `docs` are replaced) and never uses `forceSystemPrompt`.
- **Order:** sections run from most stable to most personal (operating model, toolbox, skills, project, person). A changed section still appends as a delta (`tests/system-prompt-sections.test.ts`).
- **Projection:** each component keeps its activation gate (operator, vision §7.5). A test renders every existing posture and context and finds no active tool left untaught and no taught tool that is absent. The pair tool and pair text appear only while the pair is on. Unroled roots keep the full manager posture.
- **Tool surface:** definitions are concise; long procedures live in the skills the toolbox points to.
- **Measured:** the prompt is re-captured after each step, `tests/prompt-budgets.test.ts` is lowered to the measured size, and `npm run audit:cache` shows prefix caching intact.
- **Docs:** the prompt's design and how to change it are documented, and the AGENTS.md architecture map has the component.
- Each step is committed on main.

## Current State

- [current-prompt/README.md](current-prompt/README.md): sizes, who writes each section, what varies between sessions and providers, and how to capture again.
- `system-prompt.md` and `tools.md` hold the full text; `system-prompt.txt` holds the exact bytes.
- At capture, roughly 34k tokens of system prompt and 29k tokens of tool definitions per request. The largest parts were `project_context` (the two `AGENTS.md` files, about 12.6k), `project-learnings` (about 7.4k, since pruned to about 860), `rules` (about 3.9k) and `skills` (about 3.6k).
- Pi already lets an extension replace the preamble, any single section, or the whole prompt (see the README).
- [vision.md](vision.md): the design for owning the prompt, checked against apple-pi's and Pi's source and 14 days of tool use. It assesses the earlier twenty-loop analysis (two claims wrong, one real defect found: the pair tool ships while the pair is off), proposes one composer component with a stability-ordered document and posture-based tool exposure, and gives the build order. The operator's four decisions are recorded in its section 7.
- **Step 1, done (`284987b8`):** `components/system-prompt` composes the prompt as the last extension. Re-captured from real Pi, it held the same text in the new order. A first version read the session-start tool list instead of the live one; a real-session test caught it.
- **Step 2, done (`2460d225`):** the operating model replaces Pi's preamble; a toolbox grouped by job replaces Pi's tool list, 77-bullet rules and docs; interns get a short intern preamble (`--intern`). The pair tool is active only while the pair is on. Real capture: system prompt 28.4k → 25.5k tokens (it now also carries the operating model); the root fixture budget is 38,749 and the intern budgets 2,289 / 2,301.
- Two parts stay outside the composer: Pi's built-in MCP extension writes `mcp_servers` after apple-pi's handlers run, and the Anthropic provider adds its identity line.
- **Step 3, done (`ba1c167b`):** `org` holds facts and norms only (tool mechanics moved to the toolbox and tool descriptions); the role catalog is grouped by posture. `docs/system-prompt.md` documents the design; AGENTS.md maps the component.
- **Step 4, partly done:** `/btw` composes through the same composer (`a0c58027`); the heaviest descriptions were cut (`e4512865`). Root fixture budget 38,749 → 35,056 tokens; tool schemas 113.6k → 107.5k chars; real capture system prompt 102k → 93k chars.
- **The operating frame** (`e2db6816`, `dc892df3`, `784f78c6`; design in `frame.md`, approved with notes): evidence kinds, the place room by room (the ledger and the wiki folded into the record room), and a worked goal. Measured in `salience/`: over three samples the plan practices rose from 62% to 84% (GPT-6.1) and 78% to 95% (Opus 5.5); the cold-read revision held that level. Root budget 34,384 tokens.
- **Settled:** the projection is a posture test, not a central table (vision §7.5; `9d8d38bb` checks every posture and context); the pair sidecar keeps its own prompt (§7.6); dead `promptSnippet`/`promptGuidelines` on grouped tools were removed (`f03d91aa`).
- **Open:** (1) `npm run audit:cache` once real sessions have run on the composer; (2) tool usage in session logs before and after, which is what shows behavior rather than plans; (3) more tool-definition trimming; (4) `pi_exec` fails every program in live sessions with `invalid-type-form tuple[EllipsisType, Unknown]`, while the stubs built from the full live tool set type-check at HEAD; cause unknown.

## Outcome

Pending completion.
