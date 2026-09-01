---
name: prototype
description: Build a throwaway prototype to answer a design question. Use when the user wants to sanity-check whether a state model or logic feels right, or explore what a UI should look like.
---

# Prototype

A prototype is **throwaway code that answers a question**. The question decides the shape.

## Pick a branch

Identify which question is being answered, using the user's prompt, the surrounding code, or by asking if the user is around:

- **"Does this logic / state model feel right?"** → [LOGIC.md](references/logic.md). Build a single shareable HTML file (free-play buttons plus tabbed guided walkthroughs) that pushes the state machine through cases that are hard to reason about on paper, and that a non-developer can drive.
- **"What should this look like?"** → [UI.md](references/ui.md). Generate several radically different UI variations on a single route, switchable via a URL search param and a floating bottom bar.

The two branches produce very different artifacts, so getting this wrong wastes the whole prototype. If the question is genuinely ambiguous and the user isn't reachable, default to whichever branch better matches the surrounding code (a backend module → logic; a page or component → UI) and state the assumption at the top of the prototype.

## Rules that apply to both

1. **Throwaway from day one, and clearly marked as such.** Keep the canonical prototype artifact inside the governing active `.ledger/<task>/` bundle and name it so a casual reader can see it's a prototype, not production. Organize it so the target module or page is obvious. For a UI prototype that must render inside the real app, use the existing host page and routing convention as the evaluation surface; only minimal, clearly marked temporary wiring or working copies may live in the production tree. Preserve the evaluated prototype in the ledger and remove that temporary code after the verdict.
2. **Trivial to run.** A UI prototype starts from one command in the project's task runner: `pnpm <name>`, `python <path>`, `bun <path>`, etc. A logic demo is a single HTML file the user double-clicks. Either way, no thinking required to start it.
3. **No persistence by default.** State lives in memory. Persistence is the thing the prototype is _checking_, not something it should depend on. If the question explicitly involves a database, hit a scratch DB or a local file with a clear "PROTOTYPE, wipe me" name.
4. **Skip the polish.** No tests, no error handling beyond what makes the prototype _runnable_, no abstractions. The point is to learn something fast.
5. **Surface the state.** After every action (logic) or on every variant switch (UI), print or render the full relevant state so the user can see what changed.
6. **Capture it when done.** Keep the question, verdict, run instructions, and runnable prototype together in the active ledger task as the **primary source**. Fold any validated decision into the real code only when production adoption is authorized, then remove temporary UI wiring and working copies from the production tree so main keeps only the validated decision. If the operator also wants upstream-style branch capture, commit the ledger artifact to a throwaway `prototype/<name>` branch only when repository storage policy permits and commit approval is explicit; record that pointer in the ledger and in an external implementation issue only when its update is authorized.
