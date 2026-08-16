Status: active
Created: 2026-08-16
Updated: 2026-08-16

# Review contract tolerance and harness-owned policy

## Purpose And Authority

This specification defines observable review behavior after removing raw caller resource arithmetic. ReviewController remains the authority for sealing input, grouping, role dispatch, policy derivation, receipts, terminal state, and stop quiescence.

RFC 2119 terms are normative.

## Actors And Boundaries

- The main model requests a review source, root, profile, and optional behavioral background.
- The human may use the same semantic profile through `/review`; normal command UX does not expose resource arithmetic.
- Planner, reviewer, and verifier return structured semantic output; they do not set execution budgets.
- The controller derives and enforces policy after input sealing.
- Ralph consumes ReviewController's resolved policy and outcome; it does not pass nested raw arithmetic.

## Required Behavior

### Typed structured output

- Every planner, reviewer, and verifier session MUST receive one controller-supplied terminating result tool with a TypeBox signature matching that role's structured contract. The agent MUST submit its final result through that tool, not prose JSON.
- `ManagedAgentRequest` MUST carry controller-supplied custom tools through managed spawn/run options to `createAgentSession({ customTools })`. When the role has `extensions: false`, those custom tool names MUST also be admitted by the static session allowlist.
- The controller MUST consume only the captured, schema-validated terminating tool arguments. It MUST fail closed with invalid-output cause if the result tool is not called, is called more than once, or conflicts with the agent lifecycle. It MUST NOT parse or fall back to `record.result` prose.
- Empty optional collection fields MUST normalize to empty arrays when omitted from valid tool arguments: planner `contextPaths`, reviewer `findings` and `residualRisk`, verifier `residualRisk`.
- Required coverage fields remain required in the tool signature: planner groups and each group's id/title/objective/itemIds/tier/rationale; reviewer summary/reviewedItemIds; verifier decisions for supplied findings.
- An omitted optional field MUST produce the same canonical captured value as an explicit empty array.
- Malformed tool arguments, missing required fields, unknown IDs, duplicate coverage, unsafe paths, or invalid enum values MUST fail closed with an explicit invalid-output cause. There is no prose-output repair or retry pass.

### Policy derivation and public interface

- The normal `review` tool and `/review run` command MUST accept source/root/profile/background/routing intent only. They MUST NOT advertise or parse raw numeric resource fields.
- `fast`, `balanced`, and `thorough` retain their documented routing meanings and additionally select a controller policy tier. Sealed selected-item count, diff bytes, binary waiver count, and profile MAY determine group/concurrency caps, but MUST NOT alone determine a role's token, turn, elapsed-time, or prompt envelope.
- Before each planner, reviewer, or verifier role launches, the controller MUST resolve its route, render the exact role prompt and typed result-tool signature, and measure every rendered input: sealed manifest/diffs, task or Ralph authority packet, behavioral background, group focus/context paths, and candidate findings.
- The controller MUST derive that role's envelope from those measured prompt inputs, the resolved model's context window and output capacity, the selected profile, remaining run safety capacity, and package maxima. It MUST reserve output capacity before launch and fail before model execution when the rendered prompt cannot fit safely.
- The derived run policy MUST bound maximum semantic groups, review concurrency, rendered prompt bytes, lifetime tokens, elapsed time, and per-role turn ceilings below package safety maxima. Derived group/concurrency controls remain change-shape based; prompt and role controls are stage-aware.
- A small two-file review MUST receive policy sufficient for planner, reviewer, and verifier completion without a caller estimating arithmetic. A tiny diff with broad authority/background/dependency context MUST receive a measured safe envelope or an explicit preflight policy/input failure, never an undersized guess.
- The run and receipt MUST record policy identity/version, per-stage measured prompt/capacity envelope, resolved limits, and terminal cause; model result text MAY report compact usage and terminal cause but not require callers to interpret limits to use review.

### Outcome causes and efficiency

- Every terminal non-successful run MUST carry a typed cause independent of display text.
- Operator stop and external cancellation are distinct from elapsed-time, aggregate-token, role-turn, compaction, provider, invalid-output, authority, and workspace/input causes.
- A planner invalid-output failure MUST report zero coverage and the exact parser reason without retrying or launching review roles.
- Reviewer/verifier work remains fresh and read-only. Verification remains conservative, but the controller MUST launch at most one verifier per finding-bearing semantic group and MUST NOT launch a verifier for an empty finding set.
- The resolved policy and routing are selected before role dispatch; no model-generated group count or agent status may widen limits.

## Error And Failure Behavior

- If any rendered role prompt plus required output reserve exceeds its resolved model context capacity or package ceiling, fail before that model execution with the typed policy/input cause and compact measured prompt/capacity reason.
- If a role reaches a controller-enforced ceiling, record the specific ceiling cause and incomplete coverage; never manufacture success.
- If a role returns `aborted`, `steered`, or `stopped`, classify it using the controlling signal/gate and role lifecycle evidence, not status text alone.
- Existing persisted review schema-v1 receipts without policy/cause fields remain readable. No old receipt is resumed with inferred policy.

## Given-When-Then Scenarios

- Given a planner submits the observed group through its typed result tool with no `contextPaths`, when the controller captures it, then it produces a group with `contextPaths: []` and the reviewer launches.
- Given a reviewer finds no defects and omits optional findings/risk lists in its typed result tool call, when captured, then coverage continues with empty lists.
- Given a two-file workspace change under `balanced`, when review runs, then the controller derives and records a policy plus measured planner/reviewer/verifier envelopes and completes work without a budget field in the tool call.
- Given a tiny diff with a large Ralph authority packet or behavioral background, when a role prompt is rendered, then the controller derives that role's envelope from the measured complete prompt and resolved model capacity rather than diff bytes alone.
- Given an external cancellation during route resolution, when no role starts, then the final cause is external cancellation rather than a turn or token ceiling.
- Given the controller reaches its aggregate token ceiling, when active roles settle, then the receipt has aggregate-token cause and incomplete coverage.

## Acceptance Mapping

- AC-001: normal model schemas remove numeric arithmetic.
- AC-002 and AC-006: deterministic sealed-input policy and scaling tests.
- AC-005: typed causes across controller, receipt, and rendering.
- AC-007: additive receipt compatibility.
- AC-008 and AC-009: command, docs, and test reconciliation.

## Exclusions

- Trusted config overrides, provider billing guarantees, retries of invalid model output, and changing semantic review profiles.
- Ralph, Agent, and Pi Exec implementation details beyond shared policy/cause vocabulary; their dedicated specifications follow the verified review core.

## Assumptions And Provenance

- User-ratified: models should not configure execution budgets.
- Decision-backed: `.ledger/202608151813-replace-caller-budget-arithmetic/decisions/ownership.md`.
- Research-backed: the 2026-08-16 live planner omitted optional `contextPaths`, causing a deterministic full review failure.

## Related Records

- `.ledger/202608151813-replace-caller-budget-arithmetic/decisions/ownership.md`
- `.ledger/202608151813-replace-caller-budget-arithmetic/research/live-review-smoke.md`
