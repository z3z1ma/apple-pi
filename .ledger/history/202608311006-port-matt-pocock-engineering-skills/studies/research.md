# Research

Source: `mattpocock/skills` at `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`

Status: approved; implementation and targeted validation complete

## Target

Preserve upstream `research` as a small background-reading discipline: investigate a question through primary sources, cite every claim, and leave one Markdown artifact without blocking unrelated root work.

## Fidelity accounting

- The trigger and primary-source rule remain verbatim.
- Upstream's background agent maps to Apple Pi's direct, read-only `researcher` teammate.
- Because that teammate cannot write files, it returns cited findings and source identities to the root; the root writes the single Markdown artifact.
- The built-in teammate also lacks general MCP/fetch acquisition. For external research, the root supplies or binds readable primary-source material first. Missing evidence produces an explicit `Not verified` result rather than a memory-based answer.
- Existing repository note conventions retain precedence. Without one, bounded undertaking-specific findings go to an active ledger task and reusable supporting knowledge uses the `llm-wiki` procedure.
- The operator-approved parallel form permits several Researcher sessions only for genuinely independent areas. Their scopes remain distinct and the root reconciles them into the same single artifact.
- Flat research delegation uses direct `agent` sessions. Pi Exec remains available only when agents, tools, branching, or reduction form an actual composition graph.

No reference file or additional research framework is introduced.

## Validation

- Pi's real skill loader discovers `research` with no diagnostics and keeps model invocation enabled.
- The package dry run contains `skills/research/SKILL.md`.
- A source diff confirms the upstream trigger and primary-source rule remain intact; differences are limited to the read-only team handoff, root-owned source acquisition and ledger/wiki persistence, the explicit `Not verified` path, operator-approved parallel research, and the direct-agent/Pi-Exec boundary.
- `git diff --check` passes.
