Status: recorded
Created: 2026-10-03
Updated: 2026-10-03

# Retrospective

## What Mattered

Shared outcome meaning was repeated across root, nested, and notification callers. One framing interface now hides the composition decisions while callers retain delivery mechanics. Separating the resume handle from response text preserves the existing file-change ordering.

## Learnings

The delivery contexts have intentional differences: root text stays verbatim, nested text is trimmed, foreground wording describes complete inline output, and notifications qualify status separately from their preview. A behavior-preserving refactor must retain those distinctions.

## Improvements

Characterize existing caller output before moving its decisions. Test the new framing interface for exact observable outcomes and use a mutation check to confirm sensitivity. Keep filesystem persistence and tool-delivery checks rather than replacing them with framing-only tests.
