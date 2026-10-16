# PROTOTYPE: agent sidebar (throwaway)

**Question.** Does a live Textual sidebar in a real tmux pane answer "who needs me?", "which is which?", and "what is it doing?" at a glance? Which of three structurally different layouts works best?

## Run

From any tmux pane:

```bash
.ledger/202610152308-tmux-agent-tracking/prototype/run.sh        # toggle; optional width, default 42
```

Or bind it for the session: `tmux bind-key a run-shell "$PWD/.ledger/202610152308-tmux-agent-tracking/prototype/run.sh"`.

It splits a full-height pane on the right of the current window without taking focus. Run it again to close it. Requires `uv`; the first start installs Textual.

## Keys

| Key | Action |
| --- | --- |
| click | jump to that agent's pane (works without focusing the sidebar) |
| `j` / `k` | move the cursor (sidebar must be focused) |
| `enter` | jump to the selected agent |
| `x` / `X` | mark the selected / every agent as seen |
| `v` / `V`, or the pill arrows | next / previous variant |
| `q` | quit |

## Variants

- **Cards in lanes** (default, chosen merge): B's big count and NEEDS YOU / WORKING / QUIET lane headings, with A's cards inside every lane. Quiet agents keep compact cards.
- **A · Cards**: one bordered card per agent. Border colour is the state; title is the name; body is the ledger task, the last tool call, and a 30-minute activity sparkline with context size and cost.
- **B · Lanes**: a big "need you" count, then NEEDS YOU / WORKING / QUIET lanes. Quiet agents collapse to one line.
- C (Pulse, one line and a heartbeat per agent) was cut: the operator preferred A and B.

## States

| Glyph | State | Meaning |
| --- | --- | --- |
| `?` yellow | asking you | a blocking prompt is open |
| `✓` green | done | settled since you last focused its pane |
| spinner, mauve | working | turn in progress |
| `·` grey | idle | settled and seen |

An agent that enters "asking you" or "done" moves to the top and flashes for four seconds.

## Data and limits

- Reads the existing state records, `tmux`, each session's JSONL (last tool call, model, context tokens, cost), and the ledger link in `.ledger/*/history.json`. Names: Pi session name, else ledger task title, else project directory; never prompt text.
- "Seen" times persist in `$TMPDIR/pi-sidebar-PROTOTYPE-seen.json`. On first run every idle agent counts as done; clear with `X` or by visiting.
- One sidebar per window; it does not follow you across windows.
- Measured: about 3% CPU and 97 MB RSS with 7 agents (1 s poll, 10 fps spinner).

## Helpers

- `agents.py`: the data layer; `python agents.py` prints the joined rows.
- `shoot.py <dir> [w] [h]`: headless PNG of each variant on live data.
- `tmux_shot.py <target> <png>`: PNG of a real tmux pane from `capture-pane -e`.
