# The pair programmer

The pair programmer gives the main agent a persistent, read-only pair programming partner. They follow the same work with the economical `pair` inference profile, keep a sourced notebook, share concise notes when they spot a concrete problem, and can ask the **consultant** teammate, using the deep profile, for an independent architectural opinion.

The responsibilities are distinct:

1. **Main agent** has the keyboard, speaks to the user, implements, decides, and validates.
2. The **pair programmer** keeps a second line of thought and the shared notebook while following the work.
3. The **consultant** is a senior software architect who joins episodically for difficult, consequential questions.
4. **Review** remains a separate end-to-end activity when requested.

The two programmers are peers with different capabilities in this session. The main agent does not direct or manage its partner. There is no mode selector for the pair programmer and no second persistent pairing role.

## Configuration

The pair programmer's state lives at `${PI_CODING_AGENT_DIR:-~/.pi/agent}/.pair-state.json`:

```json
{
  "enabled": true
}
```

The pair programmer always uses the user-global `pair` model profile. The consultant uses the `deep` profile.

```json
{
  "profiles": {
    "pair": {
      "model": "provider/economical-model",
      "thinking": "medium"
    },
    "deep": {
      "model": "provider/deep-model",
      "thinking": "high"
    }
  }
}
```

Commands:

- `/pair` or `/pair status`
- `/pair on`
- `/pair off`
- `/pair notebook [full]`

Disabling the pair programmer cancels queued and active consultant consultations.

## Behavior

The pair programming partner shares the main agent's screen rather than operating a second IDE. It receives a stable pairing policy followed by:

- recent user requests from the main session;
- the main agent's reasoning, text, tool calls, edit diffs, failures, and compact work receipts;
- active task and assumption context;
- a read-only projection of the shared notebook after compaction;
- optional global or trusted-project `PAIR.md` guidance.

`PAIR.md` is contextual pairing input. It cannot grant tools or force the partner to ask the consultant.

The partner has a deliberately narrow typed toolset:

- `share_note` stages one current, actionable `nit`, `concern`, or `blocker` for frontier confirmation before delivery to the main agent;
- `ask_consultant` asks the software architect for an independent opinion on a consequential `concern` or `blocker`;
- `update_notebook` records sourced observations, revises the current shared understanding, retires outdated reflections, and proposes safe drops for deterministic validation;
- `expand_receipt` opens one historical payload folded behind a receipt already shown on the shared trajectory;
- `revisit_note` follows a known notebook ID to its primary-session source evidence.

A receipt is a host-issued capability, not a path or query. It is bound to the issuing pair-session generation and active primary lineage. Expansion returns the immutable payload recorded at that point—such as a successful read result, write payload, or user-bash output—not current checkout state. Large payloads return stable opaque continuation handles under Pi's normal output limits. Source-entry IDs remain attached so notebook observations cite primary evidence rather than receipt IDs.

A review attempt commits its staged notes, consultant requests, and notebook update only after one complete successful response. Failed, aborted, truncated, timed-out, and stale attempts publish none of those effects. The pair programmer's instructions require distinct findings to be ordered by severity and shared once, while findings with one root cause are consolidated. The host does not silently discard findings by count.

The partner cannot navigate the repository, search the primary transcript, invoke arbitrary agents, run shell commands, call MCP or `pi_exec`, mutate state, or use arbitrary extension tools. This keeps its attention on user intent and the driver's trajectory. Broader repository investigation belongs to the main agent, the episodic consultant, or explicit review. `ask_consultant` requests a host-owned consultation rather than directly dispatching a sub-agent. The host retains routing, context assembly, throttling, cancellation, stale-result checks, and delivery.

Free-form prose does not start a consultant consultation. Generic uncertainty, style preference, known errors, and the mere possibility of a problem are not reasons to ask.

One conservative repeated-failure gate may also ask the consultant for help: the exact same failing bash command must fail three times in the recent work. A successful run resets that signal.

## Review timing and retries

The pair programmer uses an in-memory producer/consumer spool. Each `turn_end` synchronously appends one immutable, sequenced trajectory delta before any pair programmer construction starts. An idle reader claims the contiguous available prefix; arrivals while it is reviewing naturally become its next batch. A claim is retained until its complete transactional response succeeds, then removed and committed in order. Failed, incomplete, stale, or superseded claims remain exact retry work and never advance the committed frontier. Every main-agent turn returns without awaiting pair programmer construction, model work, tool calls, retry delay, consultant work, or delivery preparation.

Every direct finding, including a nit, is initially held with a stable host id. The next successful frontier review sees it alongside the newer trajectory. Repeating it with that id confirms it for nonterminal delivery; silence withdraws it. A confirmed finding steers at the next safe assistant boundary, so stale protection does not defer material advice until settlement. Findings first raised by the successful review covering the terminal turn are already current and can trigger a correction run without an impossible extra review.

The pair programmer uses Pi's native provider-stream inactivity timeout rather than a whole-review wall-clock deadline. It inherits the effective `httpIdleTimeoutMs` and provider timeout from the same global or trusted-project settings as normal Pi sessions. The default is five minutes. HTTP header/body activity or each WebSocket message resets the timeout, so total reasoning, streaming, and tool-call duration are not capped. A provider that emits no bytes while reasoning is indistinguishable from a stalled provider, so operators should tune this setting from observed stream-idle behavior.

The pair programmer also uses:

- zero provider transport retries;
- one automatic AgentSession retry;
- no whole-review `PairRuntime` retry.

Construction failure remains visible and retryable; the pair programmer does not fall back to a weaker raw-agent path.

## Consultant consultation

The host assembles consultation context from the main session and current checkout. The pair programming partner supplies the concern, not the packet.

The packet includes:

- the current and immediately relevant prior requests;
- compact trajectory, validation, and failure receipts;
- Git status, changed paths, diff stat, and full current diff;
- demand-paged evidence handles;
- the partner's concern, clearly labeled as a colleague's hypothesis rather than evidence.

The extension imposes no character ceiling on consultation packets or Git diffs. Pi and the selected model own context-window behavior.

The consultant joins as a fresh, foreground, hidden managed teammate. The consultation prompt presents the consultant as a senior software architect giving two programmers an independent second opinion. The consultant receives only read-only repository tools, primary-bound `revisit_note` and `search_session`, and the private typed `give_second_opinion` result tool. It does not receive the pair programmer sidecar, nested agents, `pi_exec`, mutation tools, ledger mutation tools, MCP, or project extension discovery.

The host accepts only a validated `give_second_opinion` call as the consultation result. If the consultant ends with prose instead, the managed runner keeps the same session alive, disables every tool except `give_second_opinion`, and allows one finalization turn. Prose is never parsed into a disposition.

The consultant returns exactly one disposition:

- `confirm`
- `refute`
- `refine`
- `uncertain`

Only typed `confirm` and `refine` findings are eligible for delivery. Refutations and uncertain dispositions are recorded but are not delivered as warnings.

## Routing and delivery

Only one consultant consultation runs at a time. Distinct requests queue. Equivalent concerns with unchanged evidence are collapsed; materially new evidence or higher severity remains eligible. Consultation starts are separated by four main-session turns. There is no lifetime or per-task consultation maximum.

Input review and output delivery are separate. The pair programmer continues consuming every trajectory delta, including an advisory-triggered correction run. Frontier-confirmed findings of every severity are sent through Pi's `steer` path at assistant-turn boundaries, so they can enter an active run before its next model step without aborting the response in flight. Terminal delivery waits until a successful pair programmer review covers the final turn; findings raised by that current review can trigger a correction run after settlement. Direct pair programmer findings do not wait for consultant consultation, working-state recapture, or consultant validation. Before a consultant finding is delivered, the host recaptures working-state fingerprints for the whole checkout or implicated paths. A stale result is recorded but not delivered. Equivalent direct and consultant findings collapse across sources, while distinct material findings remain visible. Delivery bookkeeping changes only after Pi accepts the send; a send failure leaves direct findings ready for retry without requiring another confirmation.

An advisory-triggered correction episode suppresses further outbound advice to avoid recursive steering, but it never suppresses pair programmer input consumption. The next user message reopens outbound delivery.

Asking the consultant is a request to investigate, not a finding. If the consultant fails, is cancelled, or does not submit a valid typed disposition after finalization, the host records the operational outcome and delivers nothing to the main agent. It never promotes the original concern or harness failure text into a note. Shutdown, session replacement, handoff, and pair programmer disablement cancel late delivery.

A delivered note remains a colleague's judgment. The main agent gives it serious consideration, inspects the current code, decides whether to act, implements, and validates.

## Material-finding acknowledgment

Every direct finding receives a stable host-generated id for frontier confirmation. Delivered nits do not require acknowledgment. For each delivered `concern` or `blocker`, the main agent records consideration with the primary-only `acknowledge_pair_findings` tool using one disposition and a concise reason:

- `address`: the finding applies and the main agent is acting on it;
- `decline`: current evidence shows the finding does not apply;
- `defer`: the finding is valid but outside the current authorized action.

Acknowledgment does not claim implementation or validation. The acknowledgment tool call, including its disposition and reason, is presented to the pair programmer in the next trajectory delta as direct feedback. The first subsequent assistant run is the normal acknowledgment opportunity. Once Pi reports the primary session settled, the host sends one reminder for any remaining material findings. If they remain open after the reminder run, the host records them as unacknowledged and stops; it does not create a third reminder or an autonomous loop. Acknowledgment and unacknowledged outcomes are append-only session telemetry and are restored across session reload or branch selection.

## Direct consultant use

The main agent can invoke the consultant through `agent` as an ordinary read-only sub-agent. That public path uses the normal agent prompt and optional `inherit_context`; it does not expose the pair programmer's harness context or typed adjudication protocol.

The partner's `ask_consultant` path uses a separate, hidden host operation. It cannot be selected through `agent` parameters.

## Status and accounting

The footer uses `q-pair` and shows pair programmer review plus consultant queued, running, or ready state. `/pair` reports direct findings, pending material acknowledgments, consultant dispositions, suppressions, stale results, usage, cost, and duration.

Sidecar telemetry records `pair` and `consultant` calls separately. Consultation outcomes are structural session entries with source, disposition, delivery/staleness state, trigger features, usage, and explicit unknown adoption and validation outcomes. Private hypothesis and finding text are not persisted there.

The pair programmer and the consultant use primary-bound recall. Neither starts another notebook-maintenance actor. Pi owns provider prompt caching; the extension only keeps stable prompt prefixes.
