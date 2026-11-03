## file

Receipt handles are store-local capabilities for frozen historical payloads, not paths or search queries. Expansion requires a handle already presented to the pair and source entries still active on the current lineage; teardown revokes the store. Issuance is bound to primary entries the host projected into that trajectory view.
Why: folded content must not grant navigation authority, expose an unseen entry, or change when its caller later mutates the original object.
Coupled: components/pair-programmer/src/extension.ts, components/pair-programmer/src/formatting.ts
Verify: components/pair-programmer/tests/receipt-expansion.test.ts

## symbol:PairReceiptStore

Reserve source-label and continuation bytes in each page. Three suffix lines account for a fragment's trailing newline plus the continuation separator; the returned continuation is itself a presented capability. Split text on safe UTF-8 boundaries and keep exact slices; images accompany only the first page.
Why: Pi's output limits must leave the continuation usable, and concatenating page bodies must reconstruct the original text without dropped bytes or duplicated images.
Verify: components/pair-programmer/tests/receipt-expansion.test.ts
