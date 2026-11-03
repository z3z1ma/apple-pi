## file

`PROGRAM_ENVELOPE_MAXIMA` are hard caps for optional `pi_exec` limits. Defaults still come from program shape; supplied limits only scale capacity up to those caps.
Why: a caller-supplied limit must not remove the package bound.
Verify: components/pi-exec/tests/pi-exec.test.ts
