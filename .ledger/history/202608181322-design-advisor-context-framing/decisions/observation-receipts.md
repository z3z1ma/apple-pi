Status: active
Created: 2026-08-18
Updated: 2026-08-18

# Advisor results are observation receipts, not line counts or raw bodies

## Context

`decisions/lean-trajectory-deltas.md` kept thinking, text, and arguments, then
split results into an exploratory blacklist (body replaced by a line count), a
40-line / 2,000-character truncate bucket, and never-truncated successful edit
diffs. That was the right *direction* — do not copy the primary token bill —
and the wrong *receipt*. Line count says a payload existed. The advisor needs
the trajectory of what was sought and what changed.

Operator correction after a broader implementation/literature survey: the
advisor should receive a purpose-built projection. v1 is deterministic
tool-specific reducers compiled from Pi args, result text, and `details`.
Scout selection, LLM summarizers, a second evidence store, and a typed IR
compiler stay out.

## Decision

Supersede the result-body rules in `lean-trajectory-deltas.md`. The rest of
that decision stays: thinking / text / arguments / status stay verbatim;
successful edit diffs stay whole; successful `write` omits `content`; coalescing
classifies from the raw event; do not add a second tool-result store. Omitted
bodies recover through `session_search` `call:<id>` or live `read` / `grep` /
`find`.

Every pushed delta MUST still include thinking, assistant text, every tool
name and arguments, and success / error plus exit code when present.

Result bodies MUST be compiled as follows:

1. **`grep` (success).** Keep match count, file count, `file: line, line`
   loci, and truncation flags from `details` or Pi notices. MUST NOT keep
   matching source text or context lines. Query, path, glob, and flags stay
   on the existing argument rendering; do not duplicate them in the receipt.
2. **`read` (success).** Keep requested range when `offset` / `limit` were
   passed, returned range when it can be recovered from `details` or the
   continuation notice, line and byte counts of what came back, and
   truncation flags. MUST NOT keep the file body. Image reads keep the short
   `Read image file […]` note.
3. **`find` / `ls` (success).** Keep the entry/path count, truncation /
   limit-reached flags, and at most the first 20 names. MUST NOT dump the
   default 1000/500 listing.
4. **`bash` (success).** Tiny receipt: line and byte counts plus truncation
   flags. MUST NOT keep the output body. MUST NOT invent duration (it is not
   on bash `details`). MUST NOT classify test-runner output.
5. **`bash` (error) and user-bash failure.** Same counts and flags, plus a
   tail of at most 20 lines or 1,500 characters, whichever is hit first from
   the end.
6. **Successful edit.** Unchanged: compact call header plus the full
   line-numbered `details.diff`.
7. **Successful `write`.** Compact call header: path, line/byte counts of
   the attempted content, and `content omitted`. MUST NOT keep `content`
   in the arguments. The file is on disk after success. The result body
   stays Pi's raw receipt.
8. **Failed `write`.** Keep path and a truncated attempted `content`
   (same 40-line / 2,000-character cap) plus the error text.
9. **Other successful tools, and non-bash errors.** Existing truncate cap
   (40 lines or 2,000 characters). Failed `read` / `grep` / `find` / `ls`
   keep that truncated error text rather than a success receipt.

Every projected tool result MUST start with `call: <toolCallId>` when the
result carries one. That address resolves through primary-bound
`session_search` query `call:<id>` against the persisted primary tool
result. It is not a second store.

Unknown and extension-injected tools stay in the truncate bucket.

Transport stays seed-once-then-append. This decision changes the projection
inside each delta, not the session/compaction machine.

## Authority And Provenance

Operator, 2026-08-18, directing immediate implementation of the survey in
`research/observation-projection.md`. v1 scope confirmed against that survey:
deterministic receipts only; no Scout, evidence handles, or typed IR.

## Alternatives Considered

**Keep line-count omit.** Steelman: one rule, smallest exploratory payload,
bodies are re-fetchable. Rejected: the advisor cannot see what was searched
or which files/lines were hit, which is the review-relevant signal.

**Dump full `find` / `ls` listings because they are already path receipts.**
Steelman: names are the result, not a file body. Rejected: defaults are
500–1000 rows. Count plus a short name cap is the receipt; the advisor can
re-run the tool if it needs another name.

**Add `expand_observation` / a reversible evidence store.** Steelman: then
no omit is irreversible. Rejected for v1: a second store was already
rejected, and the advisor already has `read` / `grep` / `find`. Revisit only
with an explicit store/privacy design.

**Scout or Squeez-style compressor before the frontier advisor.** Steelman:
task-conditioned verbatim spans beat any global heuristic. Rejected for v1:
extra model call, extra failure mode, and Complexity Trap evidence favors
simple observation masking first.

**Bash test-runner heuristic (all-green tiny, FAIL names + stacks).**
Steelman: verification deserves asymmetric treatment. Rejected for v1: no
stable schema, easy to misfire. Failure tail covers the useful case without
a classifier.

**Rewrite the advisor onto a typed IR and stop using deltas.** Steelman:
VCC-style consumer views are the clean architecture. Rejected for this
increment: deltas are transport; receipts are the view. Changing the
runtime abstraction is a different task.

## Consequences

- `formatTurnDelta` / `formatActiveSessionContext` compile receipts from
  existing messages. They do not persist omitted payloads. `call:<id>` looks
  up the primary session tool result.
- Successful bash no longer shows a 40-line prefix. Failure still has a tail.
- Existing tests that expect `N lines omitted` or a truncated successful
  bash body must change with the contract.
- Critique-preservation versus a full-transcript advisor remains unmeasured.

## Limits And Revisit Conditions

- Do not truncate or omit successful edit diffs without a new operator
  decision.
- Do not add Scout, LLM summarizers, evidence handles, or sparse invocation
  under this decision.
- Revisit the 20-name and bash-tail knobs after sidecar usage exists.
- Revisit a bash verification classifier only with a stable, tested signal.
- Revisit an evidence store only with storage, privacy, and recovery design.

## Related Records

- `research/observation-projection.md`
- `decisions/lean-trajectory-deltas.md` (superseded for result bodies)
- `specs/advisor-context-frame.md`
- `decisions/advisor-is-a-regular-session.md`
