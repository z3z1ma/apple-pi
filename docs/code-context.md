# Code context sidecars

A Markdown sidecar under the project's `.context/` directory holds what a source file's code cannot show: invariants, hazards, rationale, and cross-file couplings. The agent receives the whole sidecar when it reads the file, and it cannot edit or write the file until the current sidecar is in its context.

| Layer | Source of truth |
| --- | --- |
| Files, symbols, imports, calls | Source code, queried live |
| Invariants, hazards, couplings, file-local rationale | `.context/` sidecars |
| Cross-cutting explanations | [`.wiki/`](wiki.md) |
| Current task state | [`.ledger/`](ledger.md) |

## Sidecar format

`.context/` sits at the project root: the Git worktree root, or the working directory outside Git. It mirrors the source tree, and each sidecar keeps the full source filename plus `.md`, so `main.py` and `main.ts` do not collide:

```text
.context/
└── app/
    ├── main.py.md
    └── server.ts.md
app/
├── main.py
└── server.ts
```

Only `.md` files under `.context/` are sidecars. A source file outside the project root has none.

A sidecar is plain Markdown with two kinds of section:

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

Keep sidecars short and normative. Leave out summaries, call graphs, import lists, and anything else the code shows.

## Delivery and the edit gate

A sidecar is **live** when its marker, for example `<context-ref path="app/main.py" hash="sha256:…" />`, appears in a `read`, `edit`, or `write` result in the model's current context. The hash covers the sidecar content with CRLF line endings normalized and trailing whitespace trimmed.

- **Read.** A full or windowed `read` of `app/main.py` appends `--- CONTEXT: .context/app/main.py.md ---`, the whole sidecar, and its marker, unless the marker is live. A whole `read` of the sidecar itself appends only the marker.
- **Edit and write.** An `edit` or `write` of `app/main.py` or `.context/app/main.py.md` fails while the sidecar exists and its marker is not live. The error tells the agent to read the file or its sidecar first; it does not include the sidecar text, so the agent loads the constraints in an ordinary turn and replans before it retries.
- **Sidecar mutation.** A successful `edit` or `write` of a sidecar appends the new marker, so the agent's own update counts as delivered. Writing a new sidecar is not gated.
- **Change on disk.** A changed sidecar has a new hash; the old marker no longer counts.
- **Compaction.** The check reads Pi's compaction-aware branch projection, so a marker that compaction removed is no longer live.
- **Forks and branches.** Each branch checks its own messages. A [forked continuation](forked-continuations.md) checks the fork's own conversation, so reads inside the fork unlock edits inside the fork.
- **Unreadable sidecars.** An empty or non-UTF-8 sidecar, or one that cannot be read, does not gate. A `read` of its file reports that it could not be loaded.

The extension loads in root sessions, ordinary subagent children, and `pi_exec` model workers; each checks its own context. Only top-level calls are covered. Calls a tool makes through `ctx.executeTool()`, such as reads and edits in a `pi_exec` program, carry `parentToolCallId`; they return raw file content and are not gated. Shell commands and other processes can also change files without the gate. The gate is a workflow guardrail, not a filesystem sandbox.

## `context_lint`

`context_lint` checks every `.md` file under the project's `.context/` directory and reports:

- a sidecar whose source file does not exist;
- a heading other than `## file` or `## symbol:<name>`, outside fenced code;
- a heading that appears twice in one sidecar;
- a `## symbol:` section whose last name segment (`get` in `Router.get`) does not appear as a word in the source file;
- `Coupled:` or `Verify:` paths, relative to the repository root, that do not exist;
- `[[wiki-links]]` that name no `.wiki/` page.

## Upkeep

Sidecars change through ordinary edits, with two automatic prompts:

- [Change reflection](change-reflection.md) asks, after code changes, for invariants and couplings the work revealed, updates to constraints the work changed on purpose, and sidecar moves that follow file renames. Each changed or removed invariant is named in the reflection's reply as `Changed invariant: <file>#<section>, because <reason>`.
- `/distill` lists a sidecar as a destination for a file-specific learning and asks for the same report.
