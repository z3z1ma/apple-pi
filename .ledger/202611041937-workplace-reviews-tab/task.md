Status: planning
Created: 2026-11-04
Updated: 2026-11-04

# Workplace Reviews tab: code review as its own app with an updates badge

## Intent

Operator, 2026-11-04, after the Git tab: make code review a first-class Workplace tab too, show the number of updated code reviews (any state transition) as the red number next to the tab icon, and make it beautiful, improved from how it was inside Code.

## Acceptance

- Reviews is its own rail app (`?workplace=reviews`); Code keeps no review queue, and Code's inline **Open in Reviews** opens that review there.
- The rail badge counts reviews whose state changed since the operator last saw them, before the app is opened; seeing a review clears it.
- Every evidence tab, comment, analytics, cancel/resume, additional work, sign-off and capture still work, with in-app confirmations.
- Headless-Chrome tests with light and dark screenshots; backend and runtime reader tests; typecheck, Biome, committed build; the real app relaunched with consent.

## Current State

Built and verified; awaiting commit and relaunch.

- Reader `reviewStates` (id and state, organization-scoped) beside `reviewQueue`, sharing `scopeClause`; exposed as `reviews.states` through backend, IPC and preload.
- Badge: `web/workplace-review-updates.ts`, seen states in localStorage, first run records a baseline.
- App: `web/workplace-reviews.tsx` rewritten (cards, header, progress line, tabs, capture dialog, analytics cards); `web/workplace-dialog.tsx` shared with Git.
- Checks: `world-reviews.test.ts` 3/3 with screenshots looked at; `world-code`, `world-git`, `reviews-backend`, `build`, `world-navigation`, `world-terminal`, `world-file-links` pass; `review-queue.test.ts` reader case passes; isolated Electron check passes including `reviews.states` through the real preload.

## Outcome

Pending.
