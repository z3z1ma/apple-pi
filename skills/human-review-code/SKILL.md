---
name: human-review-code
description: "Present a code change in the browser for the user's judgment. Use when the user wants to inspect a diff, approve your implementation, or decide code-level trade-offs, and at a completed implementation handoff that needs their review."
---

# Present a Code Review

`review_code` puts the real diff in front of the user with your reasoning beside it. The diff is free; the reasoning is the value. A review with hollow chapter briefs is a diff with extra clicks.

**Goal:** the user can judge the change well in the time they have, and their verdict guides the next action. For an audit you perform yourself, use the `code-review` skill; this page is for the human decision that follows.

## Build the model

Before you write, hold the change as a reviewer needs it:

- **Mechanism**: how it works. Trace the path from where the change starts to where its effect is observed.
- **Motive**: why it exists, in terms of the problem it solves.
- **Invariant**: what must stay true, and which line keeps it true.
- **Failure mode**: what breaks if the change is wrong, and how a reviewer would notice. This one decides where attention goes.
- **Trade-off**: what was given up, and which alternative was rejected and why.

Done means you can say what the change does, why, and what would break if it were wrong, in one plain sentence.

## Tell it so a reviewer can judge

- **Intent** is that sentence, expanded to a few a reviewer could repeat.
- **Chapters** follow your reasoning: the core idea, what it forced, then the support. Each brief gives a way to think about the hunks that follow: what to expect, what to check, what would be wrong. Concrete before abstract: a toy case makes a brief land where a description does not.
- **Focus** is the two-minute path: the few places that decide whether the change is right.
- **Notes** carry what the code cannot say: a reason, a hazard, a subtlety. A note that restates the line is noise.
- **Decisions** are real forks where the reviewer may choose differently. State each option's consequence plainly.
- **Verification** says what was proven and what was not. Unverified is a legitimate status; hiding it is not.
- **Plain technical English.** Short sentences. One idea each. Active voice. One word per meaning.

Wait for the verdict. Address the comments and decision answers, and report anything requested that remains unresolved.
