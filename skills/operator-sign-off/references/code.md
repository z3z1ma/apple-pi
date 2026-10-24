# Code sign-off

**Goal:** the operator can judge whether the change is right and safe to build on. The diff is free; your reasoning is the value. A review with hollow chapter briefs is a diff with extra clicks. For an audit of the code itself, run the `code-review` process first; this page is for the decision that follows.

## Build the model first

Read until you can answer, from memory:

- **Mechanism**: the path from where the change starts to where its effect shows.
- **Motive**: the problem it solves.
- **Invariant**: what must stay true, and the line that keeps it true.
- **Failure mode**: what breaks if it is wrong, and how a reviewer would notice. This decides where attention goes.
- **Trade-off**: what was given up, and which alternative was rejected and why.

Done when you can say what it does, why, and what would break, in one plain sentence.

## Tell it as a story

- **Intent** is that sentence, expanded to a few a reviewer could repeat. It opens with the judgment you need.
- **Focus** is the two-minute path: the few places that decide whether the change is right.
- **Chapters** follow your reasoning: the core idea, what it forced, then the support. Weight attention by risk. Each brief says what to expect in the hunks, what to check, and what would be wrong, with a toy case or a picture where a description would not land.
- **Notes** carry what the code cannot say: a reason, a hazard, a subtlety. A note that restates the line is noise.
- **Decisions** are real forks, each option with its consequence.
- **Verification** says what ran and what did not.

For the cold read, write the intent, focus, chapter briefs, notes, decisions, and verification into a Markdown draft in the task's directory. The reader gets the draft and the repository.
