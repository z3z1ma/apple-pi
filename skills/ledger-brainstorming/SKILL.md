---
name: ledger-brainstorming
description: "Use before creative software work: creating features, building components, adding functionality, or modifying behavior, especially when the outcome is non-trivial or governed by Ledger records."
---

# Brainstorming Ideas Into Designs

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by classifying how much process the request needs, then work through your path: understand the context, refine the idea, present a design, and get the operator's approval.

## Ledger State: Shaping

Search live and historical Ledger tasks, active records, and repository authority before asking the operator to repeat context. Separate facts from choices: every execution-changing assumption must be record-backed, explicitly user-ratified, or blocking. Ask only questions whose answers change the next safe action and pair them with a concrete recommendation. When structured choices help, call the root `ask_user_question` tool directly; do not wrap a single user interaction in `pi_exec`. Record a decision, specification, research finding, or task only when context has crystallized enough to serve a cold-start consumer. Shaping may conclude that deletion, reuse, documentation, or no code is the smallest complete answer.

<HARD-GATE>
Do NOT invoke any implementation skill, write any code, scaffold any
project, or take any implementation action until you have told the
operator what you intend and they have approved it. This applies
to EVERY task on EVERY path below — the ceremony scales with the task;
the approval gate never does. A request to “start now” authorizes beginning the workflow; it does not approve a design the operator has not yet seen.
</HARD-GATE>

## Ledger Workbench

Use one Ledger bundle for a non-trivial outcome. Before creating anything, search `.ledger/INDEX.md`, live task roots, and `.ledger/history/INDEX.md`. Extend an existing task when its Scope and Acceptance Criteria already own the outcome. Use `ledger_add` only when a new non-trivial outcome needs a cold-start contract.

A bounded production-behavior change is still non-trivial when it spans implementation and executable coverage or otherwise needs acceptance evidence. Create or reuse a minimal task root before implementation; bounded means no separate specification or plan document, not no durable contract. Keep that task live while approval is pending—do not delete it merely to restore a clean worktree or because no production edit has happened yet. Reserve record-free work for truly reversible one-offs whose removal would not leave production behavior incorrect or untested.

A task root contains exactly one level-one title and these sections in order:

- Scope
- Non-goals
- Acceptance Criteria with stable `AC-###` identifiers
- Work Items with stable `WI-###` identifiers when implementation decomposition is useful
- References
- Assumptions
- Journal
- Blockers
- Evidence
- Review
- Retrospective
- Distillation

Keep task state honest: `Status` is `open`, `active`, `blocked`, `done`, or `cancelled`; dependencies use canonical `.ledger/<task-id>/task.md` identities; Evidence and Review contain observations rather than predictions. Create supporting records only when the workflow consumes them.

### Research

When a fact or assumption changes the design, write one focused record under `research/` with Question or Hypothesis, Motivation, Sources and Methods, Findings, Conclusions, Limits, and Related Records. Record source revision and access date, contradictions, null results, confidence, and the difference between observation and inference. Research informs decisions; the operator ratifies product semantics.

### Specifications and Decisions

Architectural work stores the approved behavior under `specs/` with Purpose and Authority, Actors and Boundaries, Required Behavior, Error and Failure Behavior, scenarios, Acceptance Mapping, Exclusions, Assumptions and Provenance, and Related Records. Only an `active` spec governs execution.

Use `decisions/` for consequential or costly-to-reverse choices. Record Context, Decision, Authority and Provenance, steelmanned Alternatives, Consequences, Limits and Revisit Conditions, and Related Records. Supersede a changed decision instead of silently rewriting its history.

Use `knowledge/` only for task-local vocabulary or constraints that later iterations repeatedly need. Durable project knowledge moves to its real repository owner during finishing.

## Three Paths

Before your first question, classify the request and say the
classification out loud — "this looks bounded, so I'll present a short
design here rather than write a spec" — so the operator can
override it:

- **Spike** — a feasibility question ("can we...", "is it possible...",
  "quick and dirty is fine") whose output is an answer, not code you
  keep. Present the question and what you'll try in 2-3 sentences, get
  a nod, then find out as cheaply as correctness allows. No design
  doc, no spec file. Report findings as a recommendation; anything you
  built stays labeled throwaway.
- **Bounded** — a well-scoped change to code that already exists in
  this repo: a new flag, a small endpoint, a one-file fix.
  Understanding the kind of app is not enough — bounded means the flow
  you are changing is already here to read. If there is no existing
  flow to change, the task is not bounded. For a non-trivial behavior
  change, create or reuse a minimal Ledger task, then ask the clarifying
  questions that matter, present a short design IN CHAT (a few
  sentences to a few short paragraphs), and STOP. Implementation
  starts only after the operator says yes to that design — a
  bounded task's approval is as hard a gate as an architectural
  one. No spec file, no implementation plan document.
- **Architectural** — new projects, new subsystems, changes that
  restructure how components fit together or alter interfaces others
  depend on. Follow the full process: questions, approaches, sectioned
  design, written spec, then the `ledger-writing-plans` skill.

When in doubt between two paths, take the heavier one. The ratchet is
one-way: hidden complexity discovered mid-task upgrades the path —
stop, say so, and step up. Nothing downgrades mid-task.

## Anti-Pattern: "Too Simple To Need Approval"

Every path ends with the operator approving your intent before
implementation. A todo list, a single-function utility, a config
change — the design may be two sentences in chat, but you MUST present
it and get approval. "Simple" tasks are where unexamined assumptions
cause the most wasted work. What scales with simplicity is the
artifact, never the approval.

## Red Flags

| Thought | Reality |
|---------|---------|
| "This is too simple to need a design" | Simple means a short design, not no design. Two sentences in chat, then approval. |
| "I'll call it bounded and skip the spec" | Reaching for a label to skip work IS the doubt — take the heavier path. |
| "It's bounded and the design is obvious — I'll start while they read it" | The gate is the approval, not the design's length. Present, then stop until you hear yes. |
| "I understand this kind of app, so it's bounded" | Bounded measures the repo, not your familiarity. A new project has no existing flow — it is architectural. |
| "The spike works, so I'll keep the code" | A spike's output is an answer. Keeping the code is a new request — classify it. |
| "It grew, but I'm almost done — no need to re-classify" | Hidden complexity upgrades the path mid-task. Stop and say so. |
| "They said start now, so the design is approved" | Starting the workflow is not approval of an unseen design. Present the design, then wait. |
| "No code changed, so I should delete the task before waiting" | The live task is the cold-start contract for the pending approval; keep it until it is completed or explicitly cancelled. |
| "They approved the spike, so the follow-up change is approved too" | Each task gets its own classification and its own approval. |

## Visual Companion

Offer the browser companion only when the first genuinely visual question would be clearer shown than described—mockups, layout comparisons, diagrams, spatial relationships, or design polish. Do not offer it merely because the topic is a UI. Send the offer as its own message: **"Some of the questions coming up would be easier to answer visually. I can open a local browser companion to show options and collect clicks. Want to use it?"**

Start nothing until the operator accepts. On acceptance, read [visual-companion.md](visual-companion.md) and follow its authenticated, terminal-primary loop. Visual HTML may persist under the task's evidence storage; tokens, URLs, PIDs, logs, and browser events remain ephemeral. Record selected semantics in the specification, decision, or Journal because visual artifacts are evidence, not authority.

## Checklist

Classify first, announce the path, then complete the applicable checklist in order. Use the governing Ledger task for durable state when the work is non-trivial.

**Spike:**
1. **Explore project context** — enough to frame the probe
2. **Present question + probe plan** — 2-3 sentences
3. **Get approval** — a nod is enough
4. **Investigate** — as cheaply as correctness allows
5. **Report findings** — a recommendation; label anything built as throwaway

**Bounded:**
1. **Explore project context** — check files, docs, recent commits
2. **Establish the contract** — create or reuse a minimal Ledger task for a non-trivial behavior change; no separate spec or plan document
3. **Ask clarifying questions** — one at a time, the ones that matter
4. **Present short design in chat** — approach, files touched, testing
5. **Get approval** — STOP and wait for an explicit yes; presenting the design and starting in the same breath is skipping the gate
6. **Implement** — proceed with the normal development workflow (TDD applies); no plan document

**Architectural:**
1. **Explore project context** — check files, docs, recent commits
2. **Ask clarifying questions** — one at a time, understand purpose/constraints/success criteria
3. **Propose 2-3 approaches** — with trade-offs and your recommendation
4. **Present design** — in sections scaled to their complexity, get user approval after each section
5. **Write the active specification** — use the governing Ledger task's `specs/` directory
6. **Spec self-review** — quick inline check for placeholders, contradictions, ambiguity, scope (see below)
7. **Independent spec review** — load `ledger-requesting-code-review`, use its [executable review gate](../ledger-requesting-code-review/review-gate.md) in `specification` mode, translate [spec-document-reviewer-prompt.md](spec-document-reviewer-prompt.md) into the gate inputs, and resolve material findings
8. **User reviews written spec** — ask user to review the spec file before proceeding
9. **Transition to implementation planning** — load `ledger-writing-plans` and create the source-backed plan

## Process Flow

```dot
digraph ledger-brainstorming {
    "Classify: spike / bounded / architectural" [shape=diamond];
    "Present question + probe (2-3 sentences)" [shape=box];
    "Ask clarifying questions (bounded)" [shape=box];
    "Present short design in chat" [shape=box];
    "Human approves?" [shape=diamond];
    "Investigate; report recommendation" [shape=doublecircle];
    "Implement via normal workflow (no plan doc)" [shape=doublecircle];
    "Explore project context" [shape=box];
    "Ask clarifying questions" [shape=box];
    "Propose 2-3 approaches" [shape=box];
    "Present design sections" [shape=box];
    "User approves design?" [shape=diamond];
    "Write design doc" [shape=box];
    "Spec self-review\n(fix inline)" [shape=box];
    "Independent spec review" [shape=box];
    "User reviews spec?" [shape=diamond];
    "Load ledger-writing-plans" [shape=doublecircle];
    "Hidden complexity? Upgrade path" [shape=box];

    "Classify: spike / bounded / architectural" -> "Present question + probe (2-3 sentences)" [label="spike"];
    "Classify: spike / bounded / architectural" -> "Ask clarifying questions (bounded)" [label="bounded"];
    "Classify: spike / bounded / architectural" -> "Explore project context" [label="architectural"];
    "Present question + probe (2-3 sentences)" -> "Human approves?";
    "Ask clarifying questions (bounded)" -> "Present short design in chat";
    "Present short design in chat" -> "Human approves?";
    "Human approves?" -> "Investigate; report recommendation" [label="spike: yes"];
    "Human approves?" -> "Implement via normal workflow (no plan doc)" [label="bounded: yes"];
    "Hidden complexity? Upgrade path" -> "Classify: spike / bounded / architectural";
    "Explore project context" -> "Ask clarifying questions";
    "Ask clarifying questions" -> "Propose 2-3 approaches";
    "Propose 2-3 approaches" -> "Present design sections";
    "Present design sections" -> "User approves design?";
    "User approves design?" -> "Present design sections" [label="no, revise"];
    "User approves design?" -> "Write design doc" [label="yes"];
    "Write design doc" -> "Spec self-review\n(fix inline)";
    "Spec self-review\n(fix inline)" -> "Independent spec review";
    "Independent spec review" -> "Write design doc" [label="material findings"];
    "Independent spec review" -> "User reviews spec?" [label="ready"];
    "User reviews spec?" -> "Write design doc" [label="changes requested"];
    "User reviews spec?" -> "Load ledger-writing-plans" [label="approved"];
}
```

**Terminal states are path-bound.** Architectural work moves from ledger-brainstorming to `ledger-writing-plans`. Bounded work proceeds through the normal development workflow after approval, using its minimal Ledger task but no plan document. A spike ends with a reported recommendation.

## The Process

The subsections below serve the bounded and architectural paths (a
spike stops at "present the probe, get a nod"). Sections from
**Exploring approaches** onward are architectural-path depth — for
bounded work, context plus a few questions plus a short in-chat design
is the whole process.

**Understanding the idea:**

- Check out the current project state first (files, docs, recent commits)
- Before asking detailed questions, assess scope: if the request describes multiple independent subsystems (e.g., "build a platform with chat, file storage, billing, and analytics"), flag this immediately. Don't spend questions refining details of a project that needs to be decomposed first.
- If the project is too large for a single spec, help the user decompose into sub-projects: what are the independent pieces, how do they relate, what order should they be built? Then brainstorm the first sub-project through the normal design flow. Each sub-project gets its own spec → plan → implementation cycle.
- For appropriately-scoped projects, ask questions one at a time to refine the idea
- Prefer multiple choice questions when possible, but open-ended is fine too
- Only one question per message - if a topic needs more exploration, break it into multiple questions
- Focus on understanding: purpose, constraints, success criteria

**Exploring approaches:**

- Propose 2-3 different approaches with trade-offs
- Present options conversationally with your recommendation and reasoning
- Lead with your recommended option and explain why
- YAGNI ruthlessly - remove unnecessary features from every approach and design

**Presenting the design:**

- Once you believe you understand what you're building, present the design
- Scale each section to its complexity: a few sentences if straightforward, up to 200-300 words if nuanced
- Ask after each section whether it looks right so far
- Cover: architecture, components, data flow, error handling, testing
- Be ready to go back and clarify if something doesn't make sense

**Design for isolation and clarity:**

- Break the system into smaller units that each have one clear purpose, communicate through well-defined interfaces, and can be understood and tested independently
- For each unit, you should be able to answer: what does it do, how do you use it, and what does it depend on?
- Can someone understand what a unit does without reading its internals? Can you change the internals without breaking consumers? If not, the boundaries need work.
- Smaller, well-bounded units are also easier for you to work with - you reason better about code you can hold in context at once, and your edits are more reliable when files are focused. When a file grows large, that's often a signal that it's doing too much.

**Working in existing codebases:**

- Explore the current structure before proposing changes. Follow existing patterns.
- Where existing code has problems that affect the work (e.g., a file that's grown too large, unclear boundaries, tangled responsibilities), include targeted improvements as part of the design - the way a good developer improves code they're working in.
- Don't propose unrelated refactoring. Stay focused on what serves the current goal.

## After the Design (architectural path)

**Documentation:**

- Write the validated design to the governing Ledger task's `specs/` directory.
- Keep the task root's References and Journal current.
- Use a writing skill from the available-skills catalog when applicable.

**Spec Self-Review:**
After writing the spec document, look at it with fresh eyes:

1. **Placeholder scan:** Any "TBD", "TODO", incomplete sections, or vague requirements? Fix them.
2. **Internal consistency:** Do any sections contradict each other? Does the architecture match the feature descriptions?
3. **Scope check:** Is this focused enough for a single implementation plan, or does it need decomposition?
4. **Ambiguity check:** Could any requirement be interpreted two different ways? If so, pick one and make it explicit.

Fix any issues inline. No need to re-review — just fix and move on.

**User Review Gate:**
After the spec review loop passes, ask the user to review the written spec before proceeding:

> "Spec written to `<path>`. Please review it and let me know if you want changes before implementation planning."

Wait for the user's response. If they request changes, make them and re-run the spec review loop. Only proceed once the user approves.

**Implementation planning:**

- Load `ledger-writing-plans` from its catalog location and create a detailed implementation plan.
- Begin implementation after the plan is ready and the operator authorizes execution.
