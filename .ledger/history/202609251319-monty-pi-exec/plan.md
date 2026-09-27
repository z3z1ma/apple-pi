# Plan: rebuild pi_exec on Monty

## 1. What Monty is

`@pydantic/monty` 1.0.0 (MIT, Node >= 20) is a Python 3.14 subset interpreter written in Rust. The Node binding is a napi addon that drives a pool of `monty` worker subprocesses. The sandbox has no filesystem, network, env, or process access. It reaches the host only through `externalLookup` functions and explicit mounts. Every host call is a suspension: the worker stops, the host answers, and the worker resumes.

Platforms: darwin x64/arm64, linux gnu x64/arm64, win32 x64 (no musl). Unpacked package is about 24 MB plus one platform binary. Pydantic AI "Code Mode" runs on it.

Core API: `Monty.create(poolOpts)` → `pool.checkout({ limits, typeCheck, typeCheckStubs, osPolicy })` → `session.feedRun(code, { inputs, externalLookup, printCallback })`. Also `feedStart`/`snapshot.resume*`, `session.dump()` / `loadSession()` / `loadSnapshot()`.

## 2. Proven by spike (`/tmp/monty-probe`, Node 26, macOS arm64)

| Question | Result |
| --- | --- |
| Concurrent async host calls | `asyncio.gather` over 20 host calls of 50 ms each: 53 ms total, peak in-flight 20. The host sees every call at once, so the existing envelope can throttle it. |
| Kwargs shape | Python `read(path="x")` reaches the host as a trailing plain object `{ path: "x" }`. This maps 1:1 to our one-object tool args. |
| Pre-flight type check | Stub `async def bash(*, command: str, ...)`. `bash(cmd="ls")` is rejected before execution with ty diagnostics `missing-argument` / `unknown-argument`, including source spans. First check took 13.5 ms. A warm feed took 0.8 ms. |
| Host error → Python | Setting JS `error.name = "FileNotFoundError"` gives a real Python exception and a clean traceback. |
| Runaway compute | `while True: pass` with `maxTurnDurationSecs: 1` stops at 1000 ms with `TimeoutError`. |
| Cancellation | `session.close()` during a pending host call does **not** settle the feed promise (it stays pending forever). Rejecting the pending host promise with `name = "KeyboardInterrupt"` ends the feed. `except Exception` does not catch it, because it is a BaseException. |
| Output values | Python dicts return as JS `Map`, and tuples return as arrays. A deep converter is needed for the JSON boundary. |
| Persistence | Session globals persist across feeds. A dump with a 1000-item list is 7.3 KB, and `loadSession` restores it into another worker. |
| Latency | Warm checkout < 1 ms; cold checkout with a pre-spawned pool is 5 ms. The first run on this machine was about 600 ms, probably first-exec of the binary. |

## 3. Why this is materially better (not only different)

1. **Wrong calls fail before any side effect.** Today a typo in the arguments of the 5th call runs calls 1–4 (bash/edit/write) and fails mid-program. With Monty, one generated `.pyi` stub (from the same Typebox schemas that render the `code` parameter today) is checked by ty in milliseconds before execution. The stub is also the documentation. One source gives both the contract and the checker.
2. **A real sandbox instead of hardening.** Node says `node:vm` "is not a security mechanism". We carry escape-hardening code and tests ("blocks string-generated escapes", "keeps host promises hidden when guest intrinsics are modified", "does not expose Node globals"). Monty isolates at the language level and puts the worker in a separate process. Memory, recursion, and time limits are enforced inside the VM.
3. **We stop building a JS runtime.** Web polyfills (fetch/URL/Headers/Request/Response/AbortController/TextEncoder…), timers, the worker message protocol, call ids, and the strict-JSON realm crossing all go away. Each guest capability becomes one async host function.
4. **Python for orchestration code.** Comprehensions, sets, `collections`, `re`, `json`, `itertools`. `std.coverage` / `std.reconcile` become one-liners, and `parallel`/`pipeline` become `asyncio.gather` plus a plain loop.
5. **Optional: a REPL that follows the session tree.** A session dump is a few KB. If we persist it as a Pi custom session entry after each call, variables survive across calls, restarts, and forks, and follow `/tree` navigation. This replaces the `state` ID store (in-memory, 200 KB, 32 snapshots, lost on restart).

## 4. Honest limits and costs

- **The language changes to Python.** This breaks every JS program: `.pi/programs/*.js`, skill references (`code-review/references/*.js`, `ralph/references/*.js`), and system-prompt examples. A dual runtime would be a compatibility layer, so the plan is a clean cut.
- **The subset is small.** It has no class inheritance, no `create_task` / `Semaphore` / `as_completed` / `wait_for`, no `async for` / `async with`, no `enum`, `contextlib`, `hashlib`, or `uuid`, and no third-party imports. Orchestration code rarely needs these, and the type checker flags most of them before a run.
- **No top-level `return`.** The result is the trailing expression (REPL semantics, as in Pydantic AI Code Mode). Wrapping the code in `async def main()` would keep `return` but loses REPL globals, so choose one.
- **Some output values become strings.** Functions, classes, and regex patterns silently become strings on output. A strict converter can reject Map keys that are not strings, and Set, BigInt, and Buffer. It cannot see the stringified values.
- **Cancellation is ours to own** (proven above). On abort, reject every pending host promise with KeyboardInterrupt. Later host calls reject immediately. Pure compute is bounded by `maxTurnDurationSecs`, with the pool `requestTimeout` as a kill backstop.
- **`maxSuspensions` cannot be disabled** (default 1000). It counts calls and future resolutions, so it must be derived from `callBudget`, not guessed.
- **A native dependency and a new 1.0.** Pin the exact version. `npm run pack:check` must show that the platform packages resolve through `optionalDependencies`.
- **Code reduction is about 30%, not 70%.** Agents, UI, traces, the envelope, tool capture, and saved programs are harness semantics, and they stay.

## 5. Size estimate (`extensions/runtime-*`, 4327 lines today)

| Goes | Lines | Replacement | Lines (est.) |
| --- | --- | --- | --- |
| `runtime-worker.mjs` | 411 | `runtime-monty.ts`: pool lifecycle, feed drive, abort, converter | ~200 |
| `runtime-web.mjs` | 705 | `fetch(url, method=, headers=, body=)` host function in `runtime-fetch.ts` | ~60 |
| `runtime-program.ts` | 147 | (merged above) | 0 |
| `runtime-json.ts` | 43 | (converter above) | 0 |
| `runtime-stdlib.mjs` | 413 | host-side TS for git/repo/dev/context/schema; drop coverage/reconcile | ~250 |
| `runtime-api.ts` JS signature formatter + ECMAScript list | ~200 | `.pyi` stub generator from Typebox | ~120 |
| `state` store in `runtime-implementation.ts` | ~90 | none, or a dump entry if §7 D2 is approved | 0–60 |

Net: about −1300 lines of runtime, and about −600 lines of VM/polyfill/escape tests in `tests/runtime.test.ts`.

## 6. Guest surface (proposal)

Flat async functions, named after the tools, with kwargs matching the tool schema:

```python
import asyncio
names = [n for n in (await ls(path="extensions")).splitlines() if n.endswith(".ts")]

async def judge(name):
    r = await agent_run(
        task="Name the riskiest export and quote the evidence.",
        name=name,
        context={"path": f"extensions/{name}"},
        output_schema=schema({"export": "str", "evidence": "str"}),
    )
    return {"file": name, "status": r["status"], **(r.get("value") or {})}

await asyncio.gather(*[judge(n) for n in names])
```

- Core: `read grep find ls bash edit write`. Extensions: `mcp(...)`, `ledger_add(...)`, … captured as today. `agent`/`agent_run`, `fetch`, `skills_list`/`skills_body`, and `std` functions as flat `git_change`, `context_fit`, and so on.
- `inputs` are bound as the global `inputs`. `print` goes to a capped collector.
- `limits.concurrency` is still enforced host-side (the gather fans out, the envelope queues).
- `display` / `limits` stay tool parameters.

## 7. Decisions for the operator

- **D1 Language cut:** rewrite all JS programs to Python in one change, with no JS fallback (recommended), or keep both runtimes.
- **D2 Persistence:** (a) stateless feeds plus the current `state` IDs; (b) one live Monty session per root session, dumped to the session JSONL after each call and restored on fork/tree/restart (recommended; it reverses the `prime-agent` "persistent kernels" rejection in `docs/boundaries.md`). The dump size policy needs an operator decision; no guessed cap.
- **D3 Type check:** always on (recommended; this is the main correctness win), or opt-in.
- **D4 boundaries.md:** the `pi-fabric` row rejects "QuickJS/WASM, compile-time TypeScript checking, alternate runtimes". Monty is a replacement runtime with compile-time checking, so the row must be rewritten.

## 8. Phases (each ends green on `format:check lint typecheck test pack:check`)

0. **Close the spike gaps.** Measure suspensions per host call. Measure ty latency with a full stub (about 40 extension tools). Check `maxMemory` behavior. Check `pack:check` and a checkout install of the platform packages. Check the 256 MiB dump and 10 MiB print caps.
1. **Tracer bullet.** `runtime-monty.ts` behind the existing `pi_exec` tool: core tools, `agent`/`agent_run`, and extension tools as host functions; the stub generator; abort; the converter. Delete worker/web/program/json. Rewrite the runtime tests that assert tool behavior (budget, concurrency, traces, cancel, errors, saved programs).
2. **Library and callers.** Move std to the host side (drop coverage/reconcile). Rewrite the skill reference programs and saved-program discovery (`.py`, docstring/`@param` header). Update the system-prompt guidance and examples in `runtime-api.ts`.
3. **Persistence** (if D2b). Custom entry per call, restore on `session_start`/fork/tree, remove the `state` parameter and store.
4. **Documentation.** `docs/exec.md`, `docs/boundaries.md`, `README.md`, the AGENTS.md execution-context paragraph, `THIRD_PARTY_NOTICES.md`.

## 9. Acceptance criteria

- The same observable `pi_exec` behavior that the retained tests assert: envelope, fan-out queueing, traces, usage, cancellation, saved-program tools, and the search root guard on core tools.
- A program with a wrong keyword argument fails with a ty diagnostic, and zero host calls are dispatched.
- Abort during a pending host call ends the program within one host round trip. Runaway compute ends at the turn limit.
- `extensions/runtime-*` is smaller by at least 1000 lines, and there are no Node-VM escape tests left, because there is no Node VM.
- `pack:check` lists `@pydantic/monty` with platform optional dependencies, and the loader test passes.
