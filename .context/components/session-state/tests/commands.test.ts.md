## file

`abort` is applied only once the run has stopped. A follow-up still held then is not sent. The faux registry knows one model and returns it for any name.
Why: treating abort as applied at acceptance would hide a follow-up that is still delivered, and a registry that distinguishes names would not catch a lookup that ignores the requested model.
Verify: components/session-state/tests/commands.test.ts
