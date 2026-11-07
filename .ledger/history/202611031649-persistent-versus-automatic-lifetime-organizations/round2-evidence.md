# Round-two runtime repairs

Task: work-482e50bd-5a4b-4eaf-81ca-777f1502443e. Review: review-6dff9d59-b470-4334-aee1-f7680cb9b113, original range 803fc6ef..827d4191. Baseline includes reflection cleanup 25184cec and Workplace fixes 3bd086e4. No shared runtime restart or live destruction was performed.

## Reproductions before repair

- Native tree entered its cancel hook through a held seal. An earlier SDK input handler stayed pending through abort/dispose while its replacement incorrectly sealed. `/tmp/niamh-round2-red.txt` reached both intended assertions.
- Both delivered and applied explicit close references survived root merge/split and closed the reformed root with a new child. The same log reached `closing=true` where false was required.
- Older same-generation sockets, both deliberate interactive and command-derived, ended the newer admission and established closing. The same log reached the closing assertion.
- Both thread_post and versioned communication publication returned applied but generated terminally failed mail. The first run timed out; `/tmp/niamh-round2-mail-clock-red.txt` instead asserts the failed delivery directly. The timeout is not the defect oracle.
- A real SDK reload after a five-second Date.now correction reapplied a consumed startup flag to its new merge target. The second log waits for the reload's new hello name before the false/true lifetime assertion.
- An exact copy of the 3bd086e4 input gate (verified by cmp) was exercised by the expanded native tests in a temporary probe. `/tmp/niamh-round2-native-baseline-red.txt`: six intended failures, two existing passes. Tree entry resolved instead of rejecting; manual compaction reached its cancelling hook instead of the seal rejection; held tree/compaction preparation and disposed input allowed replacement sealing; legacy unknown state certified quiescence. The temporary repository probe was removed. The final suite additionally asserts exclusive ticket ownership.

## Repair boundaries

`session-input.ts` keeps pending count with the launch latch, covers native tree/compaction/reload/bug-summary methods, retains unknown legacy state conservatively, and permits only the existing ticket's repeat seal. Old adapters cannot advertise the strengthened capability.

`runtime.ts` binds one current bridge admission, even within a generation. Old frames cannot end it. Close execution references retain the actual delivery connection after application, and the accepted command's event must follow the source root's latest transferred event. This reuses the existing event/command journals, not a separate consent registry.

Published mail remains accepted in its existing outbox. Publication invalidates the proof and requests release. The current connection's release barrier withholds delivery and fresh input until that release is applied. Disconnect/restart rebuilds the release from the new hello's retained ticket, then dispatches the one existing message. A scripted mail receipt is not native transcript-persistence proof.

`bridge.ts` and protocol carry a process-lifetime opaque launch token; startup consumption queries that token in the existing event rather than comparing wall clocks. Legacy hellos without a token leave recorded lifetime unchanged. The owner explicitly approved withholding launch authority for hot-loaded legacy/unknown gates. A seeded legacy-launch native test reproduced accidental fresh authority before this refinement (`/tmp/niamh-round2-hotload-red.txt`); current code withholds both capability and token until a genuinely current-code process.

No apps/agent-workplace/src or dist file was changed in this round. Tadhg owns Workplace integration and activation.

## Formal evidence

`native-quiescence.tla/cfg` supplements the existing connection/ticket/crash model with three SDK objects, older preparation surviving replacement, and native tree work. Intended model: PASS, 305 generated / 92 distinct / depth 9. Object-local control: VIOLATION, Input -> Replace -> Agree -> Commit. Tree-bypass control: VIOLATION, Agree -> Tree -> Commit. See native-quiescence-results.txt and the model context for source mapping and bounds. Finite safety only; composition, liveness, extracted implementation and physical OS behavior are not proved.

## Checks so far

- Initial repaired input/lifetime files: 39/39 passed; root and web typechecks passed (`/tmp/niamh-round2-green2.txt`, `/tmp/niamh-round2-types2.txt`).
- Expanded native, legacy capability and held-mail reconnect/restart controls: 17 selected passed, 30 skipped (`/tmp/niamh-round2-extended.txt`).
- Exclusive-ticket/current-delivery/release-admission refinements: 18 selected passed, 29 skipped (`/tmp/niamh-round2-extended2.txt`).
- First combined check never reached tests: Biome rejected hello complexity 54 > 50. bindBridge extracted the actual admission phase; the ceiling stayed unchanged. Its shell tail only proved typecheck, not a green test run.
- Broader focused regression before the final legacy-hotload refinement: 15 files, 172/172 passed in 206.43s. Root/web typecheck and extension loader passed; package inventory contained 2811 files including the gate and excluding ledger models. This is not the final refined-tree run.
- Scoped Biome (7 TS files), comment lint, git diff --check, and context lint (666 files) passed. Markdown was not formatted by Biome.
- First refined-tree broad run: 172 passed / 1 failed at review-worker admission (`/tmp/niamh-round2-final.txt`). The fixture had no hello/admission barriers. Its correction waits for the owner and the awake worker's reports_to before enqueue, keeping the authority assertion intact; a baseline failure rate was not measured.
- Corrected broad tree: 15 files, 173/173 passed in 198.77s, followed by root/web typecheck and loader pass (`/tmp/niamh-round2-verified*.txt`).
- The final strict hot-load boundary also covers first installation during reload with no retained latch: public late bridge installation + native reload reached fresh-incorporation red (`/tmp/niamh-round2-late-install-red.txt`). First non-startup binding now caches unknown launch eligibility; only startup can create its token. For that last bridge-only refinement, four final files passed 83/83 in 63.19s, followed by root/web typecheck and loader pass (`/tmp/niamh-round2-final-launch*.txt`). The 15-file regression was not repeated after this last bridge-only refinement; it is the earlier 173/173 cut, not an extra 173 tests on the final tree. Final scoped Biome covered eight TS files, comment lint and whitespace passed, and context lint passed 666 files.

No full repository suite, independent recapture, paid provider turn, physical terminal/window test or production activation is claimed. Finding responses remain the manager's action.
