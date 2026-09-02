# Codebase design

Source: `mattpocock/skills` at `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`

Status: approved; implementation and targeted validation complete

## Target

Adopt upstream `codebase-design` literally. The skill is read by a fresh model in an unknown repository. Apple Pi's own source-tree nouns and conventions do not alter the skill's architecture vocabulary or doctrine.

## Fidelity accounting

The user-approved package layout keeps progressive material under `references/`:

- `SKILL.md` differs from upstream only in its two reference link targets.
- `references/deepening.md` preserves upstream prose verbatim and changes only the relative link back to `SKILL.md`.
- `references/design-it-twice.md` preserves the complete upstream process, prompts, output contract, comparison criteria, and recommendation step.

The only behavioral translations in `design-it-twice.md` are:

1. The upstream flat fan-out uses 3+ direct background `agent` sessions. Every session starts before the root waits for results. Pi Exec is not involved.
2. `CONTEXT.md` vocabulary becomes the relevant domain-language vocabulary from `.wiki/` when such a glossary is present.

No ledger artifact is introduced because upstream creates none. No vocabulary, principle, dependency category, testing rule, example, rejected framing, or design variant was softened or removed.

## Validation

- Pi's real skill loader discovers `codebase-design` with no diagnostics and keeps model invocation enabled.
- Every local Markdown reference resolves from its final path.
- The package dry run contains `SKILL.md` plus both files under `references/`, and omits their former root paths.
- A source diff confirms the only upstream differences are reference paths, direct background `agent` invocation, and the optional `.wiki/` domain-language translation described above.
- No Pi Exec wording remains in the skill.
- `git diff --check` passes.
