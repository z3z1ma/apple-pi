Status: pending
Created: 2026-11-02
Updated: 2026-11-03

# Retrospective

## What Mattered

- The operator redirected repo machinery into harness capabilities twice (rules, then TLA+). The skill-link loader check now enforces the second correction.

## Learnings

- For bulk comment removal, obtain exact parser-derived comment slices with `JSON.stringify` and verify each edit anchor occurs once. Include the following line for repeated labels or blank `//` lines. Retyped separators and non-ASCII punctuation caused failed atomic edit batches; the comment checker also catches leftover blank comments. Recheck the file after a failed batch before retrying.

- For comment-only migrations, check exact emitted-JS equality before applying deletions, then compare parsed emitted-JS syntax and literal values after formatting. TypeScript retains some original line breaks in its output: Workplace's empty catch and wrapped method chain produced byte differences after Biome without syntax changes. Inspect such exceptions and preserve directive comments separately; stripping all whitespace can hide meaningful changes.

## Improvements

- Classify each new capability as harness or repo at design time, and build its native options before reporting limits.
