Status: done
Created: 2026-09-02
Updated: 2026-09-02

# Constrain pair programmer to trajectory receipts

## Intent

Make the persistent pair programmer a trajectory-focused navigator rather than a second repository explorer. Remove direct repository and general transcript-search tools. Add one pair-private capability that expands only content already represented by a trajectory receipt.

Success criteria:

- The pair session exposes `share_note`, `ask_consultant`, optional `update_notebook`, `revisit_note`, and `expand_receipt`; it exposes no repository, shell, or general session-search tools.
- Receipt handles are host-issued, unguessable, session-generation scoped, active-lineage bound, and redeemable only after the corresponding omission was shown to the pair.
- Expansion returns immutable primary-session content rather than current checkout state, including omitted successful tool results, write payloads, and user-bash output.
- Large payloads use bounded continuation handles; callers cannot supply paths, queries, scopes, or offsets.
- Notebook observations continue to cite primary source-entry IDs, and `excludeFromContext` content never becomes pair-visible evidence.
- Pair prompts and documentation describe the shared-screen role; consultant and root recall capabilities remain unchanged.
- Formatting, type checking, focused pair tests, the full test suite, loader checks, and package checks pass.

## Current State

Complete. The pair follows the presented trajectory, can expand only host-issued receipt handles or known notebook IDs, and has no repository or general transcript-search surface. Receipts capture immutable primary-session payloads with source provenance, presentation gating, lineage checks, stable bounded continuation pages, and lifecycle revocation.

## Outcome

Implemented receipt-bound expansion for omitted tool results, write payloads, and visible user-bash output. Split pair recall from consultant/root recall, removed repository extensions and search tools from the pair session, centralized notebook source eligibility, and updated prompts, tests, and documentation.

Validation passed: `git diff --check`, `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` (89 files / 930 Vitest tests, 113 offline pair tests, loader smoke test), and `npm run pack:check`.
