# Pair

Pair gives the main agent a persistent, read-only pair programming partner. They follow the same work with the economical `pair` inference profile, keep a sourced notebook, share concise notes when they spot a concrete problem, and can ask the deep **Advisor** teammate for an independent architectural opinion.

The responsibilities are distinct:

1. **Main agent** has the keyboard, speaks to the user, implements, decides, and validates.
2. **Pair programming partner** keeps a second line of thought and the shared notebook while following the work.
3. **Advisor** is a senior software architect who joins episodically for difficult, consequential questions.
4. **Review** remains a separate end-to-end activity when requested.

The two programmers are peers with different capabilities in this session. The main agent does not direct or manage its partner. There is no Pair mode selector and no second persistent pairing role.

## Configuration

Pair state lives at `${PI_CODING_AGENT_DIR:-~/.pi/agent}/.pair-state.json`:

```json
{
  "enabled": true
}
```

Pair always uses the user-global `pair` model profile. Advisor consultations use the Advisor sub-agent's `deep` profile.

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

Disabling Pair cancels queued and active Advisor consultations.

## Pair behavior

The pair programming partner receives a stable pairing policy followed by:

- recent user requests from the main session;
- compact work receipts rather than successful tool bodies;
- active task and assumption context;
- a read-only projection of the shared notebook after compaction;
- optional global or trusted-project `PAIR.md` guidance.

`PAIR.md` is contextual pairing input. It cannot grant tools or force the partner to ask Advisor.

The partner has three private typed tools:

- `share_note` sends one current, actionable `nit`, `concern`, or `blocker` to the main agent;
- `ask_advisor` asks the software architect for an independent opinion on a consequential `concern` or `blocker`;
- `update_notebook` records sourced observations, revises the current shared understanding, retires outdated reflections, and proposes safe drops for deterministic validation.

The partner cannot invoke arbitrary agents, shell commands, MCP, `pi_exec`, mutation tools, or arbitrary extension tools. `ask_advisor` requests a host-owned consultation rather than directly dispatching a sub-agent. The host retains routing, context assembly, throttling, cancellation, stale-result checks, and delivery.

Free-form prose does not start an Advisor consultation. Generic uncertainty, style preference, known errors, and the mere possibility of a problem are not reasons to ask.

One conservative repeated-failure gate may also ask Advisor for help: the exact same failing bash command must fail three times in the recent work. A successful run resets that signal.

## Advisor consultation

The host assembles consultation context from the main session and current checkout. The pair programming partner supplies the concern, not the packet.

The packet includes:

- the current and immediately relevant prior requests;
- compact trajectory, validation, and failure receipts;
- Git status, changed paths, diff stat, and full current diff;
- demand-paged evidence handles;
- the partner's concern, clearly labeled as a colleague's hypothesis rather than evidence.

The extension imposes no character ceiling on consultation packets or Git diffs. Pi and the selected model own context-window behavior.

Advisor joins as a fresh, foreground, hidden managed teammate. The consultation prompt presents Advisor as a senior software architect giving two programmers an independent second opinion. Advisor receives only read-only repository tools, primary-bound `revisit_note` and `search_session`, and the private typed `give_second_opinion` result tool. It does not receive the Pair sidecar, nested agents, `pi_exec`, mutation tools, Ledger mutation tools, MCP, or project extension discovery.

The host accepts only a validated `give_second_opinion` call as the consultation result. If Advisor ends with prose instead, the managed runner keeps the same session alive, disables every tool except `give_second_opinion`, and allows one finalization turn. Prose is never parsed into a disposition.

Advisor returns exactly one disposition:

- `confirm`
- `refute`
- `refine`
- `uncertain`

Only typed `confirm` and `refine` findings are eligible for delivery. Refutations and uncertain dispositions are recorded but are not delivered as warnings.

## Routing and delivery

Only one Advisor consultation runs at a time. Distinct requests queue. Equivalent concerns with unchanged evidence are collapsed; materially new evidence or higher severity remains eligible. Starts are separated by a minimum number of main-session turns. There is no lifetime or per-task consultation maximum.

Before delivery, the host recaptures working-state fingerprints for the whole checkout or implicated paths. A stale result is recorded but not delivered. Settled results are delivered only at a safe primary-session boundary. Findings ready at the same boundary share one steer instead of interrupting serially.

A terminal note closes the current pairing episode. The partner does not review the main agent's resulting correction run; the next user message opens a new episode. This prevents one note from creating its own review loop.

Asking Advisor is a request to investigate, not a finding. If Advisor fails, is cancelled, or does not submit a valid typed disposition after finalization, the host records the operational outcome and delivers nothing to the main agent. It never promotes the original concern or harness failure text into a note. Shutdown, session replacement, handoff, and Pair disablement cancel late delivery.

A delivered note remains a colleague's judgment. The main agent gives it serious consideration, inspects the current code, decides whether to act, implements, and validates.

## Direct Advisor use

The main agent can invoke Advisor through `Agent` as an ordinary read-only sub-agent. That public path uses the normal Agent prompt and optional `inherit_context`; it does not expose Pair's harness context or typed adjudication protocol.

The partner's `ask_advisor` path uses a separate, hidden host operation. It cannot be selected through Agent parameters.

## Status and accounting

The footer uses `q-pair` and shows Pair review plus Advisor queued, running, or ready state. `/pair` reports direct findings, Advisor dispositions, suppressions, stale results, usage, cost, and duration.

Sidecar telemetry records `pair` and `advisor` calls separately. Consultation outcomes are structural session entries with source, disposition, delivery/staleness state, trigger features, usage, and explicit unknown adoption and validation outcomes. Private hypothesis and finding text are not persisted there.

Pair and Advisor use primary-bound recall. Neither starts another notebook-maintenance actor. Pi owns provider prompt caching; the extension only keeps stable prompt prefixes.
