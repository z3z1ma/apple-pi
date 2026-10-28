## file

The round-robin concurrency test launches real Node processes with one temporary agent directory shared by those processes. Each process performs an odd number of selections over two eligible candidates; aggregate counts must remain balanced.
Why: process-local counters can pass sequential cycling tests, but they produce an imbalance in this scenario and violate shared selection across Pi sessions. Keep subprocess configuration isolated from the operator's real agent directory.

Coupled: components/shared/src/model-profiles.ts, components/session-state/src/register.mjs
Verify: components/shared/tests/model-profiles.test.ts
