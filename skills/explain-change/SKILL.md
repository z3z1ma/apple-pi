---
name: explain-change
description: "Explain a code change through a browser walkthrough with real code and a quiz. Use when the user asks to understand a commit, branch, pull request, or implementation, and after a substantial change they need to understand well enough to build on."
---

# Explain a Change

`explain_change` turns your understanding into a page the user can learn from. The tool supplies the real code and the quiz machinery; the explanation is only as good as the model you built first. A page that restates the diff in prose is harder to read than the diff.

**Goal:** the user can reason about the change and continue from it without you. The tool's guidance owns the mechanics (sections, `code` fences, quiz shape, `cwd`, `base`, `head`); this skill owns the quality of what goes in them.

## Build the model

Read until you can answer, from memory:

- **Mechanism**: how it works now. Trace the data path from where the change starts to where its effect is observed.
- **Motive**: why it exists. The task, the discussion, the bug, the constraint it serves.
- **Invariant**: what must stay true, and which line keeps it true.
- **Failure mode**: what breaks if the change is wrong, and how the reader would notice.
- **Trade-off**: what was given up, and which alternative was rejected and why.

Done means you can say what the change does, why, and what would break if it were wrong, in one plain sentence. Until you can, keep reading.

Then plan backward: choose the two or three ideas the reader must leave with. Write the quiz against those ideas first; a question a skimmer passes tests nothing. Then write the explanation that teaches them.

## Draft, then test it on a cold reader

`explain_change` opens the page for the operator at once, so test the draft first. Write the page's fields (title, summary, background, primer, intuition, steps with their `code` fences, and the quiz) into a Markdown draft in the task's directory, and keep the answer key out of every file the reader can reach. Give a `new-team-member` from the organization (call in one who has read for you before; hire one when none exists) only the draft's path and the repository, never the conversation, the task, or the ideas you chose, and ask for its report.

Revise and send the new draft back until the reader's one-sentence summary carries the ideas you chose, it answers the quiz without guessing, and it names no place it got lost or wanted a picture. Then call `explain_change` with the final draft.

## Picture first

The operator learns by seeing. Show the idea as a `mermaid` diagram or a `figure` before any code: the flow, the sequence, or the state before and after. Give every step that moves data or changes state its own picture. A picture with toy data beats a paragraph of rules, and a table of measured inputs and results beats both when the change is about cases.

## Write to teach

Explain the way Feynman and Kleppmann do.

- **Concrete before abstract.** Intuition is one worked example with toy data, told before any code. State the general rule only after the example has made it obvious.
- **Disclose progressively.** Each section answers the next question the reader has, and no sooner. Basics a newcomer lacks go in the primer, not in the way of everyone else.
- **Follow the data, not the file list.** Each walkthrough step is one idea with the few lines that carry it. Cite the lines the reader must see; summarize the rest.
- **Name the guarantee and where it stops.** "Writes are ordered per key, not across keys." A guarantee with its boundary is worth ten adjectives.
- **One true sentence per concept.** The sentence the reader will repeat to a colleague. The summary is that sentence, expanded to a paragraph.
- **Plain technical English.** Short sentences. One idea each. Active voice. One word per meaning; define a term the first time only.
- **Orient first.** Background says what was there before, in terms the reader already has; deep context for a newcomer goes in the primer.
- **Honest confidence.** Say what was verified and what was not. Mark a guess as a guess.

Open the page as part of the answer and give a short summary in the conversation. Use the operator's quiz misses and questions, when they arrive, to close the gap before work builds on the change.
