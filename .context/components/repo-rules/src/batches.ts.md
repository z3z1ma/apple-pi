## file

The matcher consumes the complete assistant batch before any call executes. A same-path observer is refused even if its writer will later fail; all writers of one path are refused, rather than choosing a winner by execution order. Read/write/edit paths use the existing Pi path resolver; a malformed sibling path is unmatchable and its own tool reports the error. Shell arguments use cwd-relative lexical paths, not that resolver's @ and file-URL conventions.
Why: the protocol prevents ambiguous parallel dependencies without serializing calls or trusting successful completion of sibling edits.

Shell matching is deliberately a literal-argument heuristic. `shellWord` owns quote/escape decoding; `shellPaths` owns command-position and directory-change recognition. Only ASCII shell separators split unquoted words, adjacent quoted segments concatenate, and single/double quotes preserve their distinct escape rules. Equals signs and leading dashes remain literal operands; command-position assignments are skipped. It skips commands with expansion, substitutions, heredocs, line continuations, unsupported compound syntax or cd away from cwd. It can refuse a harmless literal mention and miss indirect dependencies, globs, symlink aliases and nested calls. These limits are part of the operator's adoption decision, not a security boundary.

The candidate's recorded-batch scan imports this production matcher. Retained results contain only occurrence metadata and repository-relative paths; the root authorized raw transcript reads for that scan, not copying private messages or payloads into the repository.
Coupled: components/repo-rules/src/index.ts, docs/repo-rules.md
Verify: components/repo-rules/tests/batches.test.ts
