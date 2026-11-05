Status: done
Created: 2026-11-04
Updated: 2026-11-04

# Retrospective

## What Mattered

- Routing every action through one typed `GitAction` with a per-kind IPC field table kept the renderer from ever building Git arguments, and let one backend test file exercise all 24 actions against real repositories.
- Reusing the workspace backend's `git()` gave the Git app the same hygiene (no prompts, no editor, batch SSH, cleared GIT_* overrides) instead of a second runner.
- Looking at the screenshots found what the assertions could not: the "dark" shot was still light (wrong theme control) and the diff showed raw patch headers.

## Learnings

- Removing a pane from Code broke tests far from Code's own suite: the terminal suite measured the Source control sidebar, and a tab-close test opened a file through the Git pane. Grep every test for the removed surface's accessible names, not only its symbols.
- Biome's cognitive-complexity limit flagged the Git component at 74; extracting the graph, commit form and commit detail was cleaner than a suppression and made the draft-retention rule explicit.
- The isolated Electron check had been broken by an unrelated rename (`runtime-main.ts`) and failed with a generic readiness timeout; running the spawn by hand showed the missing module at once.

## Improvements

- The code review tab is the next app to move out of Code; RailApps already handles the extra rail item.
