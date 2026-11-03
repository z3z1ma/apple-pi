## symbol:answersFromReplies

Returns answers in the dialog's shape, or a string explaining why the outside replies do not fit the questions.

## file

An answer arriving from outside the terminal closes the open dialog and replaces its result. An abort may already have closed that dialog before the outside result arrives; a late answer is then rejected.
Why: the terminal dialog and an external host can finish the same questionnaire. The first completion wins, and a late reply must not reopen it.

Verify: components/ask-user-question/tests/ask-user-question.test.ts
