## file

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
