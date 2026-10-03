Status: in-progress
Created: 2026-10-03
Updated: 2026-10-03

# Deepen subagent outcome framing

## Intent

Deepen shared outcome framing for root subagent results, nested results, and notifications while preserving observable behavior. Concentrate result selection, partial-output framing, delivery wording, saved-output presentation, and resume eligibility behind one interface. Keep persistence, state machines, and delivery mechanics with their existing owners.

## Approach and acceptance criteria

The governing task snapshot is [spec.md](spec.md). The operator confirmed the framing-interface test seam, retention of existing tool-level delivery and persistence checks, and creation of this bundle on 2026-10-03.

- Callers delegate shared framing decisions instead of assembling helper chains.
- Outcome wording and delivery-specific affordances remain unchanged.
- Tests exercise the caller-facing interface; existing integration and persistence checks remain.
- Persistence, lifecycle, transcript inspection, XML envelopes, truncation, file-change reporting, and scheduling stay outside the framing module.

## Current State

Implemented and validated on 2026-10-03. Ticket generation was skipped because the change fits one context. The operator freshly confirmed the framing-interface, tool/notification delivery, and persistence test seams before implementation.

- One `frameOutcome` interface now supplies shared framing to root results, nested results, and notifications. The old status-note module and output-file presentation helper are absorbed; file persistence remains unchanged.
- Characterization tests passed against the original callers before migration. A temporary mutation of notification wording and nested resume eligibility caused four tests to fail; restoring the implementation made them pass.
- Focused subagent suite: 169 tests passed. Full validation: format check, lint, typecheck, 1164 Vitest tests, 122 offline pair checks, extension loader, package dry run, and diff whitespace check passed. The dry-run package includes the new framing module.
- Independent Standards and Intent/Spec reviews against the implementation working tree at `b6d2bb4` found no actionable findings. Root inspection confirmed output ordering, caller bypasses, and persistence-failure recovery coverage.
- Live-provider behavior and installed-tarball loading were not exercised; this refactor changes no tool surface or provider behavior.

## Outcome

The behavior-preserving refactor is complete. The task remains in-progress pending operator acceptance and explicit closure authority; no tickets, push, or publication were created.
