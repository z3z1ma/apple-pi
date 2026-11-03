## file

Pi writes transcript records with their payload first and their own id last; the payload can hold ids of its own. The fixture puts many old entries, about 6 MB, before the ones a test asks for.
Why: a reader that stops at the first id would return the payload's id instead of the record.
Verify: components/session-state/tests/transcript-read.test.ts
