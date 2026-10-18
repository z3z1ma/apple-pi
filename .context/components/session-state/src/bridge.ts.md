## symbol:StateLink.close

A link closed without a reason (a reload, or a new `session_start` replacing the link) sends no shutdown, so the next bridge in the same process resumes the same incarnation; only a real session end sends one.
Why: a shutdown ends the incarnation, so sending it on reload recorded a fake process exit and a new generation for the same pid.
Verify: components/session-state/tests/runtime.test.ts

A link whose connection drops starts a runtime once and keeps reconnecting. Tests must end faux sessions with `session_shutdown` (the `close` helper), not `dispose` alone.
Why: a disposed session's link stays connected; when the test stops the runtime, the link starts a new one into a directory the test is deleting, leaving a stray daemon.
Coupled: components/session-state/tests/helpers.ts
