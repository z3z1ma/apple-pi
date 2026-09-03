# Task History

- `.ledger/history/202608181148-advisor-ux-reviewing-state-footer-bordered-advisory-card/task.md` — done — Advisor UX: reviewing-state footer + bordered advisory card — Implemented persistent footer reviewing/idle state and a bordered severity-colored advisory card (done). Also parks a detailed research record on pi-advisor's non-blocking steer/deferred/followUp delivery model for a future architectural decision.

- `.ledger/history/202608181322-account-sidecar-model-usage/task.md` — done — Account for advisor and memory sidecar model usage — Emit durable per-call usage/cost records for advisor and observational-memory model calls so per-provider quota spend is measurable; today ~100% of sidecar spend is invisible.

- `.ledger/history/202608181322-merge-memory-consolidation-pass/task.md` — done — Merge memory consolidation into one curation pass — Observer, reflector, and dropper run as up to three sequential model calls re-sending overlapping input; merge them into one curation pass with coverage tiers and drop budget recomputed against post-record state rather than a pre-loop snapshot.

- `.ledger/history/202608201212-upgrade-ralph-pi-exec-templates/task.md` — done — Bring Ralph templates to pi_exec standard-library quality — Adapt pi-ralph references and both skill guides to use the shared pi_exec std library with deliberate templates and coverage checks.

- `.ledger/history/202608202232-redesign-input-area-information-layout/task.md` — done — Redesign the Pi input-area information layout — Replace apple-pi's default footer composition with a responsive, status-preserving custom input-area layout inspired by Zentui and selected Powerline presentation patterns.

- `.ledger/history/202608202235-evaluate-superpowers-ledger-integration/task.md` — done — Evaluate Superpowers integration with Ledger — Study obra/superpowers at main and define an evidence-backed integration path for apple-pi's ledger, skills, Ralph, subagents, and Pi Exec.

- `.ledger/history/202608202254-strengthen-ledger-workflow/task.md` — done — Strengthen Ledger workflow with evaluated Superpowers principles — Fuse Superpowers procedures and 10x durable judgment into 13 Ledger lifecycle skills while preserving Pi utility boundaries.

- `.ledger/history/202608211154-colorize-input-card-editor/task.md` — done — Colorize the input card and custom editor — Add theme-aware semantic color and styling to the bottom information strip and Apple Pi custom editor while preserving native editing, responsive width, and component status integration.

- `.ledger/history/202608151813-build-harness-operations-ui/task.md` — cancelled — Build interactive review, Ralph, and ledger-task operations UI

- `.ledger/history/202608151813-converge-typescript-architecture/task.md` — done — Converge TypeScript architecture, formatting, and quality controls

- `.ledger/history/202608151813-replace-caller-budget-arithmetic/task.md` — done — Replace caller-configured budget arithmetic with harness-owned limits

- `.ledger/history/202608151843-bootstrap-gated-work-items/task.md` — done — Bootstrap gated task-local work items outside Ralph

- `.ledger/history/202608160933-adapt-review-planning-for-speed/task.md` — done — Adapt review planning for focused, fast semantic coverage

- `.ledger/history/202608162041-slim-review-planner-drop-token-gates/task.md` — done — Slim review planning and drop review token gates

- `.ledger/history/202608162056-observational-memory-compacted-context/task.md` — cancelled — Research observational memory in compacted context

- `.ledger/history/202608162324-distill-observational-memory-current-state/task.md` — cancelled — Distill observational memory into current working state

- `.ledger/history/202608181322-coalesce-advisor-reviews/task.md` — cancelled — Coalesce advisor reviews without dropping deltas — The advisor drains immediately on every turn_end (one per assistant step), re-sending its whole accumulated history each time; defer the drain to batch low-signal steps while still pushing every delta, since a skipped delta is permanently absent from advisor context.

- `.ledger/history/202608181322-design-advisor-context-framing/task.md` — cancelled — Design advisor context framing — Advisor context is a regular session of lean trajectory receipts whose compact hook reseeds from the live curator fold, recent user messages, and rolling settled advice; recall uses primary-bound memory_source and session_search.

- `.ledger/history/202608181322-gate-compaction-on-real-context-window/task.md` — cancelled — Gate compaction on real context usage within the configured window — Compaction currently gates on estimated source tokens (81k default) and ignores the model's configured contextWindow, so billed context reached 196k median / 331k p90 and crossed provider long-context price tiers. Gate on provider-reported usage relative to the configured window instead, with no model names in TypeScript.

- `.ledger/history/202608182330-protect-vcc-finished-turn-deliverable/task.md` — cancelled — Protect finished-turn deliverables in VCC compaction — Rewrite VCC cut, subsequent-compact, and compile so long-horizon analyses survive ambient and follow-up compaction instead of being mid-cycle sliced, shredded to a stub tail, or 200-word compiled.

- `.ledger/history/202608211051-rename-skills-generalize-ralph/task.md` — cancelled — Rename workflow skills and generalize Ralph — Replace Superpowers-derived public skill names with concise 10x-aligned names, remove relative cross-skill references, and split Ralph into general and Ledger-specific bounded iteration programs.

- `.ledger/history/202608211655-integrate-fleet-hint-into-input-card/task.md` — done — Integrate Fleet navigation hint into the input card — Move the active-agent navigation hint out of its dedicated below-editor row and right-align it opposite model/provider/thinking metadata in the Apple Pi input card.

- `.ledger/history/202608211538-redefine-ledger-task-artifact-model/task.md` — done — Redefine Ledger task artifact model — Make task.md own durable intent, plans own progress, evidence act as laboratory notes, and one top-level retrospective drive project improvement

- `.ledger/history/202608211615-implement-first-class-llm-wiki/task.md` — done — Implement a first-class LLM wiki — Design and build a packaged LLM wiki workflow with durable source provenance, compounding Markdown knowledge, safe querying, and only the supporting runtime components apple-pi actually needs.

- `.ledger/history/202608212342-first-class-todo-system/task.md` — done — Build first-class to-do system — Adapt pi-tasks into an apple-pi-native task UI, persistence, model-tool, and subagent workflow integrated with existing backlog, Ledger, status, and package boundaries.

- `.ledger/history/202608262359-sentinel-advisor-supervision/task.md` — done — Implement hierarchical Sentinel to Advisor supervision — Delivered one optional persistent Sentinel that escalated hard cases to Advisor; later superseded by the Pair Programmer consolidation task.

- `.ledger/history/202608271751-consolidate-pair-programmer-supervision-and-memory/task.md` — done — Consolidate Pair Programmer supervision and memory — Replace Sentinel and standalone observational-memory curation with one persistent Pair Programmer that watches, keeps sourced notes, reflects, steers, and escalates to Advisor.

- `.ledger/history/202608281109-harden-harness-correctness/task.md` — done — Harden repository-wide harness correctness — Resolve the complete repository audit across trust, lifecycle, runtime contracts, persistence, compaction, search, and supporting correctness gaps.

- `.ledger/history/202608301046-refine-pair-review-responsiveness/task.md` — done — Refine Pair review responsiveness — Eliminate review stalls, advice bursts, supervisory thrash, and inconsistent primary-agent response while preserving a sparse, high-value Pair workflow.

- `.ledger/history/202608301913-simplify-harness-surface/task.md` — done — Simplify the model-facing harness surface — Replace default to-do and backlog machinery with self-reminders, remove pi_exec contract duplication, and simplify the operational ledger instructions and structure without weakening long-horizon continuity.

- `.ledger/history/202608312305-assess-pi-0-84-4/task.md` — done — Assess Pi 0.84.4 opportunities for Apple Pi — Research Pi 0.84.3–0.84.4 primary sources and map changes to Apple Pi's current extension surface, upgrade risks, simplifications, and concrete recommendations.

- `.ledger/history/202609010018-adopt-pi-0-84-4-safely/task.md` — done — Adopt Pi 0.84.4 safely — Upgrade Apple Pi's development package family and implement tested compaction safety/fallback, xAI summarization boundary proof, prompt status, notification failure state, and pair ordering coverage.

- `.ledger/history/202608311006-port-matt-pocock-engineering-skills/task.md` — done — Replace workflow skills with Matt Pocock-derived engineering workflows — Rebuild Apple Pi's workflow skill layer around adapted Matt Pocock engineering skills, using ledger task folders for task artifacts and .wiki Markdown for grill-derived context while preserving Apple Pi fundamentals.

- `.ledger/history/202609021914-pair-receipt-expansion/task.md` — done — Constrain pair programmer to trajectory receipts — Remove repository and general session-search tools from the persistent pair and add handle-bound expansion for omitted primary trajectory content.

- `.ledger/history/202609022314-deepen-pair-collaboration/task.md` — done — Deepen pair collaboration and image visibility — Let the pair use restrained probing/view requests through share_note, simplify behavioral framing around frontier judgment, and add source-bound on-demand receipts for user images.
