## file

This is what the operator's attention needs, as tmux shows it: the status-line summary and the jump target. `needsYouSince` is an open prompt, or a settle not seen yet, kept while the person works. A run in progress shows as working even when an earlier result is still unseen. Status colors are the sidebar's Catppuccin Mocha warning, success, primary, and muted text.
Why: seeing a result must not hide that the person is working again, and an unseen settle must remain a jump target.
Coupled: components/session-state/src/runtime.ts
Verify: components/session-state/tests/attention.test.ts
