## file

This module is the single Monaco worker environment for Workplace. Import it only through the Code view's dynamic import. The retained Code component owns its workers; terminate them after disposing its editor and models on actual unmount, while application-tab hiding retains them.
Why: Monaco's environment is renderer-global. Terminating workers when Code is hidden leaves retained model language services pointing at stopped workers; importing this module in the shell would also load the editor before Code is visited.

Coupled: apps/agent-world/web/workplace-code.tsx, apps/agent-world/web/vite.config.ts
Verify: apps/agent-world/tests/world-code.test.ts
