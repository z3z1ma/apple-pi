# Advisor

Advisor runs a second model beside the main Pi session and reviews the work as it happens. It sees the implementing agent's trajectory, checks concrete suspicions with read-only tools, and inserts a short advisory when changing course would help. Most reviews should remain silent.

It is deliberately a sidecar rather than another worker. Advisor cannot edit files, run commands, answer the user, dispatch agents, or take ownership of the task. There is still one agent responsible for the implementation.

## Using it

Advisor is enabled by default. The choice persists across sessions.

```text
/advisor status
/advisor off
/advisor on
```

`/advisor status` reports the selected model, queued review work, lifetime input/output tokens, cost, and current private-context size. The footer shows the accumulated cost and changes from `Advisor` to `Advisor (reviewing)` while a review is in flight. If Advisor cannot start, the command and UI report the model-profile or authentication error instead of silently choosing another model.

## What an advisory means

The bundled review policy asks Advisor for at most one new finding per update and uses three severities:

| Severity | Meaning | Expected response |
| --- | --- | --- |
| `nit` | Optional cleanup, simplification, or a minor missed opportunity. | Take it when it is cheap and clearly better; otherwise continue. |
| `concern` | A material risk, missed constraint, fragile approach, or likely wrong direction. | Check it promptly against the code and the user's request. Fix it directly when valid. |
| `blocker` | Continuing is likely to waste substantial work or produce something fundamentally unsound. | Stop work on the flagged path until the claim is verified and resolved. |

The main agent receives a small protocol explaining this contract. Advisories are peer review, not commands: the agent verifies them, the user's direction remains authoritative, and an evidence-backed rejection is valid. Advisor does not send acknowledgements or “all clear” messages; silence means it found no actionable issue.

## How review delivery works

Each main-agent turn is projected into the private Advisor conversation. The projection includes user text, reasoning and response text, tool intent, successful edit diffs, errors, and compact receipts for tool results. Large observations and successful write bodies are omitted so routine tool output does not consume the review horizon. Receipts retain `call:<id>` addresses, allowing Advisor to recover an omitted result from the primary transcript when a finding depends on it.

Review runs asynchronously. Low-signal activity is batched until eight turns are pending or 15 seconds pass. User input, mutations, errors, commands, terminal answers, and held material findings cause Advisor to catch up sooner.

Delivery happens at safe agent-loop boundaries; Advisor never aborts the main model mid-turn.

- A nit is delivered at the next useful boundary and is marked as referring to an earlier step.
- A concern or blocker is held until a later review checks it against the newest work. Advisor re-raises findings that still apply and drops resolved ones by staying silent. This prevents a slow review from steering in advice the main agent has already handled.
- Before the main agent goes idle, Pi waits for the final review so a late blocker is not routinely lost after the answer. When a material finding is held, mid-run catch-up waits back off from 15 to 120 seconds; the final wait is capped at 120 seconds. Escape cancels the wait without discarding held advice.

If a terminal review times out or fails, confirmed status is unavailable. Material held findings are delivered best-effort with a visible notice; unconfirmed nits remain queued for a later review.

## What Advisor can inspect

Advisor's private session exposes only:

- `read`, `grep`, and `find` for the current working tree;
- `memory_source` for expanding a known observational-memory record;
- `session_search` for the primary session transcript and file-operation history;
- its private `advise` tool for returning a finding.

The recall tools are explicitly bound to the implementing session, never Advisor's own transcript. Advisor has no `bash`, `edit`, `write`, MCP, skills, prompt templates, or ambient package extensions.

## Context and continuity

Advisor keeps a private conversation so it can recognize the trajectory rather than reviewing every turn in isolation. Main-session compaction does not reset that conversation. Session start, tree navigation, and handoff create a fresh Advisor conversation seeded with the current observational-memory fold, recent user requests, the last eight implementing-agent turns, and settled prior advice.

When Advisor's own context compacts, it is reseeded from the live primary state instead of retaining an opaque historical summary as authority. A read-only copy of the primary observational-memory fold is inserted after compaction, while `memory_source` and `session_search` continue to resolve against the primary session. Advisor never runs its own observer, reflector, or curator and never writes memory entries. On xAI Responses models, its compact hook uses the same server-side compaction path described in [Context and memory](context.md#xai-server-side-compaction).

## Model and review guidance

Advisor always selects the user-global `deep` [model profile](model-profiles.md). The mapping lives in:

```text
~/.pi/agent/model-profiles.json
```

Projects cannot redefine that mapping. A missing, invalid, unavailable, or unauthenticated `deep` profile leaves Advisor visibly unavailable.

The bundled review prompt can be replaced with:

```text
~/.pi/agent/system-prompts/advisor.md
```

A trusted project may also provide `WATCHDOG.md` at its root. Its contents are appended as project-specific review priorities—for example, a subtle invariant or a recurring integration trap. Untrusted projects cannot add this guidance. `$PI_CODING_AGENT_DIR` replaces `~/.pi/agent` for user-global paths when configured.

## Cost and data boundary

Advisor makes separate model calls and therefore has separate latency and cost. Each call appends an identifier-and-usage record under `~/.pi/agent/sidecar-usage/`; see [Sidecar usage records](context.md#sidecar-usage-records). These records contain counters and model metadata, not transcript content.

The model provider does receive the projected session activity and any repository or transcript evidence Advisor chooses to inspect. A trusted `WATCHDOG.md` also becomes part of its system prompt. Do not enable Advisor with a provider that should not receive that material.

Advisor is the continuous second set of eyes during implementation. It complements normal validation and the operator-requested [review workflow](review.md); it does not replace either.
