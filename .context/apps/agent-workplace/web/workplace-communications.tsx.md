## file

The communication modal follows the existing native-dialog pattern: capture Escape before underlying profile/row listeners (except while a list inside it is open, which closes first), block closing while an operation is in flight, and restore only a still-connected trigger. Refusals belong inside the active modal because showModal makes the underlying reader inert.

Recipient chips (`Recipients` in workplace-fields.tsx) display current people but submit stable IDs; a known foreign ID typed in full and confirmed with Enter is added as typed, without implying global directory access. Adding a recipient is explicit. An uncommitted input string is not silently included when the parent form submits. Runtime resolves/authorizes the entire selected audience and remains responsible for ambiguous names, access and self/alias rules.
Coupled: apps/agent-workplace/web/workplace-channels.tsx, apps/agent-workplace/web/workplace-thread.tsx
Verify: apps/agent-workplace/tests/world-communications.test.ts
