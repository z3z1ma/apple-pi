Status: complete
Created: 2026-08-31
Updated: 2026-08-31

# Retrospective

## What Mattered

The useful boundary was a small ambient contract plus deterministic read-only tools. Markdown remains the only graph authority, while the skill owns mutation procedures through progressive disclosure. Distribution had to be tested by execution role, not inferred from an extension path appearing in a shared list.

## Learnings

- A worker extension is ineffective when its tools are absent from the worker's explicit `--tools` allowlist.
- Public read-only child roles follow a narrower extension branch than mutation-capable children; both branches need explicit context-workbench coverage.
- Obsidian references need semantic classification: Markdown page embeds are graph edges, non-Markdown attachments are not, and empty fragments must not silently validate.
- Code-example exclusion, frontmatter, symlink boundaries, and scan-time substitution are product behavior for a repository knowledge graph, not parser trivia.

## Improvements

For future context-workbench additions, test the effective prompt and tool surface in every execution role, including narrow read-only branches and explicit internal opt-outs. Review parser semantics against representative Markdown containers and invalid syntax before relying on a small happy-path fixture.
