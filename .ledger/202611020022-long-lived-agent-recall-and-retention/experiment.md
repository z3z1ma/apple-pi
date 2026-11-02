# Isolated recall experiment

Status: held-out artifact and one-line candidate frozen; private comparisons not yet run.

## Decision and authority

Tadhg's decisions 7652/7659 permit an isolated ranking/answer-context experiment after correction review settles. Review `review-60642218-ae89-4998-8b20-d76bcc523d4f` completed 3/3 passes and 7/7 questions with no findings/gaps on corrected source `0843bfd3`. Main remains the retained implementation. No storage, schema, daemon, archive or backup work is authorized.

Kofi owns the comparison and recommendation. Ciaran owns independent question/evidence judgments. Tadhg/operator retains the landing decision. A positive experiment is eligibility for that decision, not automatic approval.

## Competing explanations

1. Entry-level lexical scores favor topical restatements over the historical evidence a question needs; local answer-bearing passages may discriminate better.
2. The relevant historical source lacks enough lexical overlap; reranking cannot recover it without changing the retrieval/query contract.
3. The ranked evidence is adequate but its displayed window hides the answer; a presentation change can improve sufficiency without changing source recovery.

The experiment must distinguish changed source selection from changed displayed sufficiency. A precision increase without better historical evidence and sufficient answers is not success.

## Frozen controls

- Baseline is corrected production source `0843bfd3`, available at main revision `032ab1f8` before experimental work. It is stricter than the original research baseline: frozen-six relevant@5 10/30, evidence hit5/6, episode recall7/19 and sufficient display2/6.
- Keep the original six questions, historical cutoffs, calls and labels unchanged. The withdrawn unchanged-input and explicit-regex experiments remain negative evidence.
- Before candidate results, independently author six fresh actual-history questions with historical cutoffs, original calls, answer criteria and source-episode labels. Inventory metadata is permissible; previously inspected question examples are diagnostics rather than held-out cases. Prefer previously unread histories and document any overlap or inability to obtain the requested set.
- Freeze the private held-out artifact/hash and public aggregate sampling description before running the candidate. Authoring and relevance criteria precede baseline/candidate output inspection for those questions. Judge any novel returned source by reading the full original record under the frozen criteria.
- Keep private text, queries, excerpts, entry IDs and mappings outside Git/mail. Mail contains opaque question IDs, aggregate counts and local artifact paths only. Original JSONL is read-only; use direct parsing and temporary prefix snapshots, never SessionManager.open on originals.

## Comparison and stopping rule

Use one frozen candidate derived from general code/public fixtures, followed by one held-out comparison. Preserve legacy query semantics and the public entry-level top-five page/recovery contract. Use identical historical prefixes, calls and source classes. Report payload size and work differences; extra searches or silent expansion are a different experiment.

Measure separately on frozen-six and held-out sets: relevant@5, evidence-hit questions, bounded-episode relevant-source recall, and displayed-answer sufficiency. Presence and sufficiency are different outcomes. Carry labels only under checked identity/display equivalence, explicitly as reused judgments.

Landing eligibility requires strictly better episode recall AND displayed sufficiency on EACH set, with no aggregate precision or evidence-hit loss on either set. Disclose per-question regressions even when aggregates pass. Passing focused regressions and preserving scoped exact recovery are additional gates, not recall-quality measures.

Failure, unjudged novel hits, incomplete evidence or a confounded comparison means no landing. Preserve the result and mail Tadhg either way. After held-out results, revisions are exploratory; another confirmation needs fresh held-out questions. Avoid tuning to the original six or repeatedly selecting against the same held-out answers.

## Execution boundaries

All experimental code lives on a separate branch/worktree rooted at the reviewed source. Main receives only sanitized task evidence unless separately authorized after successful gates. Keep runtime/schema and unrelated lanes intact. Focused tests use one worker. Remove temporary prefix files and inspect worktree state before cleanup.

## Current state

The baseline and correction-review gate are settled. Held-out artifact frozen at 2026-11-02 10:26 UTC, SHA256 `005b8fd5a899ff05eeec5a07f3e048329e886fd93d530f183cc1b221e9a3d557` (exact JSON UTF-8, no trailing newline). Private artifact lives outside Git with mode0600. Kofi independently verified every original-call argument set, six normalized prefix hashes, 37 record hashes and relevant-ID/label consistency. A pre-results consistency correction is retained in its provenance; the latest proposal supersedes the first.

Six previously unread, non-overlapping histories supply 37 labeled source records: 20 relevant, 17 negative; six records are non-message sources. Exclusion covers 31 prior physical files plus issuing-call and copied-entry identities. All six cutoffs follow compaction; four episodes cross a subsequent cut, two are within already-compacted sessions. Sampling is chronological/purposive, with one child history and shared project context. Labels are single-rater bounded-episode judgments, not complete-transcript gold. One very large positive source was inspected via parsed source bodies and relevant complete functions rather than every unrelated inventory item. Historical search-result bodies and held-out baseline/candidate outputs were unseen during authoring.

### Before-results method amendment

The initial passage-local prototype is preserved on the isolated branch as `ca3f1388`. It failed a public coherent-passage page-selection control (101 other focused tests passed); typecheck and scoped formatting passed. Inspection exposed a pre-existing scorer-state problem: RegExp.matchAll starts from the cached global pattern's lastIndex left by preceding test calls. Single occurrences could count as zero, favoring repeated terms and invalidating the intended frequency calculation. This finding came from public fixtures/code, before any private candidate or held-out baseline result.

The passage algorithm and its proposed contract test were withdrawn before private evaluation. The single frozen private-evaluation candidate is `98ec44fa`: production code equals reviewed `0843bfd3` except resetting pattern.lastIndex before termFreq counts matches. A new public first-page test of concise single-occurrence evidence failed on the unchanged scorer, then passed with the reset; 102 focused tests in 15 files and Node/web typecheck pass. No new weights, query syntax, windows or source types are introduced; regex discovery, echo priority, page/recovery interfaces remain unchanged.

Prediction: correct independent frequency counting may recover one-off evidence previously lost behind repetition. Rival result: lexical ambiguity or display limitations dominate and the candidate fails the quality gates. This comparison cannot attribute an effect to passage-local ranking: none remains in the candidate. No private comparison has run yet; freeze this candidate before evaluating both sets, and retain the same success/stop rule.
