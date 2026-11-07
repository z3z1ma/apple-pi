Status: done
Created: 2026-10-30
Updated: 2026-11-07

# Retrospective

## What Mattered

- The irreversible effect (letting people go and deleting transcripts) set the bar. Two review rounds found 14 real defects, almost all where the system inferred intent or idleness from evidence that did not prove it: a signal reported as a quit, an idle snapshot taken before accepted input, a stale connection, a consent that outlived a merge, a clock. The fixes share one rule: an irreversible step needs positive, current proof, and anything unproven keeps.
- Niamh modelled each mechanism in TLA+ with a control that must fail before coding it. The first model passed while the code lost input, because it abstracted in-flight input away; the review caught that, and the second model added it.
- The operator's decisions changed twice after review evidence (typed quit only; Send home warns). Bringing him the reproduced failure with concrete options got quick, durable answers.

## Learnings

- Name organization lifecycle features in the organization's own vocabulary (people, hire, let go, incorporate). The operator rejected the generic `/keep` and chose "incorporate" from options framed that way; one name then served the flag, the command and the menu item.
- Before offering a choice whose result is irreversible, read the existing UI text, tool description and docs of every action bundled into it, and say in the option where they conflict. "Send home" was listed among the endings that dissolve an organization; the operator accepted, and the build deleted organizations from a control that promised reversible sleep (review `review-5b5a62a2` OP-1). He then chose "warn and ask".
- Pi's interactive host reports SIGHUP (window closed), SIGTERM and kills as `session_shutdown` reason `quit`, exactly like a typed quit. Never treat that reason, or `ctx.hasUI`, as proof of intent for an irreversible effect; an ending whose provenance cannot be established counts as not deliberate. See `.context/components/session-state/src/shutdown-signals.ts.md`.

## Improvements

- When a design question bundles existing actions into a new irreversible effect, list each action's current promise in the option text (now a learning above and in Tadhg's commitments).
- Run the review on the integrated change as soon as both lanes land; two rounds here cost about three hours but found defects no focused test covered.
- World's early-click race is reported in the Outcome; it predates this task and needs its own fix.
