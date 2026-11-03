## file

Sources without a historical message ordinal retain their entry:<id> address rather than borrowing a numeric position. Legacy segment grouping is presentation, not proof that ranked neighbors share chronology or ancestry; follow each source address for evidence.

A foreign transcript's #N is local to that transcript. Its source and file-recovery hints use entry:<session>/<id>, with person/session/task attribution, so they cannot accidentally expand #N in the caller's own file.

Why: relevance sorting and newly searchable source kinds otherwise make unrelated records look like one episode or a valid old #N citation.

Coupled: components/session-search/src/search-entries.ts, components/session-search/src/load-messages.ts
Verify: components/session-search/tests/format-recall.test.ts, components/session-search/tests/source-recall.test.ts, components/session-search/tests/indexed-recall.test.ts
