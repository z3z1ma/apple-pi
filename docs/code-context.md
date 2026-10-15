# Code context

A context file is a Markdown file at `.context/<path>.md` that holds what the source file at `<path>` cannot show: invariants, hazards, rationale, and cross-file couplings. The agent receives the whole context file when it reads the source file. While a context file exists, the agent cannot edit or write the source file until the current context file is in its context. A source file without a context file is never gated.

| Layer | Source of truth |
| --- | --- |
| Files, symbols, imports, calls | Source code, queried live |
| Invariants, hazards, couplings, file-local rationale | `.context/` context files |
| Cross-cutting explanations | [`.wiki/`](wiki.md) |
| Current task state | [`.ledger/`](ledger.md) |

## Context file format

`.context/` sits at the project root: the Git worktree root, or the working directory outside Git. It mirrors the source tree, and each context file keeps the full source filename plus `.md`, so `main.py` and `main.ts` do not collide:

```text
.context/
└── app/
    ├── main.py.md
    └── server.ts.md
app/
├── main.py
└── server.ts
```

Only `.md` files under `.context/` are context files. A source file outside the project root has none.

A context file is plain Markdown with two kinds of section:

```md
## file

Application composition root. Keep business logic out.

See [[application-bootstrap]].

## symbol:create_app

Invariant: Authentication middleware executes before tenant resolution.

Why: Tenant resolution depends on authenticated identity. Reordering
these operations can create a cross-tenant isolation vulnerability.

Coupled: app/auth.py, web/src/auth/session.ts
Verify: tests/test_middleware.py
```

- `## file` holds file-wide notes; `## symbol:<name>` anchors a note to a function, class, or method, such as `## symbol:Router.get`.
- `Coupled:` lists repository paths whose contracts depend on the section.
- `Verify:` lists tests that check the section.
- `[[page]]` links to a wiki page.

Keep context files short and normative. Leave out summaries, call graphs, import lists, and anything else the code shows.

## Delivery and the edit gate

A context file is **live** when its marker, for example `<context-ref path="app/main.py" hash="sha256:…" />`, appears in a `read`, `edit`, or `write` result in the model's current context. The hash covers the context file content with CRLF line endings normalized and trailing whitespace trimmed.

- **Read.** A full or windowed `read` of `app/main.py` appends `--- CONTEXT: .context/app/main.py.md ---`, the whole context file, and its marker, unless the marker is live. A whole `read` of the context file itself appends only the marker.
- **Edit and write.** The gate applies only when a context file exists. An `edit` or `write` of `app/main.py` or `.context/app/main.py.md` fails while the context file exists and its marker is not live. The error tells the agent to read the file or its context file first; it does not include the context file text, so the agent loads the constraints in an ordinary turn and replans before it retries.
- **Context file mutation.** A successful `edit` or `write` of a context file appends the new marker, so the agent's own update counts as delivered. Writing a new context file is not gated.
- **Change on disk.** A changed context file has a new hash; the old marker no longer counts.
- **Compaction.** The check reads Pi's compaction-aware branch projection, so a marker that compaction removed is no longer live.
- **Forks and branches.** Each branch checks its own messages. A [forked continuation](forked-continuations.md) checks the fork's own conversation, so reads inside the fork unlock edits inside the fork.
- **Unreadable context files.** An empty or non-UTF-8 context file, or one that cannot be read, does not gate. A `read` of its file reports that it could not be loaded.

The extension loads in root sessions, ordinary subagent children, and `pi_exec` model workers; each checks its own context. Only top-level calls are covered. Calls a tool makes through `ctx.executeTool()`, such as reads and edits in a `pi_exec` program, carry `parentToolCallId`; they return raw file content and are not gated. Shell commands and other processes can also change files without the gate. The gate is a workflow guardrail, not a filesystem sandbox.

## `context_lint`

`context_lint` checks every `.md` file under the project's `.context/` directory and reports:

- a context file whose source file does not exist;
- a heading other than `## file` or `## symbol:<name>`, outside fenced code;
- a heading that appears twice in one context file;
- a `## symbol:` section whose last name segment (`get` in `Router.get`) does not appear as a word in the source file;
- `Coupled:` or `Verify:` paths, relative to the repository root, that do not exist;
- `[[wiki-links]]` that name no `.wiki/` page.

## Upkeep

Context files change through ordinary edits, with two automatic prompts:

- [Change reflection](change-reflection.md) asks, after code changes, for invariants and couplings the work revealed, updates to constraints the work changed on purpose, and context file moves that follow file renames.
- `/distill` lists a context file as a destination for a file-specific learning.

Both prompts let the agent create a missing context file, but only for a non-obvious invariant, hazard, or cross-file coupling that the work revealed and the code cannot show. The new section states its reason as `Why:`; `Coupled:` and `Verify:` stay optional. The agent's reply names what it changed so the user can review it:

- each context file it creates, as `Created context file: <path>`;
- each existing invariant it changes or removes, as `Changed invariant: <file>#<section>, because <reason>`.
