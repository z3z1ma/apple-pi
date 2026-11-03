## file

A ticket reference starts the line or a list item (`01: Title`, `#01`, `ticket 03`). A phrase such as "Retry 408" is not a reference. Single digits are prose, such as "Phase 2". A number that is a ticket in the bundle counts wherever it appears; another number counts only where it reads as a reference.
Why: treating every digit run as a ticket would mark ordinary prose as a missing blocker.
Verify: components/browser-pages/tests/ledger-review.test.ts
