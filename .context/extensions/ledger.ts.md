## symbol:recordHistory

`history.json` holds only `{ "sessions": [...] }`. The tmux sidebar reads `sessions` from live bundles to title agent cards with their ledger task, so renaming the file, the `sessions` key, or an entry's `id` breaks those titles even though no TypeScript test fails.
Why: commit recording for history replay was removed when replay was shelved; the session links stayed because the sidebar consumes them.
Coupled: components/tmux-sessions/sidebar/agents.py
Verify: tests/ledger-history.test.ts, components/tmux-sessions/sidebar/tests/test_sidebar.py
