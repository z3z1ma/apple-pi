Status: in-progress
Created: 2026-11-02
Updated: 2026-11-02

# Workplace polish and UX loop: Slack-grade agent workspace

## Intent

The Chat tab is the operator's primary interface to a large organization of agents. Run repeated review-and-fix rounds over every surface Workplace exposes, measuring the gap to the software that inspired it, then a second loop on interaction design and robustness: how many steps, how much attention, how ergonomic, what is missing for managing many agents and much work at once. The operator asked for many rounds and for vision, not a fixed list.

## Method

Each round: pick a surface, capture it from live data with `../202611012305-front-desk-continuous-organization/live-mirror.ts` (and fixtures for states the live data lacks) at 1440/1100/900 in light and dark, score it against `rubric.md`, write findings into `rounds.md`, fix the material ones at their shared cause, verify (focused tests, screenshots), commit, relaunch. Reference software per surface: Slack (Chat, threads, sidebar, activity), Superhuman/Gmail (Mail), Linear (Threads, Issues, Org lists), VS Code (Code).

## Done when

The polish loop has run until a full pass finds no material visual deltas; the UX loop has delivered the highest-leverage interaction improvements (message actions, forwarding, replies, attention routing, desk proactiveness) with focused tests; each batch is committed and activated, and the operator has a written gap assessment of what remains.

## Current State

Fourteen rounds done and live (`rounds.md`); gap assessment in `gap-assessment.md` with the operator's three decisions recorded. Next from the ranked delta: slash commands in the composer, reply-in-thread from the desk, notification policy, recall before read, reactions, an agent status board, offline composing.

## Outcome

Closed after 22 live rounds (see `rounds.md`), followed by themes and settings, Canvases, fast DMs, the Code tab toggles, editor agent actions, and browser pages inline in the DM. The ranked delta in `gap-assessment.md` is not all built. Open items: Canvases in Cmd-K and the sidebar, and an agent status board. Start a new task for any of these.

### Assignment 732: Tadhg Marinescu

Closed during the operator's ledger cleanup. Twenty-two polish rounds and the later Workplace features are live. Remaining ranked-delta items, including Canvases in Cmd-K and the sidebar and an agent status board, are recorded in the bundle for a new task.
