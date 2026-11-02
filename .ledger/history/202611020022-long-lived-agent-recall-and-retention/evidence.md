# Measured evidence and reproduction

Research date: 2026-11-02. Source baseline: `309099c9c20e9ae47e58778a3036bd542bbf0ae6`; installed Pi 1.4.0, Node 26.7.0. No production source was changed. Measurements are point-in-time reads of a live machine, not one atomic filesystem snapshot. Private original JSONL files were never opened through SessionManager or written by this inquiry.

## Inventory

First all-project scan completed 07:25:07 UTC, in 18.44 s:

| Measure | Value |
| --- | ---: |
| JSONL files | 2,045 |
| Bytes | 6,299,993,124 (6.30 GB decimal) |
| Parsed entries / messages | 566,283 / 483,951 |
| Compactions / files with compactions | 1,610 / 371 |
| Direct search calls / files using search | 627 / 115 |
| Direct notebook lookups | 24 |
| Direct mail searches | 0 |
| Parse-failed lines | 28 |
| Files with changed size/mtime during individual read | 0 |
| Largest file | 268,706,948 bytes; 58 compactions |
| Maximum observed first-to-last timestamp span | 13.00 days |

These are all session files, not all persistent people: interns, temporary peers, old versions and unrelated project histories coexist. Timestamp span is not continuous working time. The corpus supports roughly one-to-two-week histories, not months-long accuracy claims. Direct tool-call counts exclude nested execution traces and raw sidecar transcripts.

A second scan at 07:32:37 UTC added byte/type classification. Live appends explain its different total: 6,302,489,515 bytes, 566,515 entries. Same 2,045 files, 1,610 compactions and 627/24/0 direct recall call counts; no per-file size/mtime change during its own read.

| Record type | Count | Serialized bytes |
| --- | ---: | ---: |
| `message` | 484,166 | 5,204,969,714 |
| `custom` | 17,685 | 740,008,729 |
| `compaction` | 1,610 | 247,863,183 |
| `custom_message` | 31,591 | 98,810,133 |
| Other parsed records | 31,463 | 9,981,323 |

Type byte totals count parsed lines plus one newline per line; malformed lines and final-newline differences are outside that classification, so they need not sum to raw file sizes.

Notable custom messages: **17,183 mailbox messages**, 627 notebook packets, 1,299 change reflections, 535 learning reflections, 420 distillations and 645 self reflections. Present search omits this entire record class, even though many such entries are delivered to the agent. Repeated content elsewhere may still be found; omission does not mean every fact in these records is unrecoverable.

Runtime DB read-only snapshot at 07:32:56 UTC: 329,347,072-byte main DB plus 12,945,072-byte WAL; 176,407 preview-index rows, 833,959 events, 7,346 thread messages, 22,593 commands, 121 session rows. Preview payload total 10,281,666 bytes; thread bodies 6,516,879 bytes; command JSON 25,923,206 bytes. These payload sums are not per-table physical storage or all indexes. JSONL rotation does not prune this separate event/command/thread retention. No database mutation or cleanup ran.

## Current search replay

Selection: every inventoried file with direct search use, at least one compaction, and timestamp span greater than three days: **22 files**, 4.17-12.13-day spans, 674 compactions, about 1.60 GB. The three-day boundary defines this disclosed research sample, not a proposed product retention cap.

308 original direct calls: 273 topical queries, 25 entry expansions, five file addresses and five call addresses. Each topical query was evaluated using current production extraction/ranking functions over its historical prefix and requested lineage. The pre-query baseline excludes the entire issuing assistant entry to avoid target leakage. A separate deployed-path variant includes it, as the tool can at execution. Future entries are excluded in both. No SessionManager.open, network model replay or live tool mutation was used.

| Diagnostic on 273 topical queries | Count |
| --- | ---: |
| Interpreted as regex by current punctuation heuristic | 129 |
| Current regex rejection | 14 |
| Zero hits excluding issuer (not errors) | 49 |
| Result cap of 50 reached excluding issuer | 48 |
| Issuer appears in deployed-path top five | 101 |
| Issuer ranks first | 55 |

129 regex-like queries comprise 70 with alternation, 56 with a dot but no alternation, and three with other metacharacters. Presence of punctuation is not evidence that the agent intended regex.

**These are diagnostic rates, not precision/recall.** A self-hit can coexist with good evidence. A zero-hit question may have no answer in that history. Old queries may use now-unsupported syntax. Results are capped at 50 internally, but the tool exposes at most five pages of five; the displayed total can hide both additional matches and inaccessible capped results.

23 queries had a subsequently navigated entry available at the query cutoff: 16 had such a target in top five, 19 in top 25, 19 in top 50. This is only a behavior-derived navigation proxy. Later expansion is neither relevance ground truth nor independent evidence of a complete answer; selection favors episodes that navigate.

### Timing

273 production `searchEntries` calls on preloaded historical prefixes: median **11.34 ms**, p95 **142.36 ms**, maximum **636.39 ms**. This excludes file parse, render, lineage selection and output formatting.

Full production tool calls on the three largest selected files, using their first observed topical query and a read-only manager facade:

| File size | First measured call | Next two calls |
| --- | ---: | ---: |
| 268.7 MB | 488 ms | 394 / 369 ms |
| 192.4 MB | 431 ms | 420 / 416 ms |
| 142.9 MB | 287 ms | 262 / 271 ms |

Files had already been parsed for replay: **all are warm-filesystem measurements**, not cold-start numbers. First measured call is not cold disk. Three queries are not a workload latency distribution. Native SessionManager startup time and peak RSS were not measured. Repeated whole-file parsing is established in code, but these numbers do not justify prioritizing speed over evidence quality.

## Independent labeled evidence

See [independent-evaluation.md](independent-evaluation.md) for sampling, labels and limits. Six real questions, 38 fully labeled episode entries (19 relevant), and 30 relevance-labeled top-five entries:

| Measure | Historical audit | Current deployed replay | Issuer-only exclusion prototype |
| --- | ---: | ---: | ---: |
| Precision@5 | 9/30 | 9/30 | 9/30 |
| Evidence hit@5 | 5/6 | 5/6 | 5/6 |
| Episode-relative micro recall@5 | 7/19 | 7/19 | 7/19 |
| Delivered snippet sufficient | 2/6 | 2/6 | 2/6 |

Ciaran independently read the two new prototype hits before scoring them; both were irrelevant. **The prototype did not improve these quality measures.** No ranker/chunker gain is claimed. The gold is purposive, single-rater and clustered; episode recall is not exhaustive whole-transcript recall or product accuracy.

Seven project notebook lookups: five structural successes and two missing IDs. Source support among the five resolved: one substantive, three partial, one unrelated. A resolved source is not a semantically supported claim. Three selective summary checks found one claimed compaction loss whose checklist remained in the active ancestor summary. Mail search has no observed direct-call quality sample here; its source and storage were inspected, not its answer accuracy.

## Executed behavioral counterexamples

`contracts.mjs` asserts seven present behaviors using synthetic fixtures:

1. `expand:[0]` is rejected despite the non-negative schema.
2. Custom-message mail is not searchable.
3. A compaction summary is not searchable.
4. Default history search misses modern `edits:[{oldText,newText}]` body terms.
5. File mode finds the same edit terms.
6. `alpha.ts` also matches `alphaXts` because the dot selects regex.
7. Regex returns the earliest 50 matching entries, before relevance ranking; later matches are absent.

All seven assertions passed. These probes characterize current behavior; they are not proposed acceptance tests for preserving defects.

`retention-probe.mjs` against installed Pi passed three synthetic checks: last-compaction-only retention loses a kept message and prior thinking state (4/high becomes 3/off); an unwritten branch cursor does not replace the native persisted-leaf rule. No private files were used.

## Storage sizing experiment

Streamed the same 22 selected files through Node's default gzip, discarded compressed content, and counted bytes. A rerun checked size/mtime before and after each file; all 22 were stable during their individual read at 07:34:09 UTC.

- Raw: **1,599,564,862 bytes**.
- Gzip: **651,634,253 bytes**: **59.3% reduction**, or 40.7% of raw bytes.
- Naive physical suffix from latest compaction's `firstKeptEntryId`: **47,550,415 bytes**, 2.97% of raw.

The suffix is a **sizing sketch, not a safe hot set**: it omits older required state/ancestry/other branches. Gzip is a whole-file, one-codec measurement, not a validated random-access archive format. No original was compressed/replaced/deleted. Compression does not make lifetime storage finite.

## Reproduce

Run from repository root with the installed Node and dependencies. Scripts locate repository imports by walking to `package.json`, so archiving this ledger bundle does not break a fixed parent-depth assumption. Outputs with private paths/queries remain outside the repo.

```bash
umask 077
mkdir -p /tmp/recall-study
node .ledger/history/202611020022-long-lived-agent-recall-and-retention/inventory.mjs \
  "$HOME/.pi/agent/sessions" /tmp/recall-study
node --import ./components/session-state/src/register.mjs \
  .ledger/history/202611020022-long-lived-agent-recall-and-retention/replay.mjs /tmp/recall-study
node .ledger/history/202611020022-long-lived-agent-recall-and-retention/storage.mjs /tmp/recall-study
node .ledger/history/202611020022-long-lived-agent-recall-and-retention/state-inventory.mjs \
  "$HOME/.pi/agent/state/apple-pi.db"
node --import ./components/session-state/src/register.mjs \
  .ledger/history/202611020022-long-lived-agent-recall-and-retention/contracts.mjs
node .ledger/history/202611020022-long-lived-agent-recall-and-retention/retention-probe.mjs \
  /path/to/pi-coding-agent/dist/core/session-manager.js
node --import ./components/session-state/src/register.mjs \
  .ledger/history/202611020022-long-lived-agent-recall-and-retention/gold-replay.mjs \
  /tmp/ciaran-recall-audit/private-gold.json /tmp/recall-study
./node_modules/.bin/vitest run components/session-search/tests --maxWorkers=1
```

The manual gold/private maps and 31 call judgments are retained under `/tmp/ciaran-recall-audit/`; broader inventory/replay maps and numeric output under `/tmp/kofi-recall/`. They contain private content/locators and are not repository artifacts. Temporary locations can disappear; exact manual-label reproduction requires those private mappings or relabeling originals. Public scripts reproduce methods on a newly changing corpus, not an immutable copy of today's data.

Focused baseline result: **10 test files, 86 tests passed**, one worker. No full test suite ran. Initial replay launch failed because its import walked one directory too far; corrected to root discovery and reran successfully. The first storage run lacked per-file stability checks and was superseded by the checked rerun above. No production implementation or approval is implied by these checks.
