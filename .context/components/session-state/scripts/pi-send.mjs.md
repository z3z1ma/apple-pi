## file

This script can start the runtime through sendCommand. It waits for acceptance, prints the command ID, and reports a waiting recipient on stderr; acceptance is not delivery or application.
Why: shell automation needs a durable accepted-mail receipt even when the target session is stopped, and must not mistake that receipt for the recipient reading the message.
Coupled: components/session-state/src/client.ts, components/session-state/src/protocol.ts
Verify: components/session-state/tests/mail.test.ts
