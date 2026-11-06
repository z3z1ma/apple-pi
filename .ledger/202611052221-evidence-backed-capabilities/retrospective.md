# Retrospective: turn recurring lessons into tested rules and programs

## What mattered

- **The window rule is the hard part of evidence, and it had to be per behaviour.** The operator's correction (count usage only from the last change to the harness surface) was first written as "the component, plus `components/system-prompt` for agent behaviour". My own toolbox edit minutes before the steward's first run reset that window to zero for every behaviour, and the steward correctly refused to reach back. The working rule is the code and prompt lines that produce or prevent the behaviour, found with `git log -L`.
- **The steward behaved as designed when the evidence was thin.** It stopped and asked instead of widening the window, refused to read another person's transcript without authorization, and kept the candidate on a branch until sign-off.
- **Review found real defects in every round, mostly at boundaries the first draft treated loosely:** symlinks and path aliases, forked transcripts, cancellation in every waiting phase, process ownership across a parent's exit, and counting a program as used from source text instead of execution records. Two rounds on the harness code (20 and 16 confirmed findings), all addressed; the operator then stopped further rounds.
- **Formal models earned their place twice:** the review-wait model showed both the silence watchdog and SIGKILL escalation were necessary; the program-comparison model, kept in step with the code, was wrong once (it claimed an abort during the last check ended the comparison while the code did not), and review caught the drift.

## Lessons worth retrieving

- A capability that writes into a disposable copy must check every path component with `lstat` before writing; a realpath check after `mkdir` already wrote outside.
- A Pi fork copies its parent's entries with their original timestamps under a newer header; entries older than the header belong to the parent.
- Killing a process does not kill the detached processes it started; record descendants while the parent lives.
- Usage evidence and model behaviour lag harness changes; a short honest window beats a long misleading one.

## Not established

- That the steward's proposals will be worth their cost over time; one run produced one candidate.
- Paired program comparison has run only against fixture peers, not a real model.
