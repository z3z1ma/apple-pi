# Failure-only provider recovery

Provider failover is an opt-in harness capability for continuing an existing root session after a narrowly recognized terminal provider failure. It leaves healthy physical models and thinking levels unchanged. It uses the existing user-global [model profiles](model-profiles.md), rather than another model catalog or virtual-model enrollment.

## Native prerequisite and permission

**Stock Pi 1.4.0 does not expose the required `setModelIfUnchanged` extension action.** The matching-release native source patch and offline SDK controls establish a source implementation, not a released, installed or activated dependency. A compatible build must provide the guarded action and make cancellation of an active native retry end that logical run, so settlement hooks cannot revive it. The isolated patch includes both. A separately approved Pi distribution must provide those semantics before automatic recovery can run; the method-presence probe detects absence, not semantic correctness. Package installation, live CLI changes and restarts are separate operator decisions.

After that prerequisite is available, the operator can opt in through the global Pi `settings.json`:

```json
{
  "providerFailover": true
}
```

The default is `false`. The file lives under `getAgentDir()`—normally `~/.pi/agent/`, or the directory selected by `PI_CODING_AGENT_DIR`. The value must be a boolean. Project settings cannot enable this feature. Changes apply at session start or reload; setting it to `false` and reloading disables future recovery.

Enabling the setting on a Pi build without the native action produces a visible warning and disables this feature, while ordinary sessions continue normally. Invalid configuration also disables the feature with a diagnostic. Neither case changes the selected model or starts replacement inference. The extension writes no configuration, starts no daemon and changes no billing settings.

## Destination policy

At the first eligible failure, recovery snapshots the appropriate existing global profile:

- A recorded role uses the leading workload profile in that role's model list. This is current workload suitability, not a claim to recover historical profile provenance.
- An unroled root uses `coordination`.
- An unresolved role, a concrete-only role, or a missing/invalid profile stops recovery with a diagnostic instead of guessing another workload.

Candidates stay in configured order, even when the profile's startup selection is random or round-robin. Recovery consumes no startup rotation counter. It considers registered models with configured authentication, excludes xAI and virtual-model destinations, and requires image support when retained or pending messages contain images. Configured auth is eligibility metadata, not evidence of remaining quota or provider health.

Each destination uses its profile's thinking level, subject to Pi's normal physical-model capability clamping. The current model changes only after an eligible failure. A committed replacement remains selected for subsequent work; for a roled person it becomes the retained mind across reopen, including when recovery stops after the commit. A newer manual selection takes precedence. The extension neither restores the original mind on reopen nor balances healthy traffic. Normal saved-mind restoration still blocks an unavailable retained model/auth rather than silently selecting another provider. A same-provider-only profile has no fallback.

## Recognized terminal signals

These are source-qualified rules, not a promise to recognize every provider or account variant. The classifier uses the failed assistant message's provider and error text, and requires the failed physical model still to be the current selection.

| Provider | Eligible signal |
| --- | --- |
| `openai` | A JSON error whose `code` is exactly `subscription_sharing_usage_limit_exceeded`, `credit_balance_exhausted`, `organization_spend_limit_exceeded`, `project_spend_limit_exceeded`, or `organization_usage_limit_exceeded`. The code can be in the error object or a flat error body. |
| `anthropic` | A JSON error with `type: "rate_limit_error"` and `details.error_code: "enforced_spend_limit_reached"`. |
| `antigravity` | The adapter's complete terminal message: `Quota reached.` followed by an optional `Please wait ….` sentence and `Next: switch models or try again after reset.` or `Next: switch models or retry later.` |
| `xai` | No verified terminal signal is enabled. OpenAI-shaped errors from xAI do not inherit OpenAI semantics. |

JSON parsing supports an optional leading HTTP status, and OpenAI's `OpenAI API error (429):` wrapper. It also handles the installed OpenAI adapter's exact appended line `Check your ChatGPT usage: https://chatgpt.com/settings/usage`. Supported HTTP wrappers and `status` fields must be 429; conflicting statuses, malformed bodies and explicit authentication, permission or invalid-request types refuse recovery.

Generic `insufficient_quota`, generic 429/rate-limit text, `RESOURCE_EXHAUSTED`, a bare `Quota reached.`, ambiguous subscription messages and unknown providers remain outside this cross-provider policy. OpenAI's `subscription_sharing_workplace_individual_usage_limit_exceeded` is an administrator boundary, not an eligible shared subscription limit. Claude subscription exhaustion has no verified contract here. Ordinary native transient retry remains Pi's responsibility.

Evidence boundaries:

- OpenAI API credit/spend codes: [OpenAI error-code documentation](https://developers.openai.com/api/docs/guides/error-codes).
- OpenAI subscription code and appended usage hint: Pi 1.4.0's `pi-ai` OpenAI Responses adapter and retry classification. This is adapter evidence, not a published subscription OAuth contract.
- Anthropic spend signal: [Anthropic rate-limit documentation](https://platform.claude.com/docs/en/api/rate-limits). Its distinction from minute throttling matters.
- Antigravity message: `pi-antigravity` v0.11.0, commit `3870729`, client/stream terminal quota templates after its own account handling. This feature adds no account rotation or usage polling.

## Recovery and stopping

The awaited `turn_end` hook selects a replacement before Pi can perform native retry or compaction. The conditional native setter fences newer model/effort intent, cancellation and lifecycle invalidation across its auth wait. A false result is a stop decision: it may follow a committed change during notifications, so the caller preserves current state rather than attempting a fallible restoration.

Only the failed assistant entry is hidden from projected context through an append-only context edit. Its raw history remains intact, alongside completed assistant/tool pairs. Native compaction and continuation retain ownership of the conversation. The extension sends neither the original prompt nor completed tool calls again.

One recovery episode spans native retries and tool turns until final settlement. Each provider is selected for automatic cross-provider recovery at most once per episode; the configured pool determines that bound. Native retries on the selected provider retain their own policy. A successful selection creates one pending continuation marker. Any subsequent assistant reply clears it before classification, so a native retry's success or unknown error cannot leave an extra settlement continuation behind. Final settlement consumes a remaining marker once.

An interrupted/unauthenticated selection, exhausted eligible pool, changed model/context, failed compaction or normal cancellation stops recovery. Later user input starts a new episode if another eligible failure occurs. Observed manual selection or effort changes interrupt pending automatic recovery; the native action also fences newer requests while selection is pending. Registered target metadata and input suitability are checked again before continuation. The native guard and these checks are not an atomic transaction over all future provider requests; they cannot undo already transmitted work or promise exactly-once semantic external effects.

Notices distinguish selection from provider success. They appear through the TUI/RPC notification interface, or stderr without a UI, and as `provider-failover` metadata entries. They are not injected as new model-visible user messages.

## Execution contexts and verification limits

The extension operates in ordinary root Pi sessions, including TUI, RPC and print mode, when opted in and the native action exists. Existing people's selected minds remain unchanged until an eligible failure. Captured-review attempts—including forks of named lasting workers—run in program processes; all `PI_PROGRAM_ID` contexts are excluded rather than overriding their captured policy, effort or accounting. Temporary program-peer processes are excluded too. A `colleague` turn delivered to an already-running lasting person remains that person's ordinary root turn, using their normal global permission and workload; it has no captured review policy.

Internal forked continuations are excluded without changing parent recovery state. Interns, the private pair sidecar and `/btw` do not load this extension, so this feature does not recover their independent requests. Virtual-model routing remains with Pi. Recovery handles terminal assistant-turn errors. Independent compaction requests, including pre-prompt compaction before any assistant error, do not enter this hook; their failures retain the normal fail-closed compaction behavior rather than starting recovery here.

Focused tests cover classification, global permission, role/profile eligibility, image filtering, visible missing-capability refusal, healthy-mind preservation, program/fork exclusions, and ordinary/nested role-mind persistence. Separate real-SDK source controls exercise the production controller with faux providers: replacement compaction, retained completed-effect data, cancellation/manual-choice auth races, native retry overlap, unknown-target stopping and distinct-provider bounds. These are offline controls; they establish neither live provider quota contracts nor a packaged/installed CLI activation. Broader host/version and provider/account variants remain unverified.
