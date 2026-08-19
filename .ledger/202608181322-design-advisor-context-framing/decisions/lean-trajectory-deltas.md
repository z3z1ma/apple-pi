Status: superseded
Created: 2026-08-18
Updated: 2026-08-18

# Advisor deltas keep inputs; result bodies are blacklisted or truncated

Superseded by `decisions/observation-receipts.md` for result-body policy. Thinking, arguments, edit-diff, write-vs-edit, and no-second-store rules remain in force via that record.

## Context

The live advisor conversation is meant to stay cheap relative to the primary. Most of a primary turn's tokens are tool-result bodies used to corroborate a trajectory the advisor can already see from thinking, assistant text, tool names, arguments, and success or failure.

Today `formatTurnDelta` keeps thinking, text, and arguments, then also appends every tool-result body with an explicit no-truncation rule. That is one-to-one context consumption with the base conversation.

Same-session corrections: first "omit named exploration bodies," then "omit every body except edit, bash undecided." The operator then asked for a hybrid: a blacklist of known exploratory tools whose output is fully dropped (with a line count), truncated output for every other tool, and edit never truncated. Exit codes and status always stay. That is this decision.

The operator asked whether lean deltas are already in place. They are not.

## Decision

Amend the framing spec's delta contract. Do not keep "unchanged `formatTurnDelta` content."

Every pushed delta MUST include thinking, assistant text, every tool call's name and arguments (existing verbatim-arg rendering, including failed-edit `{oldText,newText}`), and success or error plus exit code when the result carries one.

Result bodies then follow three rules, by tool:

1. **Exploratory blacklist — body fully omitted.** Initial names: `read`, `grep`, `find`, `ls`. Show arguments, status, exit code, and a line count of the omitted body (for example `412 lines omitted`). No payload. The list is a named blacklist, not a closed forever set; add a tool when its result is known exploration payload.
2. **All other tools — body truncated.** Bash, `write`, extension-injected tools, MCP, and anything not on the blacklist or edit. Keep a short prefix of the result. Starting cap: 40 lines or 2,000 characters, whichever is hit first, then a marker that it was truncated. Cap is a starting knob, not measured.
3. **Edit — never truncated.** Successful edit keeps today's compact header (path + block count) and the full line-numbered diff. Failed edit keeps attempted arguments plus error text.

**Write is not in that exception.** Verified against Pi's `write` / `edit` tools (`pi-coding-agent` `dist/core/tools/write.js`, `edit.js`):

- `write` args are `{ path, content }`. Success result is only `Successfully wrote ${content.length} bytes to ${path}` (`details: undefined`). The file is the input; the result is a receipt. Full-output treatment would not add the file.
- `edit` args are `{ path, edits: [{ oldText, newText }] }`. Success result is a short status line plus `details.diff` / `details.patch` — a computed line-numbered diff of what landed on disk. That is not the input. It stays whole.

`write` stays in the truncate bucket. In practice its result is already one line.

The blacklist is name-based on purpose. Unknown or injected tools fall through to truncated, not to silent full omit.

Do not add a second "fetch the omitted tool result" store. Recovery is the advisor's existing tools plus primary-bound `session_search` / `memory_source`.

## Authority And Provenance

Operator, same design session, after the inputs-only pass: blacklist known exploratory tools (full omit, maybe a line count); truncate everything else; never truncate edit; always keep exit codes. Neutral-on-bash is closed by putting bash in the truncate bucket.

## Alternatives Considered

**Keep today's verbatim results (status quo).** Steelman: the advisor sees exactly what the primary saw. Rejected: that is the 1:1 bill.

**Omit every result body except edit.** Steelman: one rule, no name list, extensions cannot sneak a payload through. Rejected as too blunt: bash and other tools often have a useful short result; the operator wants a glimpse, not a hole.

**Omit only when the result is re-fetchable.** Steelman: keeps ephemeral bash/MCP. Rejected as the classifier: the operator asked for a known exploratory blacklist plus truncate-by-default.

**Truncate every tool, including read/grep and edit.** Steelman: no list to maintain; edit diffs just get clipped. Rejected: exploratory bodies are the bulk and are re-doable; edit diffs must stay whole so the advisor can nitpick a bad change.

**Adopt a bash-specific policy.** Steelman: bash is the other large payload. Not needed: bash is an ordinary truncated tool until evidence says otherwise.

**Give `write` the same never-truncate treatment as `edit`.** Steelman: writes are the other mutation. Rejected after reading the tools: write content is already in the arguments; the result is a byte-count receipt, not a second copy of the file.

## Consequences

- Advisor context growth tracks thinking, text, calls, args, status, truncated non-exploratory results, and full edit diffs.
- An unknown extension tool is truncated, not dropped. A new exploratory tool that is not added to the blacklist will leak payload until listed.
- Coalescing still classifies write/edit/error/bash/user from the *raw* event.
- Existing `formatTurnDelta` tests that require full result bodies and "no truncation" will have to change with the implementation. That is a contract change, not oracle weakening.
- Argument rendering (real newlines, no `JSON.stringify` escaping) is unchanged.

## Limits And Revisit Conditions

- Do not truncate or omit successful edit diffs without a new operator decision.
- Revisit the exploratory blacklist when a new high-volume read-like tool shows up (including injected ones).
- Revisit the 40-line / 2,000-character truncate cap after sidecar usage exists.
- Do not restore verbatim exploratory bodies without a new operator decision.

## Related Records

- `specs/advisor-context-frame.md`
- `knowledge/conversation-not-a-frame-machine.md`
- `.ledger/202608181322-coalesce-advisor-reviews/specs/advisor-review-coalescing.md`
