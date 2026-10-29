# Workplace adoption

Date: 2026-10-29

## Decision and delivery

The operator accepted Workplace as a first-class Agent World direction and authorized commits directly to main. Live source, entry/header/window labels and maintained docs use Workplace. The World view and initial launch choice are unchanged. Historical prototype names remain here as evidence rather than runtime authority.

- `62853bb2` — `feat(workplace): persist channel participation and explicit hire dates`
- `5fd0f8aa` — `feat(agent-world): adopt Workplace chat and mail`

Both commits were confirmed through raw `git log`, `git reflog` and `git show --stat`.

Current product contract: `docs/workplace.md`. Maintained checks: `apps/agent-world/scripts/workplace-smoke.mjs` and `workplace-electron-check.mjs`, with app-owned sidecars. This bundle's scripts and prototype are historical snapshots, not a second maintained implementation.

## Checks actually run

- Combined `npm run typecheck`: passed. Deniz also ran `npm run build:world`; the root's build-freshness test passed.
- Ten focused files, `--maxWorkers=1`: **78 passed**, no exclusions/skips. Agent World: backend, profile, channel-membership, world-conversation, world-interface, world-workplace, build. Runtime: hire-date, channel-membership, channel-membership-recovery.
- The old retirement scenario now tests accepted-then-departed and removal from active/dormant rosters. Its fake stop allows permanent cleanup to delete the incarnation rather than requiring a retained ended row. The isolated case passed before the ten-file run. Production retirement code was unchanged.
- Promoted fixture smoke: passed. Screenshots at `/tmp/wp-adoption-shots`; inspected unread dark, profile light and Mail dark states. Existing unread geometry checks cover light and dark.
- Promoted real Electron check: passed. It entered Workplace through the actual World link, called profile IPC and returned to World in an isolated agent directory.
- Nonwriting Biome: 32 source/test/script files, passed. Context lint: 208 files, passed. `git diff --check`: passed.
- `npm run test:loader`: all extension entrypoints loaded.
- `npm pack --dry-run --json`: 2,593 files; nine required product/runtime/docs assets present, no workplace-spike filename packed. This checks inclusion, not an installed tarball.

Logs: `/tmp/wp-adoption-{types,tests,smoke,electron,biome-all,loader}.log`, `/tmp/wp-adoption-pack.json` and `/tmp/wp-adoption-retirement.log`.

No full suite, live validation messages/hires, or daemon restart was performed for adoption. The separately approved earlier hire-date activation remains documented in iteration 6. An already-open renderer needs reload for current chrome; returning to World/reloading clears in-memory drafts.

## Follow-up ownership

Org is proposed, not built. Its current owner and plan are `.ledger/202610290925-org-chart-and-task-specific-teams/`. It carries the operator's three chosen behaviors and the explicit work-handoff/progressive-start proposal for sign-off before real reporting/launch controls are wired.
