Status: in-progress
Created: 2026-11-03
Updated: 2026-11-03

# A custom system prompt for the harness

## Intent

The operator wants apple-pi to own its system prompt completely, as the next step toward the strongest harness. Step one, done: understand the current prompt. The Pi base, every section apple-pi and Pi's MCP add, and every tool definition are captured from a real request and rendered in [current-prompt/](current-prompt/README.md). The design in [vision.md](vision.md) was approved on 2026-11-04 with the operator's decisions in its section 7.

Done when:
- **Composer:** a `components/system-prompt` component writes every section of the prompt for root sessions, interns, `/btw`, the pair sidecar and program peers. It works from one authored document plus live facts the owning components provide. It sets `customPrompt` (Pi's preamble, `tools`, `rules` and `docs` are replaced) and never uses `forceSystemPrompt`.
- **Order:** sections run from most stable to most personal (operating model, toolbox, skills, project, person). A changed section still appends as a delta (`tests/system-prompt-sections.test.ts`).
- **Projection:** one table decides sections and declared tools per context, posture and environment. A test renders every existing combination and finds no active tool left untaught and no taught tool that is absent. The pair tool and pair text appear only while the pair is on. Unroled roots keep the full manager posture.
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
- Tools still carry their old `promptGuidelines`; root sessions no longer render them, `/btw` still does. They go in step 4.
- **Next:** step 3, the person sections (`org` as instructions, the role catalog grouped by posture).

## Outcome

Pending completion.
