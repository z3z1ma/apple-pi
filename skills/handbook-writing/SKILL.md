---
name: handbook-writing
description: "Write the organization's handbook: process skills, roles, AGENTS.md, and other guidance agents read. Use when creating or editing a skill, a role, an AGENTS.md, or an organization prompt section."
---

# Handbook writing

The handbook is how this organization works. Skills are its processes, roles are its jobs, and `AGENTS.md` files and organization prompt sections are its standing instructions. A capable model reads each one at the moment it acts. Write the least that makes that model act well.

## Write for a capable reader

- State the goal, the boundary, and how to tell the work is done. Leave the method to the reader's judgment, except where order matters or other people rely on a convention.
- End each step on a criterion the reader can check. Ask for exhaustiveness where it matters: "every changed path covered" demands more than "list the changes".
- Phrase the behavior you want. Keep a prohibition only as a hard guardrail, and pair it with the positive target.
- Use a word the model already knows (_tight_, _red_, _tracer bullet_) instead of a sentence that explains the idea. Coin a term only when none fits, and define it once.
- Give each meaning one home. Point to its owner (a doc, a role, a command's `--help`) instead of copying it. Write down only what the reader cannot find by looking: the unwritten convention, the reason, the trap.
- Keep in the file what every case needs. Move what only some cases need to a linked file, and word the link so it says when to read it.
- Leave out history, provenance, and what the model already does by default. Record imported sources in `THIRD_PARTY_NOTICES.md`.

A skill's description and a role's mandate are always in context, and their wording decides when the material is reached. Start with what it is, then give one trigger per distinct case.

## Processes

A process skill describes work that people in the organization do together. State:

- **Perspectives**: the views the work needs, each with a default role from `roles/` (for example `code-review-specialist`). Whoever runs the process adjusts the team with judgment.
- **Chair**: who runs it and owns the result.
- **Handoffs**: who gives what to whom, and where: the task thread or mail for work, `meet` when people must answer each other's positions, the team channel for shared context.
- **Sign-off**: the points where the operator decides, and how they are asked. Everything else stays readable in threads.
- **Done**: the observable result and how it is verified.
- **Close**: a process with several people ends with a short team discussion that feeds the task's `retrospective.md`.

Staff with standing people first: find someone with matching experience in the directory, call them in if they are at home, and hire when nobody fits. Let go a person who should not persist. The coordinator holds the standing teams, so write staffing to work both ways: with your own manager tools, or by asking your manager for the perspectives. Announce a hire; it needs no approval.

The role owns the person: how they think and what they deliver. The skill owns the process. When a process needs a perspective the catalog lacks, or a skill carries text about how one person thinks, add or change a role in `roles/`, following the shape of the existing role files.

Write the process in prose. Add a `pi_exec` program only when it does what prose cannot do reliably, such as typed fan-in or exact coverage accounting.

## Skills

- Frontmatter has `name` (lowercase letters, numbers, hyphens; matches the directory) and `description`.
- A user-invoked skill starts a process and sets `disable-model-invocation: true`. A model-invoked skill gives a discipline or vocabulary that any process can use.
- A user-invoked skill names another user-invoked skill as the next step (`/skill:<name>`) rather than running it. To use a model-invoked skill, link its `SKILL.md` with a relative path and tell the reader to read and follow it.
- Add a supporting file only when the skill links to it and it holds a part that only some cases need. A skill with several workflows is a short router to one file per workflow.

## Verify

- Every change: `npm run test:loader` finds the skill under its name, and `npm run pack:check` lists its files.
- A changed process: one tight, contrived live run on the smallest real target in this repository that exercises it. Fix what you observe and run again; report judgment calls instead of iterating on them.
