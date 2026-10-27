# Context and notebook

Pi owns compaction for every provider, including OpenAI with ChatGPT OAuth, xAI, and Anthropic. Its native LLM summarizer handles `/compact`, automatic compaction, and overflow recovery, producing a readable summary with Pi's normal retained history. apple-pi adds no provider compaction requests, encrypted-checkpoint replay, replacement summaries, or custom retention policy. This also applies to the private pair programmer session, which inherits Pi's compaction settings. Use Pi's `compaction` settings for timing and retained history; the former `pair.compactAfterTokens*` and `pair.compactIdleMinutes` settings are no longer read.

Pi checks context after tool results and compacts before the next assistant provider request in the same run, including when oversized trailing tool results require an older valid cut point. [`extensions/auto-compact.ts`](../extensions/auto-compact.ts) keeps that continuation fail-closed: a failed or cancelled automatic compaction aborts the active run before provider dispatch. It loads in every top-level session (each person, including the temporary peers that `pi_exec` starts), in [interns](interns.md), and in the [`/btw`](btw.md) session. Pi's `compaction.enabled` setting controls compaction.

Right after each compaction (`session_compact`), the notebook appends one packet of open learnings as a persisted custom message. It follows the compacted history directly, so it sits near the start of the new context, where the model is likely to notice and recall it. Nothing rewrites request context per turn: provider prompt caches match on an exact prefix, and a message that moves or changes between requests forces the whole history to be re-sent at cache-write prices. Ordinary compaction remains responsible for conversation history and task progress.

## Why compaction stays with Pi

Codex's ChatGPT OAuth compaction path is not Pi's `openai` ChatGPT OAuth path. At the [inspected Codex revision](https://github.com/openai/codex/blob/c8e73bf7198152ecc1158b148105d054add7a525/codex-rs/model-provider-info/src/lib.rs#L457-L475), ChatGPT authentication selects `https://chatgpt.com/backend-api/codex/responses` with bearer and account headers. Pi 1.4's `openai` login requests a direct-use token for `https://api.openai.com/v1` and sends ordinary requests there. Our threshold-based inline compaction workaround was not Codex's explicit-trigger protocol. The package uses Pi's summarizer rather than claiming parity or adding a second authentication/transport implementation. The [research record](research/server-side-compaction.md#decision) records the superseded approach and the removal decision.

### Existing sessions

Reload or restart Pi to unload the former compaction hooks. Historical compaction entries and original transcripts remain on disk unchanged. Encrypted items in old `details.serverCompaction` metadata are no longer replayed; Pi uses the entry's readable summary and its retained history. For old OpenAI/xAI entries, that summary is a sampled text projection, not a lossless decoding of the encrypted state. The next compaction uses Pi's normal summary flow; it cannot recover missing facts from that projection. Use `search_session` to recover exact earlier evidence from the original transcript when needed. New sessions start directly on Pi's native path.

## Pair programmer notebook

The notebook holds **learnings** from this session: things found out the hard way and what to do differently now. Examples are a tool call or pattern that failed and what worked instead, a working way to reach an environment or service, a harness pitfall, and a user correction. Status, plans, and decisions belong to the ledger, docs, and git.

The learning loop has three stages, each with its own cadence:

1. **Capture.** The main agent records learnings when surprised. The pair coaches: it records learnings the main agent missed, merges duplicates, and reminds the main agent to capture a surprise. A token-spaced reflection (below) and `/reflect` also capture, and only capture.
2. **Distill.** Learnings last for one session. Distillation reviews every open learning: a durable one moves to a machine-owned project file and is retired, unless it still guides the current work; one that matters only now stays open; a stale one is retired. Distillation does not ask the user and writes only these files, chosen by how a future agent finds them:
   - `.pi/LEARNINGS.md` loads into every session, like `AGENTS.md`, so it holds only short instructions that should change behavior on every turn. Distillation keeps it short by merging duplicates and removing lines that no longer hold.
   - A `.wiki/` page is found only by search, so it holds project knowledge under a name a search would match.
   - A ledger task's `retrospective.md` is read when someone works on a related task, so it holds lessons about that undertaking.
   - `.pi/programs/` holds a reusable `pi_exec` composition, which becomes a tool.
3. **Promote.** `AGENTS.md`, docs, skills, code, and files outside the project change only when the user asks, usually through [`/promote`](promote.md), which proposes changes and writes what the user approves. Git decides what is shared: ignore the machine-owned files in a repository where nobody else uses apple-pi, or track them in your own.

Distillation runs in a [forked continuation](forked-continuations.md) right after each compaction, when open learnings exist. At that point the context has room, and the fork sees the fresh compaction summary, the recent turns, and every open learning, which its prompt also lists. It starts at once rather than after the next run, so a long run cannot use up that room; when compaction happens in the middle of a run, the fork runs alongside it, and both may edit the same file. Its one-line reply reaches the main conversation as one passive `Distill:` message. Distillation also runs in the main conversation at ledger close (below) and on `/distill`. Reflection and distillation forks run one at a time, so a distillation that becomes due during a reflection waits and then sees what the reflection captured. A session that never compacts or closes a task loses its open learnings unless the user runs `/distill`.

The root session adds `.pi/LEARNINGS.md` to the system prompt at each run, under a note that the user's instructions and `AGENTS.md` take precedence. Pi appends a changed section as a system message before the next user message and folds it into the leading system prompt at the next compaction, so the cached prefix stays intact. Interns and the `/btw` session do not load it.

Once 500,000 new tokens (input, cache write, and output) have passed since the last reflection, the next completed run is followed by a learning reflection in a [forked continuation](forked-continuations.md). The fork records what it learned with `update_notebook`, using the failed or surprising tool calls of that stretch as evidence, and its one-line reply reaches the main conversation as one passive `Reflection:` message. A `bash` failure the agent predicted with [`expect: "failure"`](tasks.md#bash-extended) is left out; a success it predicted would fail is included. `/reflect` asks the main agent for the same reflection in the conversation at any time and restarts the spacing. The spacing was chosen from the median run of about 144,000 new tokens and should be tuned from use.

The input card shows `learnings:N` while learnings are open, because they end with the session. When the main agent first moves a ledger task to `done` or `cancelled` while learnings are open, the call is held once with the distill instruction and each open learning by id and full text, including those recorded by forked reflections. Lessons about the task go to its `retrospective.md`. The agent distills, then closes again.

The tool adds learnings, supersedes existing learnings, or retires them immediately. New learnings cite source entry IDs obtained through recall. The main agent may omit those IDs to cite the current user turn; the pair supplies IDs from its sourced trajectory or recall. Both use the same validation and append path. Main changes commit immediately; pair changes commit only after a successful review, and a stale pair update is rejected if the shared learnings changed meanwhile.

Full pair maintenance becomes due at `notebookAfterTokens` (default 20,000 uncovered source tokens). The pair lists every open learning in `retainReflectionIds`; existing learnings not listed are retired, so it omits only duplicates it merged. This field is required for a full review. Targeted updates leave other learnings alone. Completed reviews advance coverage even when there is nothing to add. Reviews without new learnings use the existing bounded retry backoff. If the pair is disabled or unavailable, automatic maintenance pauses; the main agent can still curate the notebook.

Only open learnings enter the post-compaction packet, the pair's initial seed, and its notebook maintenance prompt. New learnings link directly to source entries. Earlier observations and retired learnings remain retrievable through `revisit_note`, but are not live guidance. The append-only session archive can grow; active retention is an explicit model decision rather than a token quota or age-based eviction policy.

`registerNotebookCompactionPacket` appends the typed `notebook.packet` once after each compaction and skips it when the notebook is empty. Learnings recorded between compactions reach the main context at the next compaction; the pair receives current learnings through its initial seed and notebook maintenance prompts. The `notebook.*` names are persistent session-record formats, not separate actors.

Commands and tools:

- `/pair status` — pair programmer state, notebook coverage, and pair usage
- `/pair notebook [full]` — open learnings; `full` also shows archived evidence and retired learnings
- `/reflect` — ask the main agent to record what it learned in the notebook
- `update_notebook` — the main agent and the pair record, supersede, or retire sourced learnings
- `search_session` — progressive search of this session's transcript and file-operation history; regex-like queries use a bounded safe subset and reject ambiguous grouped or repeated patterns
- `revisit_note` — exact source lookup by a known observation or reflection ID

The pair programmer's operational settings use the `pair` key in global `~/.pi/agent/settings.json` or trusted project `.pi/settings.json`; project values override global values. The pair programmer's model and thinking policy come from the user-global `pair` model profile. `PI_PAIR_NOTEBOOK_PASSIVE` disables pair programmer notebook automatic maintenance while preserving reads and explicit main-agent updates; it does not disable Pi's native compaction or automatic-compaction failure safety. See [Model profiles](model-profiles.md) and [`components/notebook/src/config.ts`](../components/notebook/src/config.ts).

The pair programmer binds `revisit_note` to the primary session and uses handle-bound `expand_receipt` for folded trajectory content. It does not receive `search_session`. Second opinions are mail to colleagues in the organization; those people use their own sessions and tools. Every top-level session and every intern loads `search_session`. Each top-level session, including each peer, keeps its own notebook. Interns and the `/btw` session do not receive the notebook tools. The `/btw` session loads only vroom (fast mode), compaction failure safety, and the search root guard.

## Where the notebook persists

Notebook records remain in Pi's append-only session JSONL, normally under:

```text
~/.pi/agent/sessions/--<cwd>--/*.jsonl
```

They are project-associated through Pi's session location, but they are not repository state and are not shared through Git. apple-pi intentionally does not create a `.pi/notebook` mirror because that would create a second source of truth and an implicit privacy policy.

## The self

Every root session also keeps a **self**: its account of itself in four parts (its story, how it works, what it holds itself to, and how its colleagues think). The session does not choose when to rewrite it: the harness starts a reflection in a forked continuation after a run that finished a task and when the context is about to be compacted, and only there does `update_self` work. The `<self>` section of the system prompt shows the self as of the session's start or last compaction; a new self joins the conversation as one appended message, so the cached prefix holds until compaction rebuilds it anyway. The self is not the notebook: the notebook holds sourced learnings about the work that the pair curates, distills, and retires; the self is the person's own account of itself and its colleagues, never distilled, never capped, and never touched by notebook maintenance. It lives as `organization-self` custom entries in the session's transcript (the latest on the branch wins) and is reported to the session-state runtime as the `self` fact for the views. See [the organization](organization.md#the-person).

## Pair programmer usage records

Pair reviews write one NDJSON line per model call to:

```text
~/.pi/agent/sidecar-usage/<session-id>.ndjson
```

Calls without a usable session ID go to `sidecar-usage/unscoped.ndjson`. Records contain identifiers and counters only: actor, provider, model, input, cache read/write, output, cost, duration, trigger, and status. They do not contain prompts or findings and do not affect compaction or notebook projection. A write failure is ignored so instrumentation cannot change pair behavior. A colleague's second opinion uses that colleague's own session and is not recorded here.

## Session titles

[`extensions/session-title.ts`](../extensions/session-title.ts) names sessions like people, so sessions are easy to tell apart in `/resume`, the tmux sidebar, and Agent World, where each is a character.

- **Names.** As an unnamed TUI or RPC session starts, it gets a first name and a family name drawn at random from curated local lists (about three hundred of each, from many cultures, playful but believable, in `components/session-title/src/names.ts`), such as "Ottoline Marchetti". No model is asked. The name differs from every other live session's name in the session-state database; when that cannot be read, the name is just picked. It is recorded as a `session-title` custom entry, so a resumed session keeps it. A session that still carries a topic title from the earlier title stages gets a human name the same way on its next start. The extension replaces only names it set itself: any other rename, from `/name`, Agent World, `pi --name`, or elsewhere, stops it for that session for good, also after a resume.

Work is named by an [explicit assignment and focus](organization.md#tasks-and-assignments), not by a model guessing intent after a turn or by the last ledger file edited. Session naming makes no model requests.

Interns, the `/btw` session, and print or JSON modes do not get automatic human names. A temporary peer that `pi_exec` starts gets one like any other person. Pi loads apple-pi from the checkout; changes take effect on the session's next start or `/reload`.
