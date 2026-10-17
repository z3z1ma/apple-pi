---
name: human-review-markdown
description: "Open a document in the browser for annotation and sign-off. Use when the user wants to review a spec, plan, proposal, or README, and when a document you prepared is ready for their feedback before work continues."
---

# Present a Document for Review

Use `review_markdown` when the next useful step is the user's judgment on a Markdown document. Open the rendered document at that handoff so they can select and annotate the exact passages.

- Finish the draft enough to make the requested judgment possible. Use `note` for the decision or feedback you need, when it helps.
- Pass the file's `path`, either absolute or relative to `cwd`. Set `cwd` to select a different project; it defaults to the session directory. Call the tool from the root session.
- For approval of a whole ledger undertaking, use `review_ledger_task` so the user sees the bundle and dependencies together.
- Wait for the verdict. Apply the annotations and suggested rewrites yourself, and resolve material questions before continuing work that depends on approval.

Success means the user reviews the actual document and their feedback reaches the file. The page returns annotations; it leaves the source unchanged.
