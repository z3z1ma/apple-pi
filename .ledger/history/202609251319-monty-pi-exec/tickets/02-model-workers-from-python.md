# 02: Model workers from Python

**What to build:** Python programs can start model workers with `agent(...)` (returns text, or the typed value when `output_schema` is set) and `agent_run(...)` (returns status, text, value, error, usage, and context-fit info, and does not raise on failure). The options are the same as today: task, type, name, profile, tools, pair, system prompt, context, output schema. A `schema(...)` shorthand compiles strict JSON Schema from terse shapes. Bound context is still attached as a file, not interpolated into the task. Worker usage is aggregated into the outer tool result, and nested worker tool calls stay in the trace. The signatures are part of the type-checked contract. The exec documentation and prompt examples show the gather-based fan-out pattern.

**Blocked by:** 01: Python programs run on Monty with the core tools.

**Status:** done

- [x] A gathered fan-out of three `agent_run` calls with an `output_schema` returns three values that match the schema.
- [x] One worker that fails returns `status: "failed"` with an error, and its siblings still return values.
- [x] `agent(...)` with an `output_schema` returns the typed value itself, and without one returns text.
- [x] The usage in the outer tool result is the sum of every worker model turn.
- [x] An `agent_run` call with an unknown option name fails the type check before any worker starts.
