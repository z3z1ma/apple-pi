# Explain change, round 2

Round 1 ([README](../explain-change/README.md)) plus the operator's answers (2026-10-16): a Socratic chat sidebar, five good quiz questions, and explanations of any commit or range in history. Open `index.html` in a browser (it loads `marked` and `mermaid` from jsDelivr). The tutor's replies are scripted here; everything else is as round 1.

## Talk it through

- **A sidebar that slides out** from the right edge, so the article reflows beside it and stays readable. It opens from the top bar, the floating launcher, or `/`; `Esc` closes it. A pop-out button moves it to its own window (simulated here).
- **Socratic by default.** The tutor answers with one question at a time that leads the reader to the answer, builds on what the reader says, offers a hint before the answer, and ends by pointing to the step or question that holds it. Quick replies (*Give me a hint*, *Just tell me*, a likely answer) keep the dialogue moving; free text works too. **Direct** mode answers the reader's own questions plainly; checks still ask first.
- **Ways in, each with its context:**
  - select text in the explanation: *Ask about this* or *Quiz me on this* (the quote goes into the thread);
  - *Check my understanding* at the end of every step: the tutor asks one question about that step;
  - *Talk it through* on a missed quiz question: the tutor starts from the wrong answer and works back to the misconception, then offers *Retry question N*;
  - starter suggestions when the thread is empty.
- **Citations** in replies scroll the explanation to the step or question they name.

## How the build works

- The tool still returns at once with the saved page's path; nothing comes back to the agent. The page server stays up after the tool returns, until the page closes or the session ends, so the sidebar can talk to the agent. Without a live session the sidebar says so and the rest of the page works.
- Each tutor turn is a read-only fork of the live conversation, as *Ask the agent* on the review pages is: it shares the request prefix, can read the repository, and sees the explanation, the reader's quiz answers, and the thread so far. A Socratic frame tells it to ask one question at a time, use hints before answers, and cite steps.
- The saved page keeps the thread, so a later read shows the questions and answers.

## Contract changes

```json
{ "title": "…", "base": "72c7ad3^", "head": "72c7ad3", "summary": "…", "steps": [], "quiz": [] }
```

- **`head`** (optional) explains any commit or range in history: code comes from `head`, with diff marks against `base`. Without `head`, the working tree is compared with `base`, as `review_code` does.
- **Quiz:** exactly five questions, three or four options each, one right answer, and a `why` for every question; the server rejects anything else. The tool's guidelines teach good questions:
  - test the substance: a reader who skimmed fails, a reader who understood passes;
  - one idea per question, preferably a concrete case with toy data ("ticket 03 waits on 07, which is missing …");
  - wrong options are plausible misconceptions of similar length, never jokes, trivia, or "all of the above";
  - `why` explains the right answer and names the step that teaches it.

## Questions for the verdict

1. **Pop out.** This reads "pop out" as a sidebar that slides out from the edge, plus a button that detaches it into its own window. Is that what you meant, and is the detached window worth building?
2. **Back to the agent.** The [settled decision](../../task.md#settled-decisions) is that nothing returns. The thread and quiz misses show what the reader found hard. Keep returning nothing, or write a short note (misses and topics asked) into the session when the page closes?

Next: the operator's verdict on round 2 and these answers, then the build of `explain_change` ([task.md](../../task.md), Next).

## Verdict (operator, 2026-10-16)

Approved. Pop-out means only that the sidebar slides out from the edge: no separate window. A short note may go back to the agent. The saved page will often be shared (attached to a pull request or a Confluence page), so every page must degrade gracefully: when it cannot reach a live page server with the agent behind it, it hides the features that need one and reads as a normal page. The operator's open concern is whether the Socratic tutor works as well as the interface looks; the build must check it with a real model.

