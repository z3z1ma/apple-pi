## file

These focused checks use the exported renderer aggregate and observe the native watchReplies requests it emits. The final list must retain the remaining reader's character after another reader leaves, including two readers of the same character, and become empty after the final reader leaves. Subscription failures remain rejected promises.
Why: the native API replaces its whole list. Cleanup can run after another document has registered a reader; checking only that cleanup occurred would miss clearing the visible reader. Exact request counts or redundant intermediate updates are not the contract, so batching remains possible without weakening the final-state proof.

These checks do not mount React or a real iframe. world-navigation.test.ts owns the built-app proof that entry shares the parent aggregate and live-reply cleanup preserves the visible character in both tab-switch directions. Native preload/main-frame behavior needs the separate Electron check.
Coupled: apps/agent-world/web/reply-watches.ts, apps/agent-world/web/entry.ts, apps/agent-world/web/overlay/conversation/live-reply.ts
Verify: apps/agent-world/tests/world-navigation.test.ts
