Status: active
Created: 2026-08-20
Updated: 2026-08-20

# Use a one-shot Pi 0.84 private telemetry bridge

## Context

The Zentui-style input card must retain the native `(sub)` subscription qualifier and `(auto)` automatic-compaction qualifier in its bottom Starship strip. Pi's documented extension surface exposes current model, context usage, Git branch, and statuses but not the active `AgentSession`, `ModelRuntime.isUsingSubscription()`, or `AgentSession.autoCompactionEnabled`.

The native Pi footer reads those exact private values. The user was shown this public-API gap and explicitly selected **Use private Pi internals** on 2026-08-20.

## Decision

For Pi 0.84.x TUI sessions only, the input-card installer will use a narrow, one-shot interception of private `InteractiveMode.prototype.setExtensionFooter` while it synchronously installs its own exact empty-footer factory. The interception captures that interactive mode's current `AgentSession`, immediately restores the original method in `finally`, and passes the captured session only to the paired input-card instance.

The card will read the current `session.modelRuntime.isUsingSubscription(model.provider)` and `session.autoCompactionEnabled` on render, matching the native Kimi/subscription and auto-compaction semantics. Public `ReadonlyFooterDataProvider` remains the sole source for Git and extension statuses.

If the expected private runtime shape or capture fails, the extension MUST leave the existing editor and footer in place. Once it delegates the exact empty-footer factory, Pi has already replaced its prior footer and offers no getter/transaction to restore an arbitrary earlier custom footer; a later card-construction failure can restore only Pi's built-in footer. The extension MUST NOT render guessed qualifiers, persist a process-global session, monkey-patch `FooterDataProvider`, or leave a prototype patch installed.

## Authority And Provenance

- User decision, 2026-08-20: **Use private Pi internals**, after being informed that the supported extension API cannot expose these signals.
- `@earendil-works/pi-coding-agent` 0.84.2:
  - `dist/modes/interactive/interactive-mode.js`: `setExtensionFooter()` synchronously invokes a footer factory and `InteractiveMode.session` returns the current session.
  - `dist/core/agent-session.d.ts`: `autoCompactionEnabled` and `modelRuntime` belong to `AgentSession`.
  - `dist/core/model-runtime.d.ts`: `isUsingSubscription(providerId)`.
  - `dist/modes/interactive/components/footer.js`: native `(sub)` and `(auto)` semantics.

## Alternatives Considered

### Omit the qualifiers

This preserves only public-API behavior and is least brittle, but it knowingly drops live information currently presented by Pi's native footer. The user rejected it.

### Request an upstream public API first

This is the durable API design but blocks the requested package redesign on external work. The user rejected it for this iteration.

### Persistent broad monkey patches

Patching `AgentSession.bindExtensions`, `FooterComponent`, or `FooterDataProvider` could expose data but would affect unrelated lifecycle paths or status behavior. Rejected in favor of one synchronous interception limited to the exact empty-footer installation.

### Infer from configuration or source text

A second settings reader or provider-name heuristic can disagree with the active session. It would manufacture plausible but wrong state and is rejected.

## Consequences

The card is intentionally version-sensitive despite apple-pi's broad peer dependency range. The installer and tests must prove supported capture, no-replacement capture fallback, and built-in-footer recovery after a later construction failure. A Pi upgrade that changes this seam may temporarily retain the prior composition rather than the custom card; that is an honest visible fallback, not silent partial parity.

The implementation adds no third-party dependency and no durable session state. It must keep the original method's return value and behavior intact and restore the method even if empty-footer construction throws.

## Limits And Revisit Conditions

Supersede this decision when Pi offers supported read-only subscription and automatic-compaction state to editor extensions, or when a supported Pi release changes the intercepted runtime shape. At that point remove the bridge rather than retaining a compatibility path.

## Related Records

- `../task.md`
- `../specs/zentui-input-card.md`
- `zentui-input-card-owner.md`
