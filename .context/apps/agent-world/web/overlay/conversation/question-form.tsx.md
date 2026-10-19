## symbol:QuestionForm

Words of one's own replace the question's choices (choosing them clears the chosen options, and choosing an option clears them), and a reply is either `{selected}` in the options' listed order or `{custom}` with trimmed words, never both.
Why: the terminal's dialog and `ask_user_question`'s `answer` take one or the other per question, and the backend test compares the tool's result from the form with the terminal's for the same choices.
Coupled: components/ask-user-question/src/index.ts
Verify: apps/agent-world/tests/world-conversation.test.ts, apps/agent-world/tests/instruct.test.ts
