---
name: improve-codebase-architecture
description: "Scan a codebase for deepening opportunities, present them as a visual HTML report, then interrogate the selected candidate."
disable-model-invocation: true
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities**: refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability.

This is an architecture survey, not a refactoring command. It may write one temporary HTML report and, after the user selects a candidate, curate bounded wiki/domain knowledge or an explicitly approved ADR. It does not change production code.

Use the installed `codebase-design` skill for the architecture vocabulary (**module**, **interface**, **implementation**, **depth**, **seam**, **adapter**, **leverage**, **locality**) and its principles (the deletion test, “the interface is the test surface,” “one adapter = hypothetical seam, two = real”). Use these terms exactly in every suggestion, and do not drift into “component,” “service,” “API,” or “boundary” for those meanings.

Read relevant domain-language and architecture pages in `.wiki/` when they exist. Use `wiki_references` when nearby context matters. Repository documentation, tests, ADRs, and maintainer instructions remain authoritative; do not re-litigate an ADR unless observed friction is strong enough to justify explicitly reopening it.

## Process

### 1. Explore

Snapshot `git status --short` before the survey. Preserve every pre-existing staged, unstaged, and untracked path; later comparisons distinguish survey-owned changes from operator-owned or concurrent work.

**Scope before you scan: YAGNI.** Deepening a module pays off by making future changes to it easier, so put extra weight on the parts of the codebase that have recently changed. Decide _where_ to look before you look:

- If the user named a direction—a module, subsystem, pain point, or incoming specification—take it and skip the inference below.
- Otherwise, walk back a good stretch of commit history (`git log --oneline`) to find the codebase’s hot spots: the files and areas that keep coming up. Let those paths pull your attention first. If the changes are scattered with no clear hot spot, widen the net.

Read the relevant domain language and governing ADRs before scanning.

Start one direct read-only Explorer subagent with a very thorough brief to walk the selected code. Give it the scope, hot spots, domain and ADR paths, complete deep-module vocabulary, and deletion test. Ask for evidence-backed candidate locations and observed friction, not interface proposals. Use a direct `agent` session; flat exploration does not need Pi Exec.

Explore organically and note where understanding creates friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow**, with an interface nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they are called—no **locality**?
- Where do tightly coupled modules leak across their seams?
- Which parts of the codebase are untested, or hard to test through their current interface?

Apply the **deletion test** to anything suspected of being shallow: would deleting it concentrate complexity, or just move it? Only candidates that concentrate complexity qualify for the report. `Speculative` means the payoff is uncertain; it does not admit a candidate that fails the deletion test.

The root verifies every candidate against current source and governing evidence. Reject unsupported claims and candidates that fail the deletion test. A valid survey may find zero candidates; report that result plainly instead of inventing a recommendation.

### 2. Present candidates as an HTML report

The root writes a fresh HTML file to the OS temp directory so nothing lands in the repository. Resolve the temp directory from `$TMPDIR`, falling back to `/tmp`, or `%TEMP%` on Windows. Write `<tmpdir>/architecture-review-<timestamp>.html` so every run gets a fresh file.

Open it for the user with the platform command (`xdg-open <path>` on Linux, `open <path>` on macOS, `start <path>` on Windows) and report the absolute path. If opening is unavailable, report the path without treating the report itself as failed.

Use Tailwind via CDN for layout and styling and Mermaid via CDN for diagrams where a graph, flow, or sequence communicates the structure reliably. Mix Mermaid with hand-crafted CSS and inline SVG visuals: Mermaid for graph-shaped relationships, hand-built visuals for mass diagrams, cross-sections, and call-graph collapse. Each candidate gets a **before/after visualization**. Be visual.

Keep secrets, source bodies, transcript content, and other private bytes out of the report. Summarize only the architecture evidence needed for the candidate cards. HTML-escape every repository-derived value before interpolation, and use quoted plain-text labels in Mermaid rather than raw source-derived syntax. Initialize Mermaid with `securityLevel: "strict"`. Opening the report loads third-party CDN scripts that can inspect the report DOM; keep private bytes out and treat that network effect as part of the chosen rendering. CDN rendering may fail in offline, SRI-enforced, or locked-down environments. When it is blocked, report that limitation and offer to rerender with inline CSS/SVG rather than claiming the rendered page was verified.

For every candidate, render a card with:

- **Files**: which files/modules are involved
- **Problem**: why the current architecture causes friction
- **Solution**: a plain-English description of what would change
- **Benefits**: locality, leverage, and how tests improve
- **Before / After diagram**: side by side, illustrating the shallowness and deepening
- **Dependency category**: `in-process`, `local-substitutable`, `ports & adapters`, or `mock`
- **Recommendation strength**: `Strong`, `Worth exploring`, or `Speculative`

When at least one candidate qualifies, end with a **Top recommendation**: which candidate to tackle first and why. When none qualifies, render an explicit no-candidate result and omit the recommendation card.

Use domain vocabulary for the subject and `codebase-design` vocabulary for the architecture. If an ADR conflicts with a candidate, surface it only when the observed friction warrants reconsideration and mark the conflict clearly.

Follow [the complete report format](references/html-report.md). Inspect the generated source for complete cards, supported claims, current paths, and safe escaping. Before presenting it, compare `git status --short` with the initial snapshot. The report phase owns no repository writes: report any unexpected change, preserve it, and never claim or revert it.

Do **not** propose detailed interfaces yet. When at least one candidate qualifies and the user did not request report-only mode, ask: **“Which of these would you like to explore?”** Then stop and wait. If none qualify, or the user requested report-only mode, finish after delivering the report and path.

### 3. Interrogate the selected candidate

Continue with one selected candidate per conversation. Use the installed `interrogate-to-design` skill for the design-tree/frontier interview and bounded knowledge curation. Keep this architecture-specific frame:

- constraints and dependencies;
- the shape of the deepened module;
- what belongs behind the seam;
- which tests survive through the interface; and
- which facts need exploration, research, or a prototype.

Ask the complete current frontier with recommendations, then stop and wait after every round. Finish only when the frontier is empty and the user confirms shared understanding.

Use `domain-modeling` when the design introduces or sharpens domain language or when an ADR may qualify. Update reusable `.wiki/` knowledge as it crystallizes, preserving source authority and keeping implementation specifications out of the wiki. Offer an ADR for a rejected candidate only when the load-bearing reason is durable enough that future surveys should not suggest it again; write it only after explicit approval.

When alternative interfaces need exploration, use `codebase-design` and its Design It Twice procedure.

After shared understanding is confirmed, hand the decision to `to-spec`. Do not implement the refactor, create tickets, or automatically file the unselected candidates.

## Finish

Report:

- the temporary report’s absolute path;
- the selected candidate and settled deepening decision, if one was explored;
- durable wiki or approved ADR paths changed;
- unresolved research or prototype hand-offs; and
- when a candidate was selected and settled, that the next build step is `to-spec`; otherwise, that no build handoff was created.

Compare final repository status with the initial snapshot. Attribute only the exact wiki or approved ADR paths changed by this workflow; preserve and report every other pre-existing or concurrent change.

This workflow does not authorize production-code changes, commits, publication, deployment, tracker mutation, or other external effects beyond writing and opening the temporary report and the bounded knowledge mutations described above.
