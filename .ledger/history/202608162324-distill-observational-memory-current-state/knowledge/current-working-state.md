Status: active
Created: 2026-08-16
Updated: 2026-08-16

# Current working state vocabulary

Use these words in this task's spec, decisions, and plan. They name the product, not a meeting label.

## Law

Durable facts a future assistant must treat as true unless newer evidence contradicts them: user identity, preferences, corrections, terminology, architectural decisions, invariants, completed outcomes that must not be redone, and long-lived blockers.

Today this role is assigned to reflections. Current law is the non-retired reflection set.

## Working evidence

Timestamped facts still needed as detail that current law has not safely absorbed: recent working context, unique identifiers or errors not yet in law, unresolved partial state, and observations that failed the durability bar.

Today this role is assigned to active observations.

## Archive

Ledger history, including dropped observations and retired reflections. Archive is not injected. `recall` is the read path.

## Distillation

Closing the existing observe / reflect / drop / recall algebra so injection shows current law plus working evidence. Distillation is not a fourth agent and not an injection-time rewrite of the ledger.

## Pivot residue

The compressed fact that a path was tried and abandoned, and why, when that still constrains later work. Pivot residue belongs in current law. The attempt changelog belongs in the archive.

## Replay

The current injection contract: concatenate all reflections and active observations, then tell the reader that the most recent observation wins. A later assistant must mentally reconstruct what is live.
