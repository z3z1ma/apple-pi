## file

These are plain Python objects containing only a handle key. Monty's host ClassInstance store retains host wrappers for the interpreter lifetime, which would also retain their execution contexts and resources. A restored Python method instead dispatches through the current feed's externalLookup; the current invocation rejects an old key.

External helper names stay ordinary identifiers because Monty's stub imports omit leading-underscore names. The model-facing contract shows the facade; the type checker also receives its transport helpers. Every feed replaces the named attachment mapping before user code, independently of the saved Python variables.

Coupled: components/pi-exec/src/program.ts, components/pi-exec/src/guest-api.ts, components/pi-exec/src/guest-functions.ts, components/pi-exec/src/peer-calls.ts
Verify: components/pi-exec/tests/peer-python.test.ts, components/pi-exec/tests/peer-calls.test.ts
