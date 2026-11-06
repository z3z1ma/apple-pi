Status: ready
Created: 2026-10-30
Updated: 2026-11-06

# Incorporated organizations: default-temporary organizations that dissolve when their root closes

## Intent

Organizations accumulate: the operator had 24 workspaces and needed about four (2026-11-06; 21 one-person organizations were let go by hand). Make organizations temporary by default and lasting only by explicit choice.

Settled with the operator (2026-11-06):

- **Default.** A root session started without the flag founds an unincorporated organization. When its root closes, the root and everyone in its organization (hired people at any depth, temporary peers) are let go automatically, with no handoffs.
- **Opt in: incorporate.** One name everywhere, in the organization's own language: `pi --incorporate` at startup, `/incorporate` in the session, and "Incorporate this organization" in Workplace's workspace menu. An incorporated organization is kept after its root closes, as today.
- **Still working: wait, then clean.** Cleanup waits until each person is idle and holds no unfinished work; anyone still blocked stays, and the workspace menu says what is waiting. Nothing is stopped mid-turn.
- **Existing people are grandfathered** as incorporated by the migration.
- Leaving an organization by hand is already shipped (Workplace "Leave <organization>…", 55ac49c0).

Open, to settle in design (raise with the operator if a choice changes what he sees):

- Which endings of a root's process count as "closes" (quit, window close, `end_session`) versus a crash or runtime restart, which must not dissolve anything.
- Whether reopening an unincorporated root before cleanup finishes cancels the dissolution (expected: yes).
- Whether a person moved into an incorporated organization from an unincorporated one keeps the target's status (expected: status belongs to the root's organization, not the person).

## Acceptance

- Flag, command and menu item share the name and mark the organization incorporated in the runtime's record.
- Cleanup is crash-safe and restart-safe: modelled with `tlc_check` (three or more people, crashes and restarts mid-cleanup, a reopened root), with a control that must fail; existing departure guards (unfinished work, reports first) stay authoritative.
- Existing rows migrate as incorporated; an older bridge still works against the new runtime. After activation, check the live record: the operator's three organizations are incorporated. Their roots, with the Workplace display names he gave them (device-local, not in the runtime): rsi = Tadhg Marinescu (01a18155-0ec7-71f5-9809-638184a366dd), fq-squad = Nana Komatsu (`floqast`), reporting = Bram Nygaard (01a183f2-16d5-7611-b2b7-165b9eea062d).
- Focused tests over the real runtime; docs (`docs/organization.md`, `docs/workplace.md`) and runtime prompt guidance updated.
- Committed and activated with the operator's consent.

## Current State

Assigned to Niamh Virtanen (runtime task work-2706768c-b5c4-4d27-89fb-1774ffc63e70), owned by Tadhg Marinescu. Next: she traces how a root's process ending is observed and the existing departure path, models cleanup with `tlc_check`, and sends recommendations on the open points to Tadhg, who settles them with the operator before anything irreversible is built. Tadhg builds the Workplace menu item once the runtime API exists, and owns runtime restart and activation.

## Outcome

Pending.
