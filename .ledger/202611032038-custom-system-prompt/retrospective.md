Status: pending
Created: 2026-11-03
Updated: 2026-11-03

# Retrospective

## What Mattered

Pending completion of the undertaking.

## Learnings

- Before calling a section or tool "missing" from a captured prompt, check the switches that gate it. The pair programmer's switch is the dotfile `~/.pi/agent/.pair-state.json` (off on the operator's machine; `ls` without `-a` hides it). With the pair off, `acknowledge_pair_findings` used to stay active; since step 2 it is active only while the pair is on.
- A capture whose person was not yet registered in the runtime showed a non-root `org` and no role catalog. Start the capture directory's runtime first (see the wiki page `pi-request-internals`).
- Harnesses that run `before_agent_start` without a session (`tests/system-prompt-sections.test.ts`, the pair's offline harness) must stub `getActiveTools`/`setActiveTools` once any handler reads the active tools. The pi-exec integration suite failed this way at `fff4a416`, before the composer existed: a suite failing on main is a lead to check in a detached worktree, not proof of your own regression.
- Trimming a tool description can break `tests/package-load.mjs`, which asserts phrases in some descriptions, while focused vitest runs stay green. Run the loader after trimming, and rewrite each assertion to the new wording's meaning rather than restore the old text.

The rest is pending completion of the undertaking.

## Improvements

Pending completion of the undertaking.
