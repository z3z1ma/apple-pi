## symbol:layoutTickets

Each ticket sits in a column by dependency depth. A cycle cannot be layered; its back edge loops under the graph.
Why: a cyclic blocker has no finite depth. Drawing that edge backward is the visible signal, not a layout failure.
Verify: components/browser-pages/tests/ledger-review.test.ts
