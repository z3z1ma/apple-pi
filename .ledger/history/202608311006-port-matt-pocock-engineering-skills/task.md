Status: done
Created: 2026-08-31
Updated: 2026-09-01

# Replace workflow skills with Matt Pocock-derived engineering workflows

## Intent

Replace Apple Pi's Superpowers-derived workflow layer with an adapted Matt Pocock engineering-skill set. Preserve Apple Pi's fundamental review, verification, isolation, closure, Ralph, Pi Exec, skill-authoring, and wiki procedures. Task artifacts remain free-form files inside ledger task bundles; reusable interview and domain context live as Markdown under `.wiki/`.

## Current State

The approved 18-skill catalog is physically present and listed in README, provenance, boundaries, package-load, and Pi Exec discovery tests.

Human-only workflows: `interrogate-to-design`, `to-spec`, `to-tickets`, `implement`, `improve-codebase-architecture`, `wayfinder`, plus the `/interrogate` prompt.

Model-invoked disciplines: `prototype`, `diagnosing-bugs`, `research`, `tdd`, `resolving-merge-conflicts`, `domain-modeling`, `codebase-design`.

Fundamentals retained: `code-review`, `ralph`, `pi-exec`, `skill-authoring`, `llm-wiki`.

Rejected surfaces remain omitted: `ask-matt`, `setup-matt-pocock-skills`, tracker-oriented `triage`, `wizard`, a separate grilling skill, a Skill-tool bridge, and a `review` compatibility alias.

Latest skill commits: `0e9cfc5 feat: add architecture improvement skill`, `fed7139 feat: add wayfinder skill`. Studies live under `studies/`. Product catalog reconciliation found no remaining public-inventory mismatch.

## Porting Rule

Treat every skill reader as a fresh model working in an unknown repository. Start from Matt Pocock's pinned source verbatim. Change only ledger, wiki, team, Pi Exec, authority, or an approved package-layout convention. Preserve upstream doctrine unless the operator approves another deviation.

## Outcome

Catalog mapping and operator-approved skill designs are implemented. Ledger closure is pending operator confirmation. Push remains unrequested.
