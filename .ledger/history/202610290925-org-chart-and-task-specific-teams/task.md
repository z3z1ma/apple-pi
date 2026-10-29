Status: done
Created: 2026-10-29

# Org chart and task-specific teams

## Intent

Build a first-class Workplace Org tab over the actual organization/runtime: separate reporting trees, clickable profiles, drag and keyboard reporting edits including cross-team moves/splits, planned role-based teams, whole-tree shared channels, and controlled work kickoff through the head. Preserve work, history, identity, hire dates and reconnect behavior. The operator chose planned roles until Start team, cross-team restructuring and whole-tree channels. Review `plan.md` before wiring real mutations; its acceptance criteria govern implementation. Start by making the interactive view available for feedback, with unconnected operations labelled honestly. Focused tests use one worker; live validation hires/messages, daemon activation and full-suite runs need separate authorization.

Original Org delivery (build39): Org runtime/protocol, whole-tree channels, authoritative temporary metadata, team-start controller, public types and Electron IPC are implemented. Build39 includes a responsive overview and fitted top-down focused chart, immediate Add person, direct Reports to confirmation, explicit profile Close, compact recorded-work summaries with explicit history expansion, and global people/team/work metadata search. Latest controller/API checks passed 17/17; current-roster actual-runtime socket test passed 1/1; integrated Node/web typecheck was reported passing. See evidence.md for scoped logs, older checks, findings and exact proof limits; product behavior is in docs/workplace.md, docs/organization.md and docs/session-state.md.

Build39 passed 9/9 Org browser cases, 2/2 targeted profile cases (30 unrelated skipped), actual isolated Electron entry in 6.1s, byte freshness 1/1, and final Node/web typecheck. Root inspected the fitted chart screenshot. Runtime support is committed as `34e57b59`; integrated app/source/assets/docs as `7d7c3e30`. Package inventory includes required source/dist. Earlier failing/intermediate checks remain historical in evidence.md, not claims about this final build.

The operator explicitly approved activation and app relaunch. Runtime `23011` was replaced by `42962`; all 11 exact Pi processes survived and each live socket bridge was verified. All 111 recorded people retained their reporting lines and hire dates; 21 whole-team channels initialized. Agent World `16372` was replaced by `54660`, connected to the new runtime, with World still the launch default. No live test team, test messages, reporting moves or real model startup were exercised. Historical context: `.ledger/history/202610280018-workplace-mail-and-chat-spike/`.

Subsequent Workplace iterations changed the app default to Chat and added optional initial goals, local names and refined history/navigation controls. See [the current product contract](../../../docs/workplace.md); this task's build39 checks and activation record are historical evidence, not proof of those later builds.

## Outcome

Implemented, committed and activated with explicit operator approval. Teams and people expose recorded work, Org supports global metadata search and fitted per-team charts, direct recruitment stays distinct from team planning, reporting uses one confirmation path, and profiles have an explicit Close control. Existing World lifecycle actions remain in World. Verification is focused rather than a full-suite claim; real paid-model team startup and installation from the packed tarball remain unverified. No push was attempted. Future operator feedback can extend the experience without reopening a second people/task/channel authority.

### Assignment 380: Tadhg Marinescu

Original Org undertaking implemented, committed and activated with explicit approval: independent reporting trees, safe cross-team branch moves/splits, truthful profiles/work history, planned role teams and whole-tree channels reuse existing runtime authority. Original runtime34e57b59/app7d7c3e30 proof and process continuity remain historical evidence. Later refinements delivered through57/f4268b78 include retained shared-rail World, organization-name work actions and profile header View all; evidence.md records Org21 on56, selected navigation3+Org2 on57 and isolated native checks without claiming broad reruns. App98404 connected to unchanged runtime55346. No full suite, paid-model test teams, live reporting validation or remote push. Retrospective and final handoff are complete; current product documentation owns subsequent behavior.
