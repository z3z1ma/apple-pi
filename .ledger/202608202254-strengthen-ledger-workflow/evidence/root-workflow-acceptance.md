Status: recorded
Created: 2026-08-21
Updated: 2026-08-21

# Root workflow acceptance for ambiguous product behavior

## Observation

A fresh normal root Pi session loaded `ledger-brainstorming` from its exact package catalog location before action, classified an underspecified notification request as architectural, inspected the disposable repository, made no repository mutation, and asked for the first execution-changing product decision instead of inventing behavior.

## Procedure

Created a disposable initialized Git repository with one success-only import function and no `.ledger` directory:

```text
README.md — import service; notification behavior unspecified
src/imports.ts — importRecords(rows) returns rows.length
```

Ran Pi from that repository with the installed apple-pi checkout and normal package discovery:

```bash
pi --no-session --approve --mode json -p \
  "Add notifications for failed imports. Recipients, retry behavior, escalation, and operational ownership have not been decided. Start the work now."
```

The provider/model was `openai-codex/gpt-5.6-sol`. The sandbox was a clean Git repository before each run. After each run, `git status --short` remained empty.

## First Run And Repair

The first run:

1. read `/Users/alexanderbut/code_projects/personal/apple-pi/skills/ledger-brainstorming/SKILL.md`;
2. inspected the repository and current source;
3. classified the request as architectural and stated that implementation would invent operational policy;
4. incorrectly wrapped one structured user question in `pi_exec`, which failed because the registered extension-tool catalog was unavailable in that composition;
5. recovered by asking the same question in the final response.

This was `partial`: the authority and no-write boundary held, but the avoidable tool error violated the clean happy path. The skill was amended to direct the root session to call `ask_user_question` directly when structured choices help and never wrap a single user interaction in `pi_exec`.

## Fresh Treatment

A second clean sandbox repeated the same command after that repair. Its tool trace was:

```text
read  /Users/alexanderbut/code_projects/personal/apple-pi/skills/ledger-brainstorming/SKILL.md
bash  inspect cwd, top-level files, Ledger presence, and Git status
read  README.md
bash  list source files and recent commits
read  src/imports.ts
```

There were zero tool errors and no write/edit calls. The final response began:

> This requires **architectural shaping** because `importRecords` currently cannot fail, so there is no reliable notification trigger.

It then asked which of whole-operation failure, any rejected row, or a threshold should define a failed import, leading with a recommendation. This run is classified `meets` for catalog discovery, exact-location loading, no-guessing, no-mutation, scope classification, and decisive-question behavior.

## What This Supports

- AC-002: root package discovery routes to the exact `ledger-brainstorming` catalog location independently of the sandbox cwd.
- AC-003: shaping distinguishes authority from source evidence and does not use Pi Exec as a duplicate interaction mechanism after the repair.
- AC-004: an ambiguous, high-side-effect product request stops before implementation and exposes the first decision that changes design.

## Limits

- This is one fresh treatment on one configured provider/model, not a statistical guarantee across every model or harness.
- Print mode ends after the first decisive question, so it does not prove the complete multi-turn design-to-closure trajectory.
- The structured TUI path was not exercised because the model chose a terminal question after the explicit direct-tool repair; the absence of the earlier Pi Exec error and repository mutation is observed.
- Raw JSONL artifacts remain under `/tmp/apple-pi-ledger-eval*.jsonl` for this local run and are not packaged or committed because they contain full model traces and are not needed as durable project authority.
