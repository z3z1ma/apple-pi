## file

Keep the check's `PI_CODING_AGENT_DIR` isolated before Electron starts, and close its application before removing that directory, including failed-launch paths. Find the checkout by walking upward rather than counting parents.
Why: Electron's single-instance lock is scoped by its userData path; a shared directory can focus the operator's existing window instead of testing this build. Ledger archival adds a directory level, so a fixed relative root would stop finding the built app after the task closes. Cleanup must cover launch failures as well as assertion failures.
Coupled: apps/agent-world/src/electron/main.ts
Verify: .ledger/history/202610280018-workplace-mail-and-chat-spike/electron-navigation.mjs
