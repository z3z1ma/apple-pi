## file

Each running program is one passive activity unit. Its host calls and model workers stay inside that unit.
Why: a separate row per call would make one program look like several pieces of work on the shared active-work surface.
Coupled: components/shared/src/active-work.ts
Verify: components/pi-exec/tests/pi-exec.test.ts
