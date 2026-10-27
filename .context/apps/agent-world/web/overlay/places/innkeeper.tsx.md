## file

A dormant row can be an ordinary sleeping member or a retained former entry. Preserve reading for both while offering Wake only to ordinary members; retirement time, not role or stop-reason wording, distinguishes them. The backend remains authoritative for stale UI requests.
Why: legacy former data remains readable without restoring rehire, and new permanent cleanup may briefly retain a retired row while writer proof is pending.
Coupled: apps/agent-world/src/backend/lifecycle.ts, apps/agent-world/web/game/place-scene.ts, apps/agent-world/web/overlay/conversation/conversation-panel.tsx
Verify: apps/agent-world/tests/world-inn.test.ts, apps/agent-world/tests/rename.test.ts
