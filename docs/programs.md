# Programs

A program composes tools in code instead of in many separate turns: it calls tools in parallel, filters their output, and returns only the evidence the model needs. Programs run on Pi's built-in `codemode`, a JavaScript sandbox (QuickJS) whose scripts reach the outside world only through `tools.<name>(args)`. See Pi's `docs/codemode.md` for the script grammar, result shapes and limits.

Apple Pi adds three things on top: saved programs, peer turns, and pipes for the shell inside scripts. It activates `codemode` in every root session; the built-in must be enabled (it is unless `settings.json` lists `-builtin:codemode`).

## Saved programs

A JavaScript file in a trusted project's `.pi/programs/` becomes the tool `program_<name>` (hyphens become underscores). Its first line is a directive that declares the program:

```js
// @program: {"description": "Count TODO markers per package.", "parameters": {"root": {"type": "string"}, "limit": {"type": "integer", "default": 5}}, "required": ["root"]}
const output = await tools.bash({ command: `rg -c TODO ${inputs.root}` });
return output.trim().split("\n").slice(0, inputs.limit);
```

- `description` is the tool's description; `parameters` maps each argument to a JSON Schema, and `required` lists the mandatory ones.
- The arguments, with schema defaults filled in, arrive as the constant `inputs`.
- The rest of the file is a codemode script body: top-level `await` and `return`, `text()`, `console.log()`, and an optional `// @options: {...}` line.
- Programs register when a session starts, after compaction, and before the first turn of a session, never mid-conversation, so the prompt cache survives. A malformed program is skipped.
- A program runs in its own sandbox, so it also works when a codemode script calls it.

The `// @program:` and `// @options:` lines are directives, so `.pi/rules` comment bans do not refuse them.

## Peer turns

Two tools give a script model turns on other people. Both are callable only from scripts and saved programs (`codemode` exposure), and only by managing roles and unroled organization roots:

- `tools.temporary_peer({ role, task, context?, outputSchema? })` starts a temporary peer in a catalog role, waits for its answer, and discards it (its transcript stays).
- `tools.colleague({ person, task, context?, outputSchema? })` gives an awake colleague a turn in their own session and waits for the answer; the colleague stays as they are.

Each resolves to `{ status, text, value?, error?, toolCalls }`. `context` is JSON the person reads from a file beside their task; `outputSchema` makes them return a validated `value`.

## Measuring a program

`compare_program({ program, tasks, samples, role?, base? })` measures whether a candidate saved program helps. For each task (what a peer is asked to do, and a shell `check` whose exit 0 means the work is correct) it runs `samples` (three or more) rounds; each round runs the task twice, in fresh git worktrees of the repository at `base`, once with the program in the worktree's `.pi/programs/` and once without, the arm that goes first alternating by round. A temporary peer (`implementation-engineer` unless `role` is given) does the task in the worktree, which it trusts (`--approve`) so the program loads; the check runs only after a completed turn. The report lists, per task and arm, how many runs were correct, then tool calls, tokens, cost and seconds for every run, and how often the peers used the program. Before running, the operator sees the run count and an estimate (the median recorded reviewer turn's cost times the runs) and must agree; a session without an interactive operator cannot start one. Managing roles, unroled roots and the capability steward may call it. A failed peer turn is that run's result; a failure to create or remove a worktree, to open or close the peer's program, or an abort ends the comparison. `/find-improvements` gives such work to a `capability-steward` (see [repository rules](repo-rules.md) for its rule evidence).

## The shell inside scripts

A `bash` call that a script or program makes (its call id is `<parent>/<n>`) runs on pipes rather than a pseudo-terminal, is never rewritten by RTK and never goes to the background, so the script gets plain output. It resolves to the command's text; a failing command rejects.

## Where it lives

- `components/programs/src/programs.ts`: discovery, the `// @program:` header, and the sandbox that runs a saved program.
- `components/programs/src/peers.ts`: `temporary_peer` and `colleague`, on the session-state runtime's peer programs.
- `skills/ralph/references/ralph.js`: the Ralph loop as a saved program.
