## file

File transactions and history recording live in `components/shared/src/ledger-files.ts`, shared with explicit-task promotion. This extension owns Pi registration and observing changes to bundles.
Why: a promotion must use the same ledger index and lease as `ledger_add`; the runtime stays a plain Node process and imports no Pi extension code.
Coupled: components/shared/src/ledger-files.ts
Verify: tests/ledger-history.test.ts
