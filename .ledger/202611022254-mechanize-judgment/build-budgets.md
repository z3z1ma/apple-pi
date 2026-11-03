# Build budgets

Measured 2026-11-03 on this Mac, Pi SDK 1.4.0, Node's native SQLite, one Vitest worker. These are regression budgets for named synthetic loads, not live-user latency or exact provider billing claims.

## Limits and measurements

| Budget | Baseline | Ceiling | Margin |
| --- | ---: | ---: | --- |
| Root prompt plus tool schemas | 39,717 estimated tokens | 41,703 | 5%, rounded up |
| Explore intern prompt plus schemas | 2,635 estimated tokens | 2,767 | 5%, rounded up |
| Research intern prompt plus schemas | 2,646 estimated tokens | 2,779 | 5%, rounded up |
| BTW prompt plus schemas | 858 estimated tokens | 901 | 5%, rounded up |
| Workplace first-load JS/CSS | 230,965 gzip bytes | 242,514 | 5%, rounded up |
| Runtime newest `read_entries` page p95 | 1.32 / 1.31 / 2.02 ms | 3 ms | 25% above the largest calibration p95, rounded up |
| Runtime `search_transcripts` p95 | 8.30 / 8.11 / 8.17 ms | 50 ms | Explicit task requirement |
| Workplace full initial snapshot p95 | 29.59 / 26.25 / 24.85 ms | 37 ms | 25% above the largest calibration p95, rounded up |

Each latency run warms the operation three times, then measures twenty serial calls. p95 is the nearest-rank 19th sorted sample, not the mean or a threshold on every call. Timings include public-result assertions; runtime timings include socket connection, request, response and JSON decoding. Snapshot timing includes opening, reading, assembling, checking and closing the backend. Setup, fixture creation and index population are outside the timing.

The delivery run measured root 39,717 tokens, intern 2,635/2,646, BTW 858; bundle 230,965 bytes; page p95 1.84 ms, search p95 10.48 ms, snapshot p95 29.32 ms. All eight tests passed. Fresh root identities varied the prompt by five characters during measurement, within the stated margin. The runtime calibration above fully populates the large transcript's FTS rows before startup, removing unintended background-indexing contention.

## Fixture boundaries

- `tests/prompt-budgets.test.ts` loads all manifest extensions and skills for an unroled managing root with a TUI-shaped host and a project wiki. The root is recorded in an isolated runtime before measurement, so its manager tools are present. Explore and research derive their extension paths, allowed tools and appended prompts from `buildInternCliArgs`; BTW uses `createBtwConversation` itself. Every turn uses a scripted model with no provider call. The estimator is `ceil((prompt characters + JSON tool-definition characters) / 4)`, including name, description and parameter schemas. It measures persisted effective system sections, not the post-settlement base getter.
- User AGENTS files, private role/Self documents, global skills/configuration, MCP declarations, saved programs and conversation bodies are deliberately absent. Roles are ordinary root sessions but vary in instructions and posture; this fixed root is the package baseline, not a ceiling for every person's private material. Pair background reviews, notifications and RTK are disabled, with their package registrations retained.
- `apps/agent-workplace/tests/build-budgets.test.ts` performs a production Vite build with `write:false`. It measures the HTML entry plus the normal dynamically selected Workplace entry, recursively follows static imports/CSS, and sums per-file gzip lengths. It excludes later World/Monaco/terminal/language/worker loads and theme art. The production first-load closure had ten files. No committed bundle is rewritten.
- Its snapshot fixture has 40 awake and 3,000 sleeping root people, using the earlier ticket-30 roster scale. It migrates and seeds a disposable database before the real query-only backend opens it. It checks both counts and the Workplace projection. Empty mail/tasks and an absent socket keep the measured boundary to the full initial read/projection/assembly, not polling, runtime connectivity, Electron IPC or rendering.
- `components/session-state/tests/latency-budgets.test.ts` runs the real isolated native runtime. A 72,722,740-byte transcript contains 32,768 messages with 2 KiB text, and the measured newest page contains fifty bodies with an asserted order/cursor. The FTS fixture contains 128 search sessions with 1,024 entries each plus the large transcript (129 sessions/163,840 entries), near the preceding live-index observation of 123 sessions/~135,000 entries. All files, including the large transcript, are indexed before daemon startup and the full row count is asserted, so startup backfill cannot race the timed calls. The common `migration plan` query restricts one session before top-k, returns five attributed hits and asserts its full total of 1,024. It measures the actual `search_transcripts` socket handler, not the lower-level FTS call alone. This does not repeat the private recall-quality evaluation or measure old-page backward scans.

## Run and diagnose

```sh
APPLE_PI_BUDGET_REPORT=/tmp/apple-pi-build-budgets.jsonl \
  ./node_modules/.bin/vitest run \
  tests/prompt-budgets.test.ts \
  components/session-state/tests/latency-budgets.test.ts \
  apps/agent-workplace/tests/build-budgets.test.ts \
  --maxWorkers=1 --hookTimeout=30000
```

The optional report appends one JSON line per measured budget, with raw latency samples, prompt/schema counts and tool names, or per-chunk gzip sizes. Choose a fresh output path for each comparison. A normal run writes only disposable fixtures. These tests are in the existing Vitest include paths: prompts/runtime in `test:unit`, Workplace in `test:workplace`. CI's normal `npm test` therefore includes them; the task used only focused commands.

## Raising a budget deliberately

1. Inspect the named failure and its report. Establish whether growth is intended or a regression, with the same fixture, production mode, estimator and one-worker invocation.
2. For timing, retain three serial calibration runs and compare their p95 values; inspect machine contention and request correctness before changing a ceiling. Keep warm and cold claims separate.
3. Get the operator's agreement for the intended increase, especially any change to the explicit 50 ms search target. Update the literal ceiling in the owning test and this table in the same commit. Record the new measured value, margin, reason and fixture changes; keep old acceptance evidence distinct.
4. Run the focused files, `npm run typecheck` and scoped Biome. A larger limit is an explicit product decision, not an automatic baseline rewrite.

## Verification notes

Initial zero ceilings made the measured prompt, bundle, page and snapshot paths fail visibly before the limits were set. Early setup failures also exposed an unrecorded-root race and a post-settlement prompt getter that omitted extension sections; the final fixtures use a database barrier and Pi's system-message fold. Vite under Vitest initially emitted development React chunks (308,829 gzip bytes); production NODE_ENV corrected that measurement. Intermediate missing-import/daemon-start failures were concurrent path renames, followed by successful validation against Rahul's 5345bdcf names. The first runtime fixture left the large transcript for startup backfill, adding unplanned contention; pre-indexing it made the corpus and warm-load condition explicit before the final three calibration runs.

Checks: three focused files/eight tests passed; Node and web typecheck passed; scoped Biome passed. No full suite, real provider, live runtime restart, Electron session or private recall-quality gate was run for this lane.
