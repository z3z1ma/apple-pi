# Rules

Rules are policy as data. Before any tool call or edit runs, the harness checks it against the rules that apply, and a
refusal names the rule, so the agent changes the call and retries in the same turn. Rules come from two places:

- **`.pi/rules/` in a repository**, committed and shared by everyone who works there. A repository opts in by having the
  directory; one without it is not checked.
- **`~/.pi/agent/rules/`** for one person, applied in every repository.

Both hold a `policy.json` and the files it names, in the same format. Each level is checked on its own, and every
refusal from either is reported together. The harness itself hard-codes no policy: when a lesson cannot be written as a
rule, the gap is in what rules can see, and the fix is to show rules more, not to put the lesson in harness code.

## `policy.json`

```json
{
  "comments": "forbid",
  "rules": [
    {
      "grit": "no-native-select.grit",
      "message": "Use the shared Select component.",
      "includes": ["web/**/*.tsx", "!web/legacy/**"],
      "fires": "export const P = () => <select />;\n",
      "passes": "export const P = () => <Select />;\n"
    }
  ],
  "actions": [
    {
      "id": "kill-by-pattern",
      "pattern": "\\b(pkill|killall)\\b",
      "reason": "Kill only PIDs you started.",
      "fires": "pkill -f vitest",
      "passes": "kill 12345"
    }
  ],
  "scripts": [
    {
      "id": "commit-beside-edit",
      "on": "call",
      "script": "commit-beside-edit.js",
      "message": "Commit in a later message: parallel calls run concurrently.",
      "fires": [{ "tool": "bash", "input": { "command": "git commit -m x" }, "batch": [{ "tool": "edit", "input": { "path": "a.ts" } }] }],
      "passes": [{ "tool": "bash", "input": { "command": "git commit -m x" } }]
    }
  ]
}
```

There are four kinds of rule, from the most specific to the most general:

- **`comments: "forbid"`** refuses an edit that adds a source comment. Tool directives (`biome-ignore`,
  `@ts-expect-error`, `@vitest-environment` and similar) are exempt. Rationale goes to `.context/<path>.md`, intent to a
  better name, behavior to a test.
- **`rules`** are GritQL queries in `*.grit` files, applied to the edited file's whole proposed content on the paths its
  `includes` globs match (`!` excludes). Every match is a violation, reported at its line with the rule's `message`.
- **`actions`** are regular expressions tested against every shell command, including commands a codemode script runs.
- **`scripts`** are JavaScript function bodies for everything else (below).

## Code rules in any language

Code rules run on the standalone GritQL engine (`@getgrit/gritql`, the Node binding of
[biomejs/gritql](https://github.com/biomejs/gritql)), so they work for every language GritQL parses. A rule's
`language` line picks the parser: `js` (JavaScript and TypeScript, with JSX), `css`, `json`, `python`, `go`, `rust`,
`java`, `kotlin`, `csharp`, `ruby`, `php`, `sql`, `yaml`, `toml`, `hcl`, `markdown`, `elixir`, `solidity`. An unknown
language name is reported as a rule failure.

```
language python

`print($message)`
```

The engine runs in a short-lived child process per check, never inside the Pi session. Rules see the proposed content
in memory; nothing is written to disk. A query that does not compile either reports its error or matches nothing at
all, which is why every rule needs a `fires` sample.

## Script rules

A script rule is the body of a function of one argument, `event`, in a `.js` file next to `policy.json`. It returns
nothing to allow, a string (or several) to refuse with that reason, or `true` to refuse with the rule's `message`. It
runs in the same QuickJS sandbox as saved programs, with no file system, network, timers or tools, so it can only
judge the event it is given. Each rule gets its own copy of the event, so one rule cannot change what another sees.
Globs belong in `includes` (edit scripts), which uses the same matcher as code rules; inside a script, compare paths
with ordinary string methods.

`on: "call"` runs before every tool call, top-level or nested:

| Field | Meaning |
| --- | --- |
| `tool`, `input`, `id` | The call. |
| `path` | `input.path` of a path tool (`read`, `edit`, `write`, `ls`, `find`, `grep`), relative to the repository root, or `null`. |
| `paths`, `commands` | For `bash`: the literal paths, and the words of each simple command (`git commit -m x && ls` is `[["git", "commit", "-m", "x"], ["ls"]]`); `commands` is `null` and `paths` empty when the command uses expansion, substitution or a heredoc. |
| `nested` | The call comes from a codemode script, whose own code orders its calls. |
| `batch` | Every call of the same assistant message (itself included) with the same fields. Parallel calls run concurrently, so a call that depends on a sibling is racing it. Nested calls see only themselves. |

`on: "edit"` runs before every top-level `edit` and `write`, on the paths its `includes` match:

| Field | Meaning |
| --- | --- |
| `tool`, `path` | The tool and the repository-relative path. |
| `content` | The whole file as the edit would leave it, reconstructed with Pi's own edit tool (line endings and fuzzy matching included). |
| `added` | The text the edit adds: each `newText`, or the written content. |

Shell paths come from a literal parse: quotes and escapes are decoded, a `cd` away from the working directory or
unsupported syntax yields no paths. It can miss indirect dependencies (globs, imports, symlink aliases) and flag a
harmless mention; a rule built on it is a workflow guard, not a sandbox.

A rule that cannot run refuses by name and asks for the fix rather than going quiet: a script that throws, does not
parse or whose file is missing, a GritQL query that fails, an action pattern that does not compile, and a
`policy.json` that does not parse (which refuses every call until fixed). Calls and edits aimed at a rules directory,
judged by the file a path really names, are checked only against the samples of the rules they change, so no rule,
broken or over-broad, can block its own repair. Every rule that refuses a call is reported in one refusal, edit and
call rules alike.

This repository's `parallel-dependents` and `commit-beside-edit` scripts are examples: the first refuses a read or a
shell command that names a file a sibling call edits, and both of two writes to one file; the second refuses a commit
batched with an edit. Copy them to `~/.pi/agent/rules/` to have them everywhere.

## Agents write the rules

The system prompt tells agents to add rules liberally: whenever they meet a mistake a machine can detect, in review,
while fixing a bug, or from a lesson or a user correction. The diagnosing-bugs and tdd skills ask for a rule after a
fix, the pair programmer may suggest one, lesson distillation prefers rules over prose, and the capability steward
proposes rules from recorded evidence. In a repository without `.pi/rules/`, agents only offer to set it up, since the
rules are shared; rules for one person go in `~/.pi/agent/rules/`.

Every rule carries samples: a `fires` sample it must refuse and a `passes` sample it must allow. Code samples are
texts parsed in the rule's own `language`; action samples are commands; script samples are lists of events, each a
call (`tool`, `input`, and either a `batch` of sibling calls or `nested: true`) or an edit (`path`, `content`,
optional `added` and `tool`). The harness refuses a write to `policy.json`, a `.grit` file or a script file when a rule does not load, does
not refuse a `fires` sample or refuses a `passes` sample, and when two action or script rules share an id. `npm run
lint` here runs the code rules and edit scripts over every tracked file they apply to.

## Firings

Each refusal is recorded per rules directory and rule in `~/.pi/agent/repo-rules/firings.jsonl`, outside the
repository. The `repo_rules` tool lists every rule at both levels with how often it fired and when it last did, so a
rule that blocks good work can be narrowed and one that never fires can be questioned.

## Replaying a rule

`replay_rule` shows what a rule would have done before it exists, or what an existing one would have done since a
change: give it a rule id (`user:<id>` or `project:<id>` when both levels have one), a GritQL query (with `includes`
globs), an action pattern, or a script (with `on`), and a
window start (a date, or a revision such as the last commit that changed what the rule guards). It reads the Pi session
logs of this repository from then on and lists every recorded call, edit or shell command the rule would have refused,
each with an `entry:<session>/<id>` reference that `search_session` opens, plus anything it could not evaluate. Edits
are checked on the text they added: recorded edits carry no file, so an edit script sees `content` only for writes
and `null` for edits, and the report says so. Call scripts see each recorded call with its whole batch. A replay records no firings and changes nothing; calls made from codemode scripts are not
recorded as tool calls and are not replayed.

`session_evidence` finds candidates in the first place: it lists what this repository's sessions recorded since a date or
revision (learnings agents wrote in their notebooks, refusals by rules, failed tool calls other than shell commands that
exited nonzero, and calls of saved programs), each with its entry reference.
