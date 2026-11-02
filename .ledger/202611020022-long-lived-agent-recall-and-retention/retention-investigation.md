# Transcript retention investigation

Date: 2026-11-02. Investigator: Saskia Tuilagi; edited into this artifact by Kofi Bhattacharya from task-thread reports 7513, 7514 and 7519. Design only. No production changes or private histories were opened through Pi's mutating loader.

## Finding

**Compaction bounds model context, not the logical transcript, loaded tree, or total disk. A compaction boundary is not a storage garbage-collection boundary.** Keep lossless logical history while separating ordinary execution from on-demand historical access.

With installed Pi 1.4.0 unchanged, retain canonical JSONL and improve readers. Extension-only tail truncation cannot safely bound SessionManager memory. A real hot/archive split belongs at Pi's session-storage boundary, with apple-pi consumers adapted to that boundary. Moving bytes into an archive does not bound lifetime disk; compression reduces its growth rate. Finite total storage requires an explicit deletion/expiry or external-storage policy, with loss/availability consequences.

Source baseline: repository HEAD `309099c9c20e9ae47e58778a3036bd542bbf0ae6`; concurrent lanes were changing unrelated runtime/UI files. This is an investigation, not a captured code review.

## Native behavior verified in source

Installed package: `/Users/alexanderbut/.bun/install/global/node_modules/@earendil-works/pi-coding-agent`, version 1.4.0. Inspected `dist/core/session-manager.js` and its `docs/session-format.md`, `sessions.md`, `compaction.md`, `message-types.md`, and `sdk.md`.

- `loadEntriesFromFile` (325-369) incrementally reads bytes but accumulates all parsed entries. `_loadEntries` / `_buildIndex` (717-753) retain `fileEntries` and `byId` for the complete tree.
- `_persist` (794-819) appends; `_rewriteFile` (754-765) truncates and rewrites the pathname. This module supplies no cross-process writer lock or fsync guarantee.
- `buildContextEntries` / `buildSessionProjection` (196-279) follow the leaf ancestry, choose the latest compaction, retain its checkpoint and summary, the range beginning at `firstKeptEntryId`, subsequent entries, and context edits. Model/thinking settings depend on the path, not just the kept messages.
- `getBranch` (1062-1073) stops at a missing parent without an integrity error. Tree construction treats orphans as roots. On reopen, `_buildIndex` chooses the last physical entry as leaf. An in-memory branch move without a new appended entry is not a durable cursor.
- **Read-only trap:** `loadEntriesFromFile` appends a newline to a valid-header file with an unterminated nonempty suffix. `SessionManager.open` can also migrate/rewrite old versions. Inventory must use direct read-only parsing instead. Malformed lines are silently skipped; archive verification must report them, not certify the filtered result as lossless.

Kofi independently checked the projection/loader code, bridge append counter, and all-branch self loader. `retention-probe.mjs`, using invented entries only, reproduced three counterexamples against the installed Pi: retaining only compaction-and-after changes four projected messages to three and thinking `high` to `off`; an unwritten branch cursor reconstructs to the last physical entry instead. These are executed synthetic results, not production incidents.

## Consumer inventory

| Consumer | Source/input | Obligation across archival |
| --- | --- | --- |
| Pi context/tree/compaction | `session-manager.js` projection, ancestry, settings | Original IDs/parents, compaction kept boundary and system checkpoint, context edits, labels, branch summaries, opaque provider fields |
| Pi fork/clone/export | `createBranchedSession` (1205+), `forkFrom` (1374+), `session-export.js` | Full logical history at native scope; independent ownership of copied histories |
| Session search | `components/session-search/src/load-messages.ts`, `lineage.ts`, `tool.ts` | Whole-file reader today; global message ordinal computed before lineage filtering. Preserve old ordinals and original entry IDs; custom messages are absent from its present loader |
| Notebook fold and exact recall | `components/notebook/src/session-ledger/{fold,sources}.ts`, `tools/notebook-source.ts` | Full branch records, tombstones, source IDs, retired notes and `childSources`; the open-notes packet is not a replacement |
| Pair | `components/pair-programmer/src/extension.ts:1626-1695`, `receipt-expansion.ts:173-278`, `recall.ts` | Source membership/cursors/coverage and stale-update validation. Receipt handles remain ephemeral and store/branch scoped |
| Code-context gate and reflection forks | `components/code-context/src/installer.ts`, `components/shared/src/forked-continuation.ts:350` | Gate sees current projection or fork messages. An archived read never restores edit permission. Fork retains the same model-visible prefix |
| Monty state | `components/pi-exec/src/session.ts:38-44,110-135`, `checkpoint.ts` | Latest branch-local authenticated `apple-pi:monty-session` dump plus private key; preserve bytes/MAC, never select newest globally |
| Identity, self and name | `components/organization/src/session-role.ts:65-84`, `self.ts:105-110`, `components/session-title/src/index.ts:34` | Role/soul/mind/self/title authority stays with transcript. Role and stored-self currently scan all entries, despite branch-local wording in self docs; preserve observed semantics or fix separately |
| Delivery replay | `components/session-state/src/mail.ts:26-34`, `bridge.ts:538-560,636` | Historical mail command IDs across all branches, before startup replay. Shared-message IDs and read cursors are different facts |
| Runtime index and accounting | `bridge.ts:282-287,538-549`, runtime `readEntry` / `readEntries` / `scanTranscript` | Logical append counter, IDs/previews, full-history cost; raw bodies still come from transcript paths |
| World and reviews | `apps/agent-world/src/backend/{conversations,transcript}.ts`, `components/session-state/src/review-read.ts:744+` | Old transcript page bodies and recorded reviewer session logs resolve through archives, not just DB previews |
| Other manager-array users | BTW, notify, input-editor, terse-tools inspector | Identified, not fully audited. Compatibility tests must cover their snapshots, metrics and inspections |
| Permanent departure | `components/session-state/src/departures.ts:78-111` and runtime ownership guards | Archive/index objects join private-file ownership proof and cleanup. A surviving child's independently owned history remains intact |

This inventories known native/repository consumers, not every user-installed third-party extension. Preserve unknown custom data exactly until its semantics are understood.

## Failure sequences and cheapest remedies

1. **Last-compaction-only cut:** delete its kept ancestor and earlier thinking record; next request changes. Executed above. Remedy: preserve exact projection and separately recover settings/state; leave bytes intact until storage supports this.
2. **Drop old custom records:** role disappears, Monty resets, notebook evidence vanishes. Remedy: full logical records plus verified state reducers; keeping every opaque custom payload hot is safe but is not a memory bound.
3. **Mail persist/receipt crash:** delivery D is in the transcript, applied receipt is lost, truncation removes D, reconnect queues D again. Remedy: archive-aware all-branch delivery membership before replay, with verified watermark/tail catch-up.
4. **External live rotation:** archiver snapshots through X; Pi appends Y; archiver replaces pathname through X; Y is lost, or next append Z references missing Y. `_persist` opens the pathname anew each append. Remedy: writer-owned fencing, not a background file mover. An idle runtime flag is not writer quiescence; reflections/custom messages can append.
5. **Durability window:** delete the source before new archive/descriptor is durable; power failure loses both authorities. Remedy: verified, flushed new objects and directories, one atomic generation publication, old-reader accounting. Native append has no stronger durability promise; rotation must not add a new acknowledged-prefix loss window.
6. **Physical-tail indexing:** bridge indexed 10,000 entries; replacement exposes 100; `indexNew` waits until length exceeds 10,000. Old bodies and accounting also disappear. Remedy: logical append sequence, archive-aware body resolver and complete accounting; never reset IDs or ordinals.
7. **Wrong state rehydration:** archived context markers re-enable an edit, or a different branch's checkpoint supplies variables. Remedy: separate raw historical access, branch-relative state, and live model projection.
8. **Incomplete permanent cleanup:** departure deletes only the original file while private archives survive. Remedy: session-owned object enumeration in cleanup; initially avoid cross-person shared/deduplicated archive references.

Except the first, these are source-derived counterexamples, not claims that these incidents already occurred.

## Proposed storage boundary

### Logical transcript and physical layout

Retain the person's original UUID. Represent one append-ordered logical transcript as immutable historical segments plus one append tail. A versioned descriptor names ownership, generation, segment order, lengths/digests and the tail. Segmentation creates no model-visible message, synthetic compaction, new person or reparented history.

Keep IDs, parents, raw values/provider signatures, timestamps, custom data and original message ordinals. A rebuildable private locator maps IDs/ordinals to verified segment byte ranges and parent/type metadata. A filename/mtime is not object identity. The runtime DB remains a derived view, not a replacement transcript or backup.

### Ordinary hot execution

Materialize the exact Pi projection and required execution state: compaction/system checkpoint, kept messages/context edits, model/thinking, identity/self/title under current semantics, folded notebook/coverage, selected Monty checkpoint, mail delivery membership and accounting views. Cache them with source generation and append watermark. Invalid caches rebuild or refuse; they never imply empty state.

Archive evidence resolves lazily by original ID. Branch navigation rebuilds the requested target's ancestry/projection/state. Missing or corrupt dependencies give an explicit unavailable/integrity result, not shortened context. Search/export/fork see the full logical stream. Code-context still sees only live projected messages.

**A compact payload cache is not enough for bounded memory:** loading every graph node still scales with lifetime entries. Page ancestry/state indexes too, and migrate ordinary startup/polling away from eager `getEntries`/`getBranch` arrays to selected-state, delta or streaming operations. A compatibility array may hydrate full history only on an explicit legacy read; unsupported consumers block a bounded-memory claim. Opaque custom records remain lossless.

### Offline first publication

All supported launch/open/append paths, including native resume and SDK hosts, must honor the same session-storage writer fence. Otherwise keep legacy storage. An extension hook after native loading is too late. No live process stop or daemon restart is authorized by this report.

1. Fence new writers and prove writers/continuations are stopped or finished; record expected source generation, header, exact length/digest. Stable stat alone is not proof.
2. Copy complete raw records into private temporary immutable objects; report malformed/ambiguous sources. Build versioned locator/state caches with explicit watermark.
3. Verify byte identity, ID uniqueness, ancestry and consumer equivalence. Flush objects and containing directories.
4. Atomically publish **one descriptor generation**. Readers pin that generation per operation. Preserve old objects while readers can need them.
5. Reopen through the upgraded writer; existing hello/index flows observe the unchanged person. Storage generation is not runtime process-incarnation generation. Logical append sequence continues.
6. Retry against the expected generation. Before publication, old history remains authoritative. Afterwards, descriptor plus named objects are authoritative; replay tail/rebuild stale caches. Discard caches ahead of verified bytes. Missing authoritative objects stop affected operations.

Online rotation would need a later writer-owned append-boundary handoff and reader/fork pinning. Filesystem crash behavior needs fault tests; atomic rename alone is insufficient.

### Existing people and rollback

Begin with read-only dry-run validation, then one dormant noncritical person after approval. Preserve UUID/name/role/soul/mind/self, assignments, thread access/read cursors, delivery IDs, accounting and historical citations. Storage location is not organizational identity.

Preserve v3 IDs. Legacy v1/v2 migration needs an explicit tested ID mapping and original-byte preservation; native conversion on the sole source is unsafe for an inventory. Refuse ambiguous duplicate-ID/cyclic/malformed histories; existing source gaps remain disclosed as pre-existing.

Upgrade discovery, open/write, tree/fork/export, apple-pi state consumers, runtime body readers, review logs and departure cleanup before activation. Old binaries must refuse rather than read only a tail or create another person with the same ID.

Before new writes, rollback selects the old generation under the fence. After new writes, rollback materializes the complete logical stream including those writes; restoring a pre-migration snapshot loses work. Include archive ownership and retained-backup policy in permanent departure from the outset.

Use compaction as a natural opportunity to reconsider hot state, not as permission to delete. Choose operating targets from measured costs and operator approval, not invented days/MB caps. First version retains historical records indefinitely; total-disk expiry is a separate decision.

## Required verification before production cutover

- Differential exact model messages/provider metadata/settings at every eligible split: retained-range variations, repeated compactions, context edits and system checkpoints.
- Consumer parity: IDs/ordinals and file recovery; open/retired/child notebook sources; scoped pair receipts; stale context markers; Monty authentication/branching; identity/self; native tree/export/fork; World and reviewer old bodies.
- Replay: mail recorded before lost receipt; index lag/rebuild, runtime restart and extension reload; append during pinned reads; identical accounting.
- Faults at each write/flush/rename/publication/cleanup: ENOSPC, partial lines, checksums, missing segments, stale cache, live/slow/competing writer, late reflection. Outcome is complete old/new authority or explicit refusal, never silent partial success.
- Ownership: parent departure preserves child history while deleting exclusively owned private objects; shared mail follows its separate contract.
- Equal-work cold/warm startup wall time and peak RSS, normal turn/bridge cost, lineage/all-branch recall, branch switch/archive access, disk and write amplification. Verify that another consumer did not simply inherit the full parse.
- Old binary and unaudited extension behavior: explicit refusal or documented full-history compatibility cost.

Source inspection and the synthetic probe disprove naive truncation. They do not prove the proposed storage protocol correct. No fault injection, archive implementation or native-startup RSS trial has run.
