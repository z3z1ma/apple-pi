## file

`PYTHON_SCHEMA_PRELUDE` is trusted guest code. Schema compilation is pure Python and makes no host calls or Monty suspensions.
Why: the prelude runs before user code; a host call there would spend the program's budget and could suspend before the guest had a schema.
Coupled: components/pi-exec/src/program.ts
Verify: components/pi-exec/tests/pi-exec.test.ts
