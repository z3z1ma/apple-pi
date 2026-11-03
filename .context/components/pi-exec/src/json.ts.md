## file

`serializeJsonValue` rejects values JSON would coerce, omit, or reshape, including non-finite numbers and `-0`. `fromPythonValue` turns a Monty value into plain JSON data. Host arguments may already be plain objects; program results may not, and Monty display placeholders are not serializable results.
Why: a silent JSON conversion would change the value the program or host actually passed.
Verify: components/pi-exec/tests/pi-exec.test.ts
