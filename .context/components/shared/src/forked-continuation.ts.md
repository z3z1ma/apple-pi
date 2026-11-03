## file

A forked continuation copies the conversation: same system prompt, tool loadout, model and provider session id, starting from the given messages with one appended prompt or pending tool result. Session-bound request and turn hooks stay with the parent. The fork works in the worktree's copy of the parent directory. Writes stay in that worktree or the fork's private temporary directory. A path that cannot be resolved cannot be shown to stay in the worktree. The worktree and temporary directory may live under the parent root, so their own paths are left alone. Background tasks are refused because they would outlive the attempt and its worktree. Processes are killed before the temporary directory is removed. Each process group is killed and waited on so the next caller cannot be watched by a process the fork left behind.
A group that outlives the cleanup wait fails the fork result. A process that leaves its group with `setsid` escapes; branch search accepts that residual risk. Fork tools still run through parent hooks after the fork's isolation hook redirects paths and shell commands. The fork never writes the parent transcript. Pending tool closure preserves the parent's prefix and appends only answers to still-unanswered calls. The passive continuation promise settles when the fork does and never rejects; composition may return no message.
Why: the fork must not steer the parent. Its one returned message joins the parent context when idle, or at the end of the current turn. Tool consumers return usage to their caller instead of recording it in the parent.

Passive message types join the shared inline custom-message registry as well as registering their content renderer.
Why: Pi's custom-message component adds a spacer outside the registered renderer, and terse-tools consults the same registry before the following tool. A one-line content renderer alone leaves gaps on both sides of an otherwise compact result.
Coupled: components/shared/src/compact-custom-message.ts, components/terse-tools/src/patch.ts
Verify: components/shared/tests/passive-message-render.test.ts

Passive message expansion reads the live thinking-visibility setting inside render(), just as mail does, and ignores the custom renderer's tool-expansion option. Capture the session at session_start, including restored history before any prompt, and clear it on shutdown.
Why: thinking toggles can request only a redraw while tool toggles rebuild custom components. Capturing visibility when the renderer is registered or invoked would leave existing messages stale.
Coupled: components/session-state/src/mail.ts
Verify: components/shared/tests/passive-message-render.test.ts

## symbol:trackLiveSessions

Register a session before its extension-binding call emits `session_start`, as well as before prompt and custom-message runs.
Why: mail reads the live thinking-visibility setting when rendering restored history; waiting for a first prompt leaves resumed mail out of sync with the UI.
Coupled: components/session-state/src/mail.ts
Verify: components/session-state/tests/mail-render.test.ts
