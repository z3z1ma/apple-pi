---
name: human-review-markdown
description: "Open a document in the browser for annotation and sign-off. Use when the user wants to review a spec, plan, proposal, or README, and when a document you prepared is ready for their feedback before work continues."
---

# Present a Document for Review

`review_markdown` renders a document so the user can annotate the exact passages. The page shows the document; you set up the review. A review the user does not know how to approach yields vague feedback; a review framed around one judgment yields a decision.

**Goal:** the user knows what judgment you need, can give it from the document alone, and their feedback reaches the file.

## Frame the review

- **Know the judgment you need** before you open the page. Sign-off means the document is complete enough to sign. A decision means the document states the options and their consequences. Feedback on a draft means you say which parts are settled and which are open.
- **Open at the right scope.** One document, one judgment. If the real question spans a ledger undertaking, use `review_ledger_task` so the user sees the bundle and its dependencies together.
- **Orient in the conversation first.** One or two sentences: what the document is, what changed since they last saw it, and what you need from them. Then open the page.
- **Use `note` for the ask**, in one sentence, when it sharpens what to read for: "Decide between the two storage options in section 3." A note that repeats the title is noise.
- **Honest confidence.** Say what is settled, what is proposed, and what is a guess, so the user spends attention where it matters.

## After the verdict

Apply the annotations and rewrites yourself; they are feedback, not edits already made. Resolve a material question before work that depends on approval continues. Report what you changed and anything you left as it was, with the reason.
