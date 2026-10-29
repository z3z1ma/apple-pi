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

- `.ledger/history/202609031702-pace-pair-reviews/task.md` — done — Pace pair reviews within active runs — Replace per-turn pair inference with semantic checkpoint scheduling, pair-selected attention leases, starvation safeguards, and expedited finding confirmation while preserving every trajectory delta and normal model compaction.

- `.ledger/history/202609171626-assess-pi-0-85-x/task.md` — done — Assess Pi 0.85.x opportunities for Apple Pi — Research Pi 0.85.0/0.85.1 and unreleased main against Apple Pi's custom editor, footer, bash, pair, ledger, and compaction surfaces.

- `.ledger/history/202609171730-adopt-pi-0-85-1/task.md` — done — Adopt Pi 0.85.1 host pins — Align Apple Pi's four Pi development pins and pi-mcp-adapter with the already-running 0.85.1 host. Leave the working spinner standalone.

- `.ledger/history/202608311324-refine-llm-wiki-tools/task.md` — done — Refine the LLM wiki with prompt and graph tools — Add compact wiki system guidance, deterministic Obsidian-link validation, graph neighborhood retrieval, and clearer on-demand wiki procedures.

- `.ledger/history/202609191341-replace-reminders-with-scheduling/task.md` — done — Replace self-reminders with managed scheduling — Implement a root-only one-shot schedule tool for deferred prompts or bash commands, integrate schedules into task management, and keep schedule/task unavailable to Pi Exec.

- `.ledger/history/202609191514-reactive-monitor-core-guidance/task.md` — done — Add reactive monitor and consolidate native capability guidance — Add stdout-driven monitor tasks with immediate steering and optional caller-owned limits, integrate them into the managed-task lifecycle, and move native Pi Exec/execution education into concise core tool guidance rather than a prerequisite skill.

- `.ledger/history/202609191702-assess-pi-0-86-0/task.md` — done — Assess Pi 0.86.0 compatibility — Research Pi 0.86.0 changes, verify apple-pi against the new package family, and identify required or beneficial updates.

- `.ledger/history/202609191856-adopt-pi-0-86-0-safely/task.md` — done — Adopt Pi 0.86.0 safely — Prepare Apple Pi for Pi 0.86.0, validate the repository migration, and define a gated self-update and rollback sequence before updating the global Pi binary.

- `.ledger/history/202609192323-polish-managed-task-active-work-ui/task.md` — done — Polish managed tasks and subagent active-work UI — Replace below-editor Fleet duplication with polished above-editor active-work visibility and first-class agent/task management overlays.

- `.ledger/history/202609200830-unify-active-work-manager/task.md` — done — Unify active-work management under /work — Replace separate /agents and /tasks entrypoints with one tabbed work modal opened by /work or Ctrl+W, while preserving domain-specific detail actions.

- `.ledger/history/202609251319-monty-pi-exec/task.md` — done — Replace pi_exec JavaScript VM with Monty Python sandbox — Research and plan to rebuild pi_exec on @pydantic/monty: type-checked Python guest, host-function bridges, VM-enforced limits, optional branch-aligned persistent sessions.

- `.ledger/history/202609291615-adopt-pi-0-99-native-mcp/task.md` — done — Adopt Pi 0.99 native MCP — Upgrade Pi dependencies, remove third-party MCP adapter, validate root and child native MCP; defer Pi Exec redesign pending runtime decision.

- `.ledger/history/202610030008-tui-glanceable-panels/task.md` — done — Glanceable panels for the Apple Pi TUI — Move Apple Pi from all-modal overlays to non-capturing glanceable panels (subagents first), a /btw top drop-down, and restored overlay state, within the public Pi API.

- `.ledger/history/202610021233-prompt-surface-tightening/task.md` — done — Tighten the system prompt surface across hooks, tools, children, and skills — Move prompt hooks to Pi sections, give child sessions real tool rules, remove duplicated/contradictory guidance, trim profiles, gate wiki prompt, fix skill triggers.

- `.ledger/history/202610031016-subagent-outcome-framing/task.md` — done — Deepen subagent outcome framing — Concentrate shared outcome framing for root results, nested results, and notifications behind one interface while preserving observable behavior, persistence ownership, and delivery lifecycle.

- `.ledger/history/202610031136-subagent-resume-policy/task.md` — done — Centralize public-subagent resume policy — Deepen invocation policy for root and nested public subagents: omitted fixed settings reuse stored choices, explicit changes are rejected, and caller-owned ownership and execution remain unchanged.

- `.ledger/history/202610031403-branch-search/task.md` — done — Branch search: externally drawn parallel attempts scored by hidden checks — Design and build branch search: pre-registered hidden scorer, enumerated approaches drawn by seeded RNG, forked continuations in isolated git worktrees sharing the parent cache prefix, objective selection and apply. Starts with Pi integration spikes V1-V3.

- `.ledger/history/202610040726-branch-search-challenger-benchmark/task.md` — done — Branch search: adversarial scorer and trap benchmark — Add a challenger pass that attacks authored checks with plausible wrong implementations, and a fast staged-trap benchmark (agent alone vs search vs search with challengers, repeated runs) to measure whether search beats one trajectory.

- `.ledger/history/202610041532-branch-search-scalar-judge/task.md` — done — Simplify branch search to a scalar-judge tool — Reduce branch search to parallel worktree attempts scored by user-supplied numeric judges (plus optional gates and an optional model judge); remove the authored scorer and its machinery (tagged branch-search-v1); move the evaluation harness to its own internal component for history replay.

- `.ledger/history/202610040735-pi-exec-work-panel/task.md` — done — Expose Pi Exec work in the shared work panel — Add a program-first Pi Exec tab to Ctrl+W with live host calls and worker tool detail, settled results, saved-program support, and shared passive activity.

- `.ledger/history/202610032128-coding-child-reflections/task.md` — done — Add coding-child reflections and shared learning — Give write-capable interactive children one in-band pre-settle review/learning continuation and add-only access to the primary notebook, retaining cited child evidence for exact recall.

- `.ledger/history/202610022036-notebook-learning-loop/task.md` — done — Refocus the notebook on in-session learning and its distillation — Notebook holds session learnings (failures, workarounds, environment access, user corrections), captured by agent and pair, placed by the main agent at token-spaced run-end reflections into wiki, retrospectives, AGENTS.md, skills, or .pi/programs.

- `.ledger/history/202610130816-machine-owned-learnings/task.md` — done — Place learnings automatically in a machine-owned zone — Replace per-learning user approval with a fixed write boundary: the agent places, merges, and prunes learnings in machine-owned paths (.wiki, retrospectives, .pi/programs, .pi/LEARNINGS.md injected at session start); git ignore state decides sharing; /distill promotes to human-owned files on request.

- `.ledger/history/202610131235-post-compaction-distill/task.md` — done — Distill learnings in a fork after compaction — Split the learning loop into capture (reflection, notebook), distill (post-compaction fork, ledger close, /distill: notebook to .pi/LEARNINGS.md, wiki, retrospectives, programs), and promote (/promote with approval to AGENTS.md, skills, docs).

- `.ledger/history/202610131309-pi-1-2-upgrade/task.md` — done — Upgrade to Pi 1.2 and adopt its native integration points — Move dev/peer deps to Pi 1.2; fix start-event union handling; add reachesTools to pi_exec and programs; move pi_exec nested calls to ctx.executeTool with structuredContent/isError; show schema constraints; use public render data; schema examples.

- `.ledger/history/202610151241-browser-review-surfaces/task.md` — done — Agent-structured browser review and understanding surfaces — Tool calls open ephemeral local web pages for code review, Markdown review, ledger task review, and human understanding; the agent structures content from blocks and review pages return anchored annotations plus a verdict.

- `.ledger/history/202610152308-tmux-agent-tracking/task.md` — done — Agent tracking surfaces for tmux: list, sidebar, dashboard, status bar — Evolve the tmux session manager from a popup picker into views that show which Pi agents need the user, tell agents apart (auto session name, ledger task), and show progress at a glance; remove the dedicated popup launcher.

- `.ledger/history/202610160804-audit-vitest-tests-for-observable-behavior-value/task.md` — done — Audit Vitest tests for observable behavior value — Review the Vitest suite for vacuous assertions, implementation locks, duplicated coverage, and non-observable negatives; produce evidence-backed removal and rewrite recommendations.

- `.ledger/history/202610160838-notch-agent-room/task.md` — done — Notch agent room: a Mac notch UI that shows pi agents as a cozy pixel room — Clean-room take on Agent Shrine for pi/tmux: a thin Swift notch shell hosting a web renderer (reusable later in a local web app and Tauri/Electron), fed by the tmux-sessions agent store. Starts with a throwaway prototype.

- `.ledger/history/202610161427-session-mailbox/task.md` — done — Session mailbox: durable per-session inbox that steers the agent — Every root Pi session gets a durable mailbox keyed by its session id; anything (agents, scripts, headless runs) appends messages, and the session receives them as steers with at-least-once delivery recorded in the session itself.

- `.ledger/history/202610161427-orchard/task.md` — done — Orchard: chief-of-staff Pi session that tracks every thread and runs worker sessions — One long-lived Pi session in ~/orchard takes in everything, keeps a durable index of projects, commitments and threads across repos, starts and watches top-level worker Pi sessions in tmux, and reports and nudges through the session mailbox.

- `.ledger/history/202610172354-session-state-model/task.md` — done — Shared Pi and tmux state model for all of apple-pi — Wayfinder map toward a spec for one rich state model of Pi sessions, tmux, and processes (entities, bindings, activity, conversation, attention), captured by a bridge extension in every Pi session plus tmux and process observation, stored in SQLite, and used uniformly by the sidebar, dashboard, notch, coordinator, and Agent World.

- `.ledger/history/202610171741-guildworld/task.md` — done — Agent World: themeable living work-world over real Pi sessions — Wayfinder map toward a whole-product spec for Agent World, a cozy themeable pixel-art world app inside apple-pi that renders real Pi/tmux sessions, coordinator delegation, and Jira/GitHub/Slack/Confluence work as characters, places, and quests. Source: ~/Downloads/guildworld_handoff.

- `.ledger/history/202610191114-agent-world-alive/task.md` — done — Agent World: a more alive world — Follow-up to the Agent World build: cursor and click feel, depth and grounding in every place, varied pets and NPCs with idle animations and wandering, fun ambient NPCs, a second exterior per theme, recruiting agents in theme, Slack reading fixes, and an aliveness pass.

- `.ledger/history/202610202140-organization/task.md` — done — Organization: Pi sessions as people with roles, souls, selves, and an org tree — Turn peer sessions into lasting people: a role catalog with fixed minds, harness-drawn souls, harness-kept selves, an org tree rooted at the operator's session with managers hired from the catalog, open mail across the org, and Agent World as the view.

- `.ledger/history/202610211241-senses-replace-subagents/task.md` — done — Senses and peers replace subagents — Remove the agent tool and subagent manager; explorer and researcher become first-class one-shot tools; all other cross-agent work, including pi_exec model workers, runs through peers; /btw owns its session.

- `.ledger/history/202610241039-rtk-one-rewrite-owner/task.md` — done — Delete the rtk tool_call hook: one rewrite owner — Delete extensions/rtk.ts's tool_call hook and its _rtk/_rawCommand fields so prepareShellCommand is the only command rewriter; fold the duplicate guards, drop unused rtk options, skip host-binary tests when rtk is absent, update docs.

- `.ledger/history/202610242320-org-mri-morphogenesis/task.md` — done — Organizational MRI and morphogenesis — Architecture decision for a self-optimizing organization: diagnose where the org of Pi sessions wastes cognition and coordination (MRI) from session-state facts, and adapt staffing, routing, authority, and topology through reviewable org changes (morphogenesis). Wayfinder map in map.md.

- `.ledger/history/202610280018-workplace-mail-and-chat-spike/task.md` — done — Workplace mail and chat evaluation — Adopted as first-class Workplace; historical iteration evidence retained. Org continues in its own task.
