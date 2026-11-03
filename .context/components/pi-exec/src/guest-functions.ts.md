## file

Host functions are keyed by trace ref. A binding's `call` sends arguments to the host; `interruption` returns the error to raise once the program has stopped, so a binding that converts failures to values still lets the interrupt through. Trace and activity arguments never include bound payloads. TypeBox schemas are projected to JSON Schema before the program sees them. Python may pass a keyword argument positionally or as one dict. A tool failure raises unless the tool returned structured data with it. Stub text is hashed in stable order to identify Monty checkpoints, so a stub text or order change makes every saved checkpoint incompatible. `pi_exec` keeps its own bash because the registered one can start root-owned background tasks. Captured extension tools are callable as Python functions; core tools and evidence functions keep their own names.
Why: a failure converted to a value must not hide cancellation, and a checkpoint must not restore Python against a changed host stub.
Coupled: components/pi-exec/src/host-calls.ts, components/pi-exec/src/session.ts, components/pi-exec/src/core-tools.ts
Verify: components/pi-exec/tests/pi-exec.test.ts
