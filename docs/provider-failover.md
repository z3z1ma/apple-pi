# Failure-only provider recovery

After a recognized quota or spend failure, ordinary root sessions select a model from a different provider in the role's existing user-global [model profile](model-profiles.md), then attempt to continue the retained conversation. Healthy models and thinking levels stay unchanged. This is an apple-pi extension using the installed Pi APIs: no custom Pi build, opt-in flag, second catalog or startup balancing is required.

The extension is active when loaded. Normal extension reload or a new session loads changed code; changing global settings or restarting the session-state daemon is unnecessary. The extension writes no configuration and changes no billing settings.

## Destination policy

Recovery resolves the existing global profile only after an eligible failure:

- A recorded role uses the leading workload profile in its model list. This is current workload suitability, not recovered historical provenance.
- An unroled root uses `coordination`.
- An unresolved role, concrete-only role or missing/invalid profile stops recovery with a diagnostic rather than guessing another workload.

Candidates stay in configured order, even when startup selection is random or round-robin. Recovery consumes no startup rotation counter. It considers registered models with configured authentication, excludes xAI and virtual-model destinations, and requires image support when retained or pending messages contain images. Configured auth is eligibility metadata, not evidence of quota or endpoint health. A same-provider-only profile has no fallback.

After an uninterrupted selection, the extension applies the configured thinking level, subject to Pi's capability clamping. A late commit after interruption stops before that effort step: it keeps Pi's switch-time thinking level, which can differ from the profile. The committed model/effort combination stays selected for subsequent work and becomes a roled person's retained mind across reopen, including when continuation stops after the model change. There is no automatic promotion back. Normal saved-mind restoration still refuses an unavailable model/auth rather than silently selecting another provider.

## Recognized terminal signals

These are source-qualified rules, not a promise to recognize every account variant. The failed assistant message's provider and model must still match the current physical selection.

| Provider | Eligible signal |
| --- | --- |
| `openai` | A JSON error whose `code` is exactly `subscription_sharing_usage_limit_exceeded`, `credit_balance_exhausted`, `organization_spend_limit_exceeded`, `project_spend_limit_exceeded`, or `organization_usage_limit_exceeded`, in an error object or flat body. |
| `anthropic` | A JSON error with `type: "rate_limit_error"` and `details.error_code: "enforced_spend_limit_reached"`. |
| `antigravity` | The complete adapter message: `Quota reached.` followed by an optional `Please wait ….` sentence and `Next: switch models or try again after reset.` or `Next: switch models or retry later.` |
| `xai` | No verified terminal signal is enabled; OpenAI-shaped errors do not inherit OpenAI semantics. |

JSON parsing accepts an optional HTTP status, OpenAI's `OpenAI API error (429):` wrapper and its exact appended usage-settings hint. Supplied HTTP wrappers/status fields must be429; conflicting statuses, malformed bodies and explicit authentication, permission or invalid-request types refuse recovery.

Generic `insufficient_quota`, generic429/rate-limit text, `RESOURCE_EXHAUSTED`, bare quota phrases and ambiguous subscription errors remain outside this cross-provider policy. OpenAI's workplace-individual usage limit is an administrator boundary. Claude subscription exhaustion has no verified contract here. Ordinary transient retry remains Pi's responsibility.

Sources: [OpenAI error codes](https://developers.openai.com/api/docs/guides/error-codes), [Anthropic rate limits](https://platform.claude.com/docs/en/api/rate-limits), Pi1.4.0's OpenAI adapter/retry code, and `pi-antigravity` v0.11.0 commit3870729 terminal templates. Adapter templates and offline fixtures do not establish live account health or every subscription contract.

## Selection versus automatic continuation

The awaited `turn_end` hook calls the ordinary `pi.setModel` before native retry or compaction, then applies the candidate's effort. Only the failed assistant entry is omitted from projected context through an append-only context edit. Raw failure history and completed assistant/tool results remain. The extension replays neither the original prompt nor completed tool calls.

Continuation follows the installed Pi retry classifier:

| Recognized failure shape | Owner of the next request under default retry settings |
| --- | --- |
| OpenAI shared subscription limit, including its429 wrapper | Extension requests one native continuation at final settlement. |
| Complete Antigravity quota template | Extension requests one native continuation at final settlement. |
| OpenAI credit/spend/organization-usage codes in a429 wrapper | Native retry makes the next request on the selected replacement. |
| Anthropic enforced spend error (`rate_limit_error`) | Native retry makes the next request on the selected replacement. |

Recovery mirrors Pi's retry predicate: exclude `isContextOverflow` first, then use the exported `isRetryableAssistantError`. Wrapper and overflow wording can affect the distinction. A recognized JSON code without retryable text uses the extension's settlement continuation instead. Tests exercise the concrete shapes above with the installed SDK and default retry settings.

**If native retry is disabled, its budget was already exhausted, or its countdown is cancelled, a retryable failure can leave the replacement selected but waiting for another user turn.** The extension deliberately adds no settlement continuation for these failures: the installed extension API does not expose retry-cancel events, so such a vote could revive cancelled work. Selection alone is not successful continuation.

One episode spans retries/tool turns until settlement. Each configured distinct provider is selected at most once per episode. Any following assistant reply clears the pending marker before classification, preventing an extra request after native retry. Exhausting eligible providers stops with a diagnostic. Notifications and `provider-failover` metadata entries report selection, not provider success; they are not model-visible user messages.

## Cancellation and manual-choice limits

The extension checks the active signal, episode identity, selected model, effort and retained context before continuing. Observed manual model/effort changes and lifecycle changes interrupt recovery; a later handler can revoke an already-returned settlement vote through `ctx.abort()`.

**The installed `pi.setModel` awaits authentication and then commits without a conditional guard or cancellation parameter.** A cancellation or newer manual choice during that wait can still be followed by a late automatic model change. The extension suppresses its own continuation when it observes interruption, but cannot promise to preserve the newer physical selection. Same-value requests and some nested/equal-target changes are not distinguishable from its own setter events. No compensating setter tries to restore an earlier model: that could overwrite a still-newer choice or fail authentication again. A late committed replacement may also become the retained mind.

These checks are best effort, not an atomic model/continuation transaction or an exactly-once external-effect guarantee. Already transmitted work cannot be undone.

## Execution scope and verification limits

Ordinary root TUI/RPC/print sessions, including colleague turns in lasting people, use their role's normal workload pool. All `PI_PROGRAM_ID` processes are excluded, including temporary peers and captured-review forks, so captured policy/effort/accounting is preserved. Internal forked continuations skip without resetting parent state. Interns, the pair sidecar and `/btw` do not load this extension.

Independent compaction failures, including pre-prompt compaction before an assistant error, remain outside this recovery hook and retain fail-closed behavior. Virtual routing stays with Pi.

Focused offline tests use real installed Pi setters, history, boundaries and retry behavior with synthetic models/transports. They cover actual replacement-provider dispatch under default retries, disabled/exhausted/cancelled retry pauses, healthy-mind preservation, role eligibility, provider bounds, raw failure retention and the auth-wait late-selection limitation. No paid provider quota probe, live account contract or universal TUI/host-version guarantee is claimed.
