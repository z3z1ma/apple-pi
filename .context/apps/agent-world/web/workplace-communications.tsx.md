## file

The communication modal follows the existing native-dialog pattern: capture Escape before underlying profile/row listeners, block closing while an operation is in flight, and restore only a still-connected trigger. Refusals belong inside the active modal because showModal makes the underlying reader inert.

Recipient suggestions display current people but submit stable IDs; a known foreign ID can be entered directly without implying global directory access. Adding a recipient is explicit. An uncommitted input string is not silently included when the parent form submits. Runtime resolves/authorizes the entire selected audience and remains responsible for ambiguous names, access and self/alias rules.
Coupled: apps/agent-world/web/workplace-channels.tsx, apps/agent-world/web/workplace-thread.tsx
Verify: apps/agent-world/tests/world-communications.test.ts
