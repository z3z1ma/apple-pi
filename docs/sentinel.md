# Sentinel

Sentinel is the optional persistent, read-only supervisor for the main agent. It watches the main agent's trajectory with the economical `sentinel` inference profile, emits direct findings when it can verify a local problem cheaply, and escalates difficult claims to the existing deep **Advisor** sub-agent.

The roles are distinct:

1. **Main agent** owns implementation, decisions, and validation.
2. **Sentinel** continuously watches the trajectory when enabled.
3. **Advisor** is an episodic, read-only sub-agent that adjudicates selected escalations.
4. **Review** remains a separate end-to-end activity when requested.

There is no Sentinel mode selector and no second persistent supervision role.

## Configuration

Sentinel state lives at `${PI_CODING_AGENT_DIR:-~/.pi/agent}/.sentinel-state.json`:

```json
{
  "enabled": true
}
```

Sentinel always uses the user-global `sentinel` model profile. Advisor consultations use the Advisor sub-agent's `deep` profile.

```json
{
  "profiles": {
    "sentinel": {
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

- `/sentinel` or `/sentinel status`
- `/sentinel on`
- `/sentinel off`

Disabling Sentinel cancels queued and active Advisor consultations.

## Sentinel behavior

Sentinel receives a stable supervision policy followed by:

- recent primary-session user requests;
- compact trajectory receipts rather than successful tool bodies;
- active task and assumption context;
- a read-only observational-memory projection after compaction;
- optional global or trusted-project `WATCHDOG.md` guidance.

`WATCHDOG.md` is untrusted review input. It cannot grant tools or force an escalation.

Sentinel has two private typed tools:

- `advise` emits a current, actionable `nit`, `concern`, or `blocker`;
- `escalate` submits a `concern` or `blocker` hypothesis for host-controlled Advisor adjudication.

Sentinel cannot invoke agents, shell commands, MCP, `pi_exec`, mutation tools, or arbitrary extension tools. It does not invoke Advisor directly. The host owns routing, context assembly, throttling, cancellation, staleness checks, and delivery.

Free-form prose does not trigger Advisor. Generic uncertainty, style preference, known errors, and the mere possibility of a problem are not escalation reasons.

The host also has one conservative repeated-failure gate: the exact same failing bash command must fail three times in the recent trajectory before it can create an escalation. A successful run resets that signal.

## Advisor consultation

The host assembles consultation context from the primary session and current checkout. Sentinel does not author the packet.

The packet includes:

- the current and immediately relevant prior requests;
- compact trajectory, validation, and failure receipts;
- Git status, changed paths, diff stat, and full current diff;
- demand-paged evidence handles;
- the Sentinel hypothesis, labeled as an untrusted claim;
- an optional main-agent draft, labeled as unverified.

The extension imposes no character ceiling on consultation packets or Git diffs. Pi and the selected model own context-window behavior.

Advisor runs as a fresh, foreground, hidden managed sub-agent. It receives only read-only repository tools, primary-bound `memory_source` and `session_search`, and the private typed `report_consultation` result tool. It does not receive Sentinel, nested agents, `pi_exec`, mutation tools, Ledger mutation tools, MCP, or project extension discovery.

Advisor returns exactly one disposition:

- `confirm`
- `refute`
- `refine`
- `uncertain`

Refutations are recorded but are not delivered as warnings.

## Routing and delivery

Only one Advisor consultation runs at a time. Distinct escalations queue. Equivalent claims with unchanged evidence are collapsed; materially new evidence or higher severity remains eligible. Starts are separated by a minimum number of primary turns. There is no lifetime or per-task consultation maximum.

Before delivery, the host recaptures working-state fingerprints for the whole checkout or implicated paths. A stale result is recorded but not delivered. Settled results are delivered only at a safe primary-session boundary.

If Advisor fails or returns no typed disposition, the Sentinel claim may be delivered as **unadjudicated** with the failure reason. It is never presented as confirmed or refuted. Shutdown, session replacement, handoff, and Sentinel disablement cancel late delivery.

A delivered finding remains advice. The main agent inspects current code, decides whether to act, implements, and validates.

## Direct Advisor use

The main agent can invoke the Advisor sub-agent directly through `Agent`.

Use `context_mode: "consultation"` when the harness should assemble current primary evidence. This path is fresh, foreground-only, read-only, non-recursive, and returns a typed disposition. Ordinary Advisor delegation remains available when the prompt itself is a complete architecture, root-cause, or simplification handoff.

## Status and accounting

The footer uses `q-sentinel` and shows Sentinel review plus Advisor queued, running, or ready state. `/sentinel` reports direct findings, Advisor dispositions, suppressions, stale results, usage, cost, and duration.

Sidecar telemetry records `sentinel` and `advisor` calls separately. Consultation outcomes are structural session entries with source, disposition, delivery/staleness state, trigger features, usage, and explicit unknown adoption and validation outcomes. Private hypothesis and finding text are not persisted there.

Sentinel and Advisor use primary-bound recall. Neither starts an observational-memory curator. Pi owns provider prompt caching; the extension only keeps stable prompt prefixes.
