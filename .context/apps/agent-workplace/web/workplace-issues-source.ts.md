## file

Only an operator's explicit source choice is persisted. The default is derived from the current Atlassian sign-in and remains free to change until the operator chooses. A slow credential-status response must not replace a newer saved choice. The request generation and effect lifetime check enforce both the selection ordering and unmount boundary.
Why: persisting an automatic GitHub default before an Atlassian sign-in finishes would turn a temporary state into a permanent preference; accepting the earlier credential response after a choice would make Settings and Issues disagree.

The browser's storage event reaches other documents, not the document that wrote the preference. Settings and the retained Issues view therefore also share a same-document change event. Connection changes recompute an unsaved default; they preserve an explicit choice. The Issues caller enables the hook only after first activation so mounting a hidden tab does not read credentials.
Why: Settings and Issues remain mounted independently; local component state or the storage event alone cannot update both in the current renderer.

Coupled: apps/agent-workplace/web/workplace-connections.tsx, apps/agent-workplace/web/workplace-issues.tsx
Verify: apps/agent-workplace/tests/world-issues.test.ts
