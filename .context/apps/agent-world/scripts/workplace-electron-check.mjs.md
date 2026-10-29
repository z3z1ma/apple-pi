## file

Keep the check's `PI_CODING_AGENT_DIR` isolated before Electron starts, and close its application before removing that directory, including failed-launch paths. Find the checkout by walking upward rather than counting parents.
Why: Electron's single-instance lock is scoped by its userData path; a shared directory can focus the operator's existing window instead of testing this build. Checkout discovery follows the built app marker, so running from another working directory keeps the same isolation and entry check. Cleanup must cover launch failures as well as assertion failures.
Coupled: apps/agent-world/src/electron/main.ts
Verify: apps/agent-world/scripts/workplace-electron-check.mjs
