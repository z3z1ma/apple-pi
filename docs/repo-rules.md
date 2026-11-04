# Repository rules

A repository opts in by having a `.pi/rules/` directory. From then on the harness checks every `edit` and `write` against
the repository's rules before the change lands, and every shell command against its action rules. A refusal names the
rule, so the agent fixes the change and retries in the same turn. Repositories without `.pi/rules/` are not checked.

## `.pi/rules/policy.json`

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
  ]
}
```

- **`comments: "forbid"`** refuses a change that adds a comment to source. Tool directives (`biome-ignore`,
  `@ts-expect-error`, `@vitest-environment` and similar) are exempt. Rationale goes to `.context/<path>.md`, intent to
  a better name, behavior to a test.
- **`rules`** are GritQL queries in `.pi/rules/*.grit`, each applied to the paths its `includes` globs match (`!`
  excludes). Every match is a violation, reported at its line with the rule's `message`.

## Code rules in any language

Code rules run on the standalone GritQL engine (`@getgrit/gritql`, the Node binding of
[biomejs/gritql](https://github.com/biomejs/gritql)), so they work for every language GritQL parses. A rule's
`language` line picks the parser: `js` (JavaScript and TypeScript, with JSX), `css`, `json`, `python`, `go`, `rust`,
`java`, `kotlin`, `csharp`, `ruby`, `php`, `sql`, `yaml`, `toml`, `hcl`, `markdown`, `html`, `elixir`, `solidity`.

```
language python

`print($message)`
```

The engine runs in a short-lived child process per check, never inside the Pi session. Rules see the proposed content
in memory; nothing is written to disk. A query that does not compile either reports its error or matches nothing at
all, which is why every rule needs a `fires` sample.
- **`actions`** are regular expressions tested against each shell command.

## Agents write the rules

The system prompt tells agents to add rules liberally: whenever they meet a mistake a machine can detect, in review,
while fixing a bug, or from a lesson or a user correction. The diagnosing-bugs and tdd skills ask for a rule after a
fix, the pair programmer may suggest one, and lesson distillation prefers rules over prose. In a repository without
`.pi/rules/`, agents only offer to set it up; the rules are committed for everyone who works there.

Every rule and action carries a `fires` sample it must flag and a `passes` sample it must allow. Code samples are
parsed in the rule's own `language`. The harness refuses a write to `policy.json` or to a listed
`.grit` file when a rule does not load or misbehaves on its samples.

## Firings

Each refusal is recorded per repository and rule in `~/.pi/agent/repo-rules/firings.jsonl`, outside the repository. The
`repo_rules` tool lists every rule with how often it fired and when it last did, so a rule that blocks good code can be
narrowed and one that never fires can be questioned.

## In every repository

A commit sent in the same message as an `edit` or `write` is refused everywhere: parallel calls run concurrently, so
the commit would take the files before the edits land.
