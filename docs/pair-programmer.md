# The pair programmer

The pair programmer gives the main agent a persistent, read-only pair programming partner. They follow the same work with the economical `pair` inference profile, keep a sourced notebook, share concise notes when they spot a concrete problem, and can ask a colleague in the [organization](organization.md) for an independent opinion by mail.

The responsibilities are distinct:

1. **Main agent** has the keyboard, speaks to the user, implements, decides, and validates.
2. The **pair programmer** keeps a second line of thought while following the work. Both programmers curate the shared notebook.
3. **Colleagues** answer second-opinion requests as ordinary people in the organization, using their roles and minds.
4. **Review** remains a separate end-to-end activity when requested.

The two programmers work together with different capabilities in this session. The pair is a sidecar, not a separate person in the organization. The main agent does not direct or manage its partner. There is no mode selector for the pair programmer and no second persistent pairing role.

## Configuration

The pair programmer's state lives at `${PI_CODING_AGENT_DIR:-~/.pi/agent}/.pair-state.json`:

```json
{
  "enabled": true
}
```

The pair programmer always uses the user-global `pair` model profile. A colleague uses its catalog role's mind.

```json
{
  "profiles": {
    "pair": {
      "model": "provider/economical-model",
      "thinking": "medium"
    }
  }
}
```

Commands:

- `/pair` or `/pair status`
- `/pair on`
- `/pair off`
- `/pair notebook [full]`

Disabling the pair programmer drops its staged requests and stops waiting for in-flight sends. Mail already accepted by the runtime remains ordinary mail.

## Behavior

The pair programming partner shares the main agent's screen rather than operating a second IDE. It receives a stable pairing policy followed by:

- recent user requests from the main session;
- the main agent's reasoning, text, tool calls, successful write previews, edit diffs, failures, and compact work receipts;
- mail received by the main session, labeled as mail rather than user direction;
- the current shared learnings;
- optional global or trusted-project `PAIR.md` guidance.

`PAIR.md` is contextual pairing input. It cannot grant tools or force the partner to ask for a second opinion.

The partner has a deliberately narrow typed toolset:

- `share_note` stages one useful intervention for frontier confirmation: either a current, actionable `nit`, `concern`, or `blocker`, or a precise `question` that asks the driver to explain something or expose specific missing evidence;
- `ask_for_second_opinion(question, to?)` asks a colleague for an independent opinion;
- `directory` reads the main session's organization, including roles, managers, tasks, and track records;
- `update_notebook` records learnings the driver missed and merges duplicates; full reviews list every open learning to retain;
- `expand_receipt` opens one historical payload folded behind a receipt already shown on the shared trajectory;
- `revisit_note` follows a known notebook ID to its primary-session source evidence;
- `set_pair_attention` optionally chooses the next useful semantic checkpoint and attention level. It is a terminating, transactionally staged disposition rather than a navigation or execution capability.

A receipt is a host-issued capability, not a path or query. It is bound to the issuing pair-session generation and active primary lineage. Expansion returns the immutable payload recorded at that point—such as a successful read result, the remainder of a large write payload, user-bash output, or user-supplied image—not current checkout state. Successful writes show their content automatically within the trajectory's existing preview limit; larger writes keep the complete interaction behind a receipt. Write previews are pair-model input like the rest of the shared trajectory, so the `pair` profile should use a provider trusted with session content. User images appear only as placeholders and receipt handles in the trajectory; expansion returns their original image content blocks through Pi's normal tool-result path, just as an image-producing `read` would. Large payloads return stable opaque continuation handles under Pi's normal output limits. The pair is guided to expand receipts when folded evidence could materially affect its judgment, not as routine exploration. Source-entry IDs remain attached so notebook conclusions cite primary evidence rather than receipt IDs.

Visual inspection requires the model selected by the `pair` profile to declare image input support. Pi replaces image blocks with its normal unsupported-image placeholder for a text-only model.

A review attempt commits its staged notes, second-opinion requests, and notebook update only after one complete successful response. Failed, aborted, truncated, timed-out, and stale attempts publish none of those effects. The pair programmer's instructions require distinct findings to be ordered by severity and shared once, while findings with one root cause are consolidated. The host does not silently discard findings by count.

The partner can curate the notebook but cannot navigate the repository, search the primary transcript, invoke arbitrary agents, run shell commands, call MCP or `pi_exec`, mutate repository state, or use arbitrary extension tools. This keeps its attention on user intent and the driver's trajectory. Broader repository investigation belongs to the main agent, its colleagues, or explicit review. The pair can read the directory and compose a question; it has no peer-management tools.

Free-form prose does not send mail. The pair prompt gives the model room to exercise independent technical judgment while asking it to calibrate certainty and preserve the value of an interruption. A note is appropriate only when, without it, the main agent would likely deliver a wrong result or waste significant effort. A question is appropriate only when the absent evidence could materially change that judgment and no shown receipt answers it. The prompt asks for the lowest fitting severity, one or two sentences per note, and each issue raised once. Ordinary uncertainty, progress narration, praise, resolved issues, and an all-clear remain silent.

## Review timing and retries

The pair programmer uses an in-memory producer/consumer spool. Each `turn_end` synchronously appends one immutable, sequenced trajectory delta before pair construction or model work begins. Capturing a delta does not itself invoke the pair model. A review scheduler grants one permit for the complete accumulated prefix at meaningful checkpoints inside the active run:

- the first completed step after new user direction;
- entry into mutation or verification work;
- other meaningful work-phase transitions selected by the current attention lease;
- a consequential delegated result;
- any failed tool or assistant step;
- terminal evidence that remains unseen;
- an expedited frontier confirmation after the pair raises a finding or question.

Consecutive exploration, execution, mutation, or verification steps accumulate rather than producing one review per tool continuation. Arrivals during an in-flight review remain deferred until another permit is due. A balanced starvation safeguard reviews pending evidence after five active minutes or about 8,000 newly rendered trajectory tokens, whichever comes first. Idle user time does not count. Silent reviews widen this safeguard gradually; new user direction, mutation, verification, failure, or an intervention restores close attention.

The pair can use `set_pair_attention` as its final action to select `close`, `routine`, or `relaxed` attention and choose normal wake conditions such as mutation, verification, delegated result, or another phase transition. The host always retains orientation, failure, terminal, starvation, and frontier-confirmation wakeups. Failed, aborted, truncated, or stale attempts commit no attention change.

A claim remains owned until its complete transactional response succeeds, then commits in order. Failed or incomplete claims remain exact retry work and never advance the committed frontier. Newer evidence or a later starvation checkpoint can retry that claim; the runtime does not spin a whole-review retry loop. Every main-agent turn returns without awaiting pair construction, model work, tool calls, retry delay, mail delivery, or delivery preparation.

Every direct finding or question is initially held with a stable host id. A newly raised intervention expedites the next frontier review: queued newer evidence is reviewed immediately, otherwise the next completed primary step bypasses normal pacing. Repeating the finding with its id confirms it for nonterminal delivery; silence withdraws it. A confirmed intervention steers at the next safe assistant boundary. Interventions first raised by the successful review covering the terminal turn are already current and can trigger a correction run without an impossible extra review.

The private pair conversation continues through Pi's normal model-owned compaction at the selected model's context boundary. Review pacing does not add a second context limit, rolling window, cache reset, or proactive compaction policy.

The pair programmer uses Pi's native provider-stream inactivity timeout rather than a whole-review wall-clock deadline. It inherits the effective `httpIdleTimeoutMs` and provider timeout from the same global or trusted-project settings as normal Pi sessions. The default is five minutes. HTTP header/body activity or each WebSocket message resets the timeout, so total reasoning, streaming, and tool-call duration are not capped. A provider that emits no bytes while reasoning is indistinguishable from a stalled provider, so operators should tune this setting from observed stream-idle behavior.

The pair programmer also uses:

- zero provider transport retries;
- one automatic AgentSession retry;
- no whole-review `PairRuntime` retry.

Construction failure remains visible and retryable; the pair programmer does not fall back to a weaker raw-agent path.

## Second opinions

The pair asks with `ask_for_second_opinion(question, to?)`. With no `to`, the recipient is the main session's manager. With no manager, the tool refuses and asks the pair to name someone; it says when there is nobody else in the organization. The operator is contacted only when explicitly named. Names and session ids use the same addressing rules as ordinary mail.

The question is staged until the pair finishes a complete, current review. It then starts a mail thread in the main session's name, marked as from its pair. Delivery status is appended to the private pair conversation without starting another review; a failed send also gives the operator a warning. The main session and recipient are participants, so a reply reaches the main session through the normal mail path. The pair sees that reply in the live trajectory and in later reseeds, labeled as mail rather than as operator instructions.

The pair starts no model run of its own for a second opinion. A colleague answers the question as normal work, and the main session judges its evidence.

## Routing and delivery

Input review and output delivery are separate. The pair keeps consuming the trajectory during an advisory-triggered correction run. Frontier-confirmed findings of every severity are steered at assistant-turn boundaries. Terminal delivery waits for a successful pair review that covers the final turn. Findings raised by that review can trigger a correction run after settlement. Delivery bookkeeping changes only after Pi accepts the send; a send failure leaves findings ready for retry without another confirmation.

An advisory-triggered correction episode suppresses further outbound advice, while input consumption continues. The next user message reopens advice delivery. Second-opinion replies are ordinary mail, not a second path for injecting pair findings.

In the TUI, each note occupies one plain bullet row: `● TYPE text`, with a color-coded circle and `CONCERN`, `BLOCKER`, `QUESTION`, or `NIT` label. Notes restored from older transcripts keep their original source label. Single notes and batches use the same rows, without a heading, border, or leading or trailing blank lines. Whitespace is flattened and long text is truncated to the terminal width. Pi's expand toggle for tool output leaves these rows unchanged. The main agent always receives the full text.

A delivered note remains a colleague's judgment. The main agent gives it serious consideration, inspects the current code, decides whether to act, implements, and validates.

## Material-finding acknowledgment

Every direct finding or question receives a stable host-generated id for frontier confirmation. Questions and delivered nits do not require acknowledgment. For each delivered `concern` or `blocker`, the main agent records consideration with the primary-only `acknowledge_pair_findings` tool using one disposition and a concise reason:

- `address`: the finding applies and the main agent is acting on it;
- `decline`: current evidence shows the finding does not apply;
- `defer`: the finding is valid but outside the current authorized action.

Acknowledgment does not claim implementation or validation. The acknowledgment tool call, including its disposition and reason, is presented to the pair programmer in the next trajectory delta as direct feedback. The first subsequent assistant run is the normal acknowledgment opportunity. Once Pi reports the primary session settled, the host sends one reminder for any remaining material findings. If they remain open after the reminder run, the host records them as unacknowledged and stops; it does not create a third reminder or an autonomous loop. Acknowledgment and unacknowledged outcomes are append-only session telemetry and are restored across session reload or branch selection.

## Status and accounting

The footer uses `q-pair` and shows pair review activity and cost. `/pair` reports findings, pending material acknowledgments, review pacing, notebook state, usage, and context size.

Sidecar telemetry records the pair's model calls. Every request within one review carries the same privacy-safe review id, checkpoint reason, batch item/token counts, active wait, and attention level. This distinguishes review frequency from pair-side tool continuations without persisting trajectory, command, path, receipt, question, or finding text. Colleagues' work is accounted for in their own sessions.

The pair programmer uses primary-bound recall and starts no second notebook-maintenance actor. Pi owns provider prompt caching; the extension only keeps stable prompt prefixes.
