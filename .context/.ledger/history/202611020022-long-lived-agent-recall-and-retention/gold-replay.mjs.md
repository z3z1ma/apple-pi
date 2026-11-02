## file

Freeze each question's cutoff, ancestry and relevance labels before comparing variants; preserve unknown labels as unjudged rather than false.
Why: new search hits outside the labeled source episode can be relevant. Counting them as irrelevant without reading them biases prototype precision. The reported no-gain result includes Ciaran's separate manual judgments of two novel hits, not just the automated known-label counts.

Keep full entries, question text, source locators and manual gold outside Git; public output uses opaque question IDs and counts. Episode-relative recall remains distinct from complete-transcript recall and visible-snippet sufficiency.
Why: the gold is private, purposive and bounded. Structural retrieval output cannot establish either all-history accuracy or what evidence the agent actually saw and used.
Coupled: .ledger/history/202611020022-long-lived-agent-recall-and-retention/replay.mjs, .ledger/history/202611020022-long-lived-agent-recall-and-retention/independent-evaluation.md, .ledger/history/202611020022-long-lived-agent-recall-and-retention/evidence.md
