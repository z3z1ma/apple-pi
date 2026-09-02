# Domain modeling

Source: `mattpocock/skills` at `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`

Status: approved; implemented and targeted validation complete

## Approved target

- Keep the upstream active, model-invoked discipline rather than making it an explicit-only workflow.
- Preserve a pure glossary as the persistent domain-language artifact.
- Translate root `CONTEXT.md` and `CONTEXT-MAP.md` into `.wiki/` pages using the shipped wiki contract and tools.
- Keep the upstream lazy single-context default and split into a context map plus context-specific glossaries only when real bounded contexts emerge.
- Update genuinely resolved terminology inline rather than batching all capture until the end.
- Keep ADRs in the repository's authoritative local convention and preserve system-wide versus context-specific ownership. If no convention exists, offer the upstream minimal sequential `docs/adr/` form for system decisions and `<context-root>/docs/adr/` for context decisions. Creating or revising an ADR still requires operator approval.

## Fidelity accounting

### Preserved upstream behavior

- Active modeling is distinct from merely consuming existing vocabulary.
- Existing glossary conflicts are surfaced immediately.
- Vague and overloaded language is sharpened into canonical terms.
- Concrete edge-case scenarios stress-test domain relationships and boundaries.
- Stated behavior is checked against code and contradictions are surfaced rather than silently resolved.
- Terms are captured as they crystallize.
- Glossaries remain free of specifications, scratch notes, implementation detail, and architectural decisions.
- Canonical terms, concise definitions, `_Avoid_` synonyms, domain-only inclusion, natural grouping, lazy file creation, single-/multi-context inference, and ambiguity questions are retained.
- Context maps retain context descriptions and relationships.
- The ADR gate retains all three upstream conditions: hard to reverse, surprising without context, and a real trade-off.
- Minimal ADRs, optional status/options/consequences, sequential numbering, and the complete upstream qualification examples are retained.

### Platform translations

- `CONTEXT.md` becomes `.wiki/pages/domain-language.md` by default.
- `CONTEXT-MAP.md` becomes `.wiki/pages/domain-contexts.md`; context pages default to `<context>-language.md`.
- Local `.wiki/README.md` conventions take precedence over default page names.
- Wiki orientation, globally unique case-insensitive slugs, `[[slug]]` links, `wiki_references`, `wiki_lint`, navigation updates, and mutation logging replace direct root-file mutation.
- Existing local ADR conventions take precedence over the upstream `docs/adr/` default.

### Deliberate Apple Pi additions

- Wiki material is treated as supporting context and checked against authoritative repository evidence.
- Code is current-behavior evidence rather than automatic authority over intended domain meaning.
- Wiki initialization and structural maintenance reuse the existing `llm-wiki` procedures.
- ADR writes require explicit operator approval and wiki pages may link to, but never replace or duplicate, authoritative ADRs.
- Failed and no-op wiki mutations do not receive successful log entries.

### Accidental loss

None accepted. Independent review found three material losses in the first draft: multi-context detection had been narrowed to terminology or ownership collisions, context-scoped ADR placement had disappeared, and strict glossary semantics had softened. All were restored before validation, including the context title and purpose, all competing `_Avoid_` terms, and the exact “what it is, not what it does” definition rule.

After the repository-wide porting rule was clarified, the final skill and both references were reset to the pinned upstream prose as their baseline. The remaining differences are limited to `.wiki/` layout, initialization, graph/lint/log discipline, and the explicitly approved authoritative ADR location and approval boundary.

## Validation

- Pi's real skill loader discovers `domain-modeling` with no diagnostics and keeps model invocation enabled.
- The package dry run contains `SKILL.md` and both consumed references.
- `git diff --check` passes.
- The repository package-loader test reaches only the intentionally stale future-catalog inventory assertion: its actual inventory now includes `domain-modeling` with the five fundamentals, while its expected inventory still names the not-yet-approved complete catalog.
