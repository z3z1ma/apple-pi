Status: in-progress
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

Additional operator decisions (2026-11-06, task-thread message 13518):

- **Closing means quit or end only:** TUI quit, window close, or explicit end/send-home from Workplace or a manager. `/new`, `/resume`, reload, crashes, lost sockets, runtime restarts and a headless stop without a recorded end preserve the organization. When uncertain, keep it.
- **Reopen or incorporate while waiting** stops further automatic departures. People already let go stay gone; the root goes last.
- **Splits retain incorporation:** a person moved out of an incorporated organization to stand alone stays incorporated. Merging adopts the target organization's status.
- **Backlog remains:** an unassigned unfinished task anchored to the root does not block cleanup and stays in the task store. Held work, owned unfinished reviews, reports and program scopes still block through the existing departure guards.

## Acceptance

- Flag, command and menu item share the name and mark the organization incorporated in the runtime's record.
- Cleanup is crash-safe and restart-safe: modelled with `tlc_check` (three or more people, crashes and restarts mid-cleanup, a reopened root), with a control that must fail; existing departure guards (unfinished work, reports first) stay authoritative.
- Existing rows migrate as incorporated; an older bridge still works against the new runtime. After activation, check the live record: the operator's three organizations are incorporated. Their roots, with the Workplace display names he gave them (device-local, not in the runtime): rsi = Tadhg Marinescu (01a18155-0ec7-71f5-9809-638184a366dd), fq-squad = Nana Komatsu (`floqast`), reporting = Bram Nygaard (01a183f2-16d5-7611-b2b7-165b9eea062d).
- Focused tests over the real runtime; docs (`docs/organization.md`, `docs/workplace.md`) and runtime prompt guidance updated.
- Committed and activated with the operator's consent.

## Current State

Assigned to Niamh Virtanen (runtime task work-2706768c-b5c4-4d27-89fb-1774ffc63e70), owned by Tadhg Marinescu. The five-person lifecycle model was refined to the settled split policy: 715,752 distinct states/depth 34 passed; the deliberate stale-selection control violates at depth 7. Runtime/schema54/bridge/flag/command and Workplace backend/types are implemented. API handed to Tadhg; he reports his menu/fixture work ready for the source commit and final rebuild. Focused checks passed 74/74; existing departure/liveness/program regressions passed 64/64 after adopting the retained-root fixture. Both TypeScript configurations, loader, scoped formatting/comments/whitespace and 661 context files passed; pack inventory includes the new helper. See [implementation-evidence.md](implementation-evidence.md) for commands, failed checks/corrections and limits. Runtime/backend source cut 4a7ba521 is committed; Tadhg owns the UI/dist rebuild, integrated review, approved runtime restart and live three-organization verification. No shared restart or live migration has been performed by Niamh.

## Outcome

Pending.
