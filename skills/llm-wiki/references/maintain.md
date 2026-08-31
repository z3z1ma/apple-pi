# Maintain the Wiki

Use this procedure for linting, impact analysis, renames, moves, reorganization, and repair.

## Read-Only Report Phase

1. Orient from `README.md`, `INDEX.md`, and relevant recent `LOG.md` entries.
2. Run `wiki_lint` for deterministic graph integrity:
   - duplicate case-insensitive filename-stem slugs;
   - unresolved or ambiguous Obsidian page links;
   - missing referenced headings; and
   - unsafe symlink paths.
3. Use `wiki_references` for inbound impact before renaming, moving, merging, or retiring a page, and for first-/second-order context when judging overlap or contradictions.
4. Review proportionally for semantic and organizational issues such as:
   - useful pages absent from navigation;
   - duplicate or overlapping knowledge;
   - hidden or inconsistently represented contradiction and uncertainty;
   - claims whose stated support cannot be found or recovered;
   - stale claims, dead source references, or misleading organization;
   - orphaned knowledge that should be connected, merged, archived, or promoted; and
   - local conventions that no longer match actual use.
5. Separate deterministic findings from semantic hypotheses and cite path-specific evidence.
6. Do not write fixes, caches, reports, logs, or Git changes during the report phase.

Do not impose mandatory snapshots, link density, frontmatter, fixed taxonomies, or artificial completeness rules.

## Authorized Fix Phase

An explicit initial request to **lint and fix**, rename, reorganize, or repair authorizes the corresponding bounded mutation phase. Otherwise report findings and offer fixes first.

When fixing:

1. Read inbound references before changing a page slug or heading.
2. Apply the smallest coherent set of page and link edits. A move that preserves the filename stem does not change the slug; a rename does.
3. Keep `INDEX.md` accurate only when navigation changed.
4. Run `wiki_lint` after the edits and resolve newly introduced findings.
5. Append `LOG.md` only after the intended repair is coherent.
6. Report every changed path and any remaining findings.

If `.wiki/` is absent, report that fact and offer initialization. Missing canonical artifacts are findings, not permission to invent replacements.
