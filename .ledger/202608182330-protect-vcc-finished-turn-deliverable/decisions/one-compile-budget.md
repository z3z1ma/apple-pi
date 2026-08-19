Status: active
Created: 2026-08-18
Updated: 2026-08-18

# One compiled-artifact token budget

## Context

Compile used independent invented caps: 200/1200/4000 content words,
8×500-character result excerpts, 8 tool-call lines, 256-word users, and
a 120-line `capBrief` after TUI wrap. Those numbers were not derived from
the window. `capBrief` counted lines before wrap and after flatten, so it
did not even bind the thing it claimed to bind. Successive merges could
stick a huge prefix while the live tail starved.

## Decision

There is one cap: a token budget for the entire compiled artifact,
including merge. It is

`min(keep/10, dropped/10, leftover overhead)`

with a 512-token floor. Leftover overhead is half the reserved overhead
already subtracted when computing the keep suffix. The 1/10 ratio means
the index is an order of magnitude smaller than the live reconstruction
and than the prefix it replaces. Half of overhead is left unmeasured for
system, tools, and observational memory.

The unbudgeted brief keeps full user, assistant, and result text. Pack
pins errors, the first user, then newer users; remaining space fills
backward. Prose may clip to a tail. Results that do not fit are skipped
whole. `wrapLongLines` runs after pack and is not a second shear.

## Authority And Provenance

Operator: first-principles replacement of the arbitrary compile numbers.
Advisor (verified): do not spend overhead as the target budget; cap with
leftover overhead on large windows; do not delete the result category;
pack whole user/result/prose blocks, not wrapped lines.

## Alternatives Considered

- **New word/line constants (4000/1200/200, 8×500, 120 lines).** Same
  class of invention. Rejected.
- **Summary = overhead/2 as the only budget.** Ignores keep and dropped
  size; too large on a small compact, and still a fraction standing in
  for a measurement. Rejected as the sole rule; leftover overhead remains
  only the large-window ceiling.
- **Omit all successful results.** Path-only one-liners are not evidence.
  The operator already called dual result truncation trajectory-critical.
  Rejected.
- **Prefix-clip dumps to remaining space.** Usually keeps imports, not
  the finding. Skip if it does not fit. Rejected as a result policy.

## Consequences

- 200k window → ~6.7k token summaries. 1M window → 16k cap, not 47k.
- Merged summaries plateau instead of accumulating toward 169k characters.
- Recent small results stay intact. Giant reads drop from the prefix and
  remain in `session_search` / the filesystem.
- Header merge caps (8 goals, 15 turns) are unchanged.

## Limits And Revisit Conditions

Revisit if system+tools+OM can be measured at compile time (then leftover
overhead should be `overhead - measured` instead of `overhead/2`). Revisit
the 1/10 ratio if live sessions show the packed prefix still starving
continuation or still crowding the keep estimate.

## Related Records

- `specs/compiled-prefix-budget.md`
