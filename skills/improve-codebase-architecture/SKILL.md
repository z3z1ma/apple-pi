---
name: improve-codebase-architecture
description: "Survey a codebase for deepening opportunities with an architecture board, present them as a report for the operator, and hand the chosen candidate to a design interview."
disable-model-invocation: true
---

# Improve Codebase Architecture

Find **deepening opportunities**: refactors that turn shallow modules into deep ones, for testability and AI-navigability. This is a survey: it changes no production code, and zero candidates is a valid result.

Read and follow [`codebase-design`](../codebase-design/SKILL.md) for the vocabulary (**module**, **interface**, **implementation**, **depth**, **seam**, **adapter**, **leverage**, **locality**) and its principles. Use those terms exactly. Read the relevant domain-language pages in `.wiki/` and the ADRs that govern the area; reopen an ADR only when the observed friction justifies it, and say so.

## Scope

Take the operator's direction when given: a module, a pain point, an incoming specification. Otherwise walk back a good stretch of `git log` and let the hot spots (the files that keep changing) pull attention first; deepening pays off where change keeps coming. Record `git status` before you start and leave every pre-existing change as it is.

## The survey board

You chair. Staff with standing people as [`handbook-writing`](../handbook-writing/SKILL.md) describes, the whole board before briefing anyone:

- A `repository-archaeologist` scouts the scope: where understanding one concept means bouncing between small modules, where an interface is nearly as complex as its implementation, where extracted pure functions moved the bugs into their callers, where modules leak across seams, and what is hard to test through its current interface. It reports candidate locations with evidence. The same person returns for later surveys of this codebase and keeps learning it.
- A `chief-architect` challenges each candidate with the **two-stage deletion test**: deleting the existing module makes little complexity reappear (it is shallow), and deleting the proposed deep module would make its hidden behavior reappear across callers. A candidate that fails either stage is out.

Check every surviving candidate against current source yourself.

## Report

Write the report as Markdown in the task's directory, and open it with `sign_off_document`, following [`operator-sign-off`](../operator-sign-off/SKILL.md). Lead with the top recommendation, or with the plain statement that no candidate qualified. Then one section per candidate:

- **Files** involved, **problem** (the friction), **solution** in plain words, and **benefits** (locality, leverage, how tests improve);
- a **before / after** `mermaid` diagram showing the shallowness and the deepening;
- the **dependency category** from [deepening.md](../codebase-design/references/deepening.md) and the **strength**: `Strong`, `Worth exploring`, or `Speculative`.

Describe the change, not a detailed interface; the interface is designed after the operator chooses. Mark a candidate that conflicts with an ADR. Ask the operator to choose one candidate on the page.

## Hand-off

When the operator chooses a candidate, name the next step: `/skill:interrogate-to-design` with that candidate, which designs the deepened module through an interview and Design It Twice where alternatives matter. Report the report's path, the choice, and that no production code changed.
