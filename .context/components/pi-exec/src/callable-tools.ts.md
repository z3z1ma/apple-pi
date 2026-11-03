## file

Programs may call Pi's callable tools for the running call, except `pi_exec`, `monitor`, `remind_me`, `task`, `search_branches`, and `program_*` tools.
Why: those root-only orchestration tools stay outside the guest even when Pi lists them as callable.
Coupled: components/pi-exec/src/host-calls.ts
Verify: components/pi-exec/tests/pi-exec.test.ts
