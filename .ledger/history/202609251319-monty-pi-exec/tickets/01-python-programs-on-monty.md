# 01: Python programs run on Monty with the core tools

**What to build:** `pi_exec` runs Python in a Monty sandbox instead of JavaScript in a Node VM. A program is Python with top-level `await`, and its result is the value of the last expression. The core tools `read grep find ls bash edit write` are async functions whose keyword arguments match the parent tool schemas. Their signatures are generated from those schemas: they render the live `code` parameter contract and also feed the Monty type checker, which is always on, so a wrong call fails before any host call runs. The harness semantics stay: the call budget, concurrency queueing (a gathered fan-out waits on the host side), the wall deadline, abort, durable nested traces, capped `print` output, `inputs`, `display`, `limits`, and a strict JSON result (Python dicts return as JS `Map` and must be converted, and lossy values are rejected). Cancellation belongs to the host: on abort, reject every pending host call with a `KeyboardInterrupt`-named error. The spike showed that `session.close()` does not settle a pending feed. Derive Monty's suspension limit from the call budget, not from a guess. The JavaScript worker, the web polyfills, the realm-crossing JSON code, and the VM-escape tests are deleted, with no JS fallback. This ticket also adds the pinned dependency, records its provenance, rewrites the `pi-fabric` row in the boundaries document, and updates the exec documentation and system-prompt guidance for the Python core surface. Model workers, extension tools, fetch, std, saved programs, and persistence follow in later tickets.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] A program with a wrong keyword argument to a core tool fails with a type diagnostic that names the argument, and its trace records zero host calls.
- [x] `asyncio.gather` over more core-tool calls than `limits.concurrency` completes with every result, and the observed peak of calls in flight equals the limit.
- [x] Abort during a pending `bash` call ends the program promptly with a cancelled result. A bare `except Exception` in the program does not stop it.
- [x] `while True: pass` stops at the configured deadline with a timeout error, and the next `pi_exec` call succeeds.
- [x] A returned dict, list, and nested structure appear as plain JSON in the tool result. A returned set, or a dict with non-string keys, fails with a boundary error.
- [x] A program that uses a JavaScript global such as `setTimeout` or `pi.read` fails with a Python `NameError` or a type diagnostic.
- [x] `npm run pack:check` lists the Monty package, the loader test passes, and the full validation sequence is green.
