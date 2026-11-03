## file

`ask_user_question` offers each shown questionnaire on a `pi.events` channel so an outside answerer, such as the session-state bridge, can answer it.
Why: the first answer wins. A late answer is refused once the questionnaire is closed or the replies do not fit.
