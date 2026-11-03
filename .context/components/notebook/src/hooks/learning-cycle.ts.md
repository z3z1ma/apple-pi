## file

Automatic reflection waits for a user-chosen number of new tokens, then runs in a headless fork after a completed run. Its evidence is the failed or surprising tool calls of that stretch, in first-seen order. A failure the agent predicted teaches nothing. A success the bash tool marks as a surprise does. Tool calls inside a forked continuation are not the agent's own. The caller empties that evidence when it reflects.

Distillation runs right after each compaction, while the context has room. Reflection and distillation forks run one at a time, so a distill sees what a reflection captured. `/reflect` and `/distill` ask the main agent in-band at any time.
Why: the distill instruction lists every open learning because the caller may not have seen all of them.
