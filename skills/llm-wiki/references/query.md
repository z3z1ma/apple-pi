# Query the Wiki

Query is read-only before any filing phase.

## Procedure

1. Orient from `README.md` and `INDEX.md`.
2. Search for the subject and use `wiki_references` to retrieve inbound, outbound, or nearby graph context when it can affect the answer.
3. Read the smallest relevant set of pages and underlying sources.
4. Distinguish supported wiki knowledge, source statements, synthesis, contradiction, and unresolved uncertainty.
5. Cite the wiki pages and useful underlying sources supporting the answer.
6. Do not initialize, repair, lint-fix, log, cache, create reports, or otherwise write during the answer phase.
7. Offer to file a durable synthesis, comparison, correction, or new relationship when it would improve future knowledge.

An explicit initial request to **query and file** authorizes a bounded filing phase after the answer. Otherwise wait for authorization. Ask again only if the mutation would materially exceed the authorized scope. A completed filing follows the ingest mutation order: pages, navigation when changed, `wiki_lint`, then `LOG.md`.

If `.wiki/` is absent, say so and offer initialization rather than manufacturing a wiki-backed answer. Missing `README.md` or `INDEX.md` limits coverage; targeted read-only search may continue when useful. Missing `LOG.md` does not block an answer.
