Status: pending
Created: 2026-10-31
Updated: 2026-10-31

# Retrospective

## What Mattered

In progress. The capture foundation was exercised before any paid reviewer turn. Preserve the distinction between this checked component and the still-pending runtime and operator-facing experience.

## Learnings

Git's virtual empty-tree handling hid a missing stored object until full artifact verification ran. A root-commit capture needs a materialized empty tree, not only a resolvable ID. The capture context file owns that invariant.

A checkout-scale measurement exposed process-per-blob acquisition as the dominant cost: 353.7 seconds for 4,930 files. Git batch acquisition retained identical source and patch identities in 21.4 seconds, including verification. These single observations justify the changed I/O boundary, not a general latency or review-quality claim.

The first runtime increment kept capture/admission and actual review execution separate. A disconnected request can leave a verified queued target, but it is not a completed review. Restart requires explicit resume and re-verification rather than recapturing changed live source.

Peer regression checks found eight pre-existing cleanup failures at the committed baseline. The program lifecycle already journaled temporary task disposal, but its shared file-cleanup reader ignored that action. Fixing the shared reader restored cleanup without changing the process-death guards or deleting historical finished-task evidence. An explicit close assertion also prevents a test teardown's Promise.allSettled from hiding cleanup failure.

The execution checkpoint exercises the real runtime and separate SDK sessions on scripted models. It now proves more than fresh identities: first provider messages include the normal role section and captured-source tool results, exclude author narrative and other first reports, and expose those reports only during validation. Scripted risk labels still prove dispatch rather than the model's ability to choose a good plan or find a defect. Completion of this kernel is not delivery of the pending tools and UI.

The ordinary-onboarding positive control initially failed because it still expected full backscroll. An unchanged baseline reproduced it; the existing pointer contract, rather than the new review behavior, determined the correction. Keep the ordinary-hire positive control beside independent-review tests so an indiscriminate removal of startup context cannot look like success.

The reader checkpoint exposed two different failures that a completed report did not settle: a validator challenge still counted as completed coverage, and resume reused the challenged report because its inputs matched. The corrected test forces a new inspection while preserving unaffected work. An intervening failed retry exposed that the challenge also needed to persist independently of current selections; it now blocks reuse on the exact challenged attempt, atomically with the validator output. Identity also mattered in the fixtures: selecting the first review row concealed the wrong request/result association until several jobs were queued. Shared organizational tree rules remained useful, but the work-task anchor inventory was not a review inventory; a merge without surviving work tasks reproduced the difference. These lessons now live with the reader, worker and tests.

The decision checkpoint keeps a fix in later code separate from the original snapshot. Even a selected verification question on a different artifact cannot make the old code repaired or silently approved. The old finding remains a sign-off limitation, and substantive owner judgments remain visible even when they disagree with model rejection. Scripted tests establish those recording and consent boundaries, not whether the evidence actually proves a real fix.

The TUI checkpoint uses one-row queue pages in its loaded-command test. That makes live reordering an identity test rather than an incidental same-page label check. It also keeps fake-terminal geometry distinct from a real terminal paint and leaves the unactivated entrypoint out of the completion claim.

The retirement increment moved runtime assertions out of the deleted Pi Exec panel tests rather than discarding them with the renderer. Five initial failures were presentation assumptions: native child traces keep pi.read/pi.grep/pi.bash while the old panel shortened those names. The corrected tests inspect native evidence and still exercise real role-loader boundaries and guarded cleanup. A task cancellation test now uses the native tool, and old UI storage/registration is removed without a parallel replacement dashboard. These checks do not establish an actual review in a live provider or an assembled Workplace/sign-off experience.

Capture preview deliberately uses the existing acquisition twice rather than introducing draft jobs or adopting UI-owned source. Exact digest comparison then makes an ordinary edit between preview and confirmation a refusal before reviewer dispatch. Source inspection also exposed two UI constraints before relying on the native confirm dialog: its title is not scrollable, and editor-container dialogs can sit beneath a floating panel. The bounded confirmation has fixed controls and its own overlay handle, with tests for long/narrow content, hidden-panel focus and abort beside an unrelated dialog. These remain fake-terminal checks. A non-configurable Node ESM export prevented a cleanup spy; a test-owned TMPDIR and real empty-directory assertions gave stronger cleanup evidence instead.

Policy recovery needed more than adding policy to the attempt key. The existing planner bypassed the attempt path entirely on resume. Four isolated cases reproduced retained planning after role text, candidate, selection or catalog changes. Every resume now checks planner eligibility too; its selected identity is the narrow exception to the plan-revision increment it produced. Changed planning invalidates old inspection credit. Startup and real-SDK mid-turn gates verify policy races independently from model membership, while preserving the original raw result. These checks do not establish capture-time policy identity, live applicability or review quality.

The first live terminal feedback rejected the visual result despite passing functional and geometry tests. Activation made that gap visible; the operator asked for substantial chrome, colors, iconography and hierarchy. This is acceptance work in the current delivery, not a cosmetic follow-up. Real terminal inspection must accompany the functional checks.

The installed /reviews command could be inspected without models or a production runtime connection: use a separate tmux server, isolated agent/session directories and a private database backup; clear credential environment variables, disable automatic extension discovery and MCP, and load only the review extension. Keep that database private and avoid submitting mutations from the inspection copy. In the ANSI image renderer, Console.capture() yielded an empty recorded image; Console(record=True, file=io.StringIO()) preserved the Text.from_ansi output for export. These images show captured terminal cells, not the operator's desktop or operator acceptance.

The first native findings-view test used the wrong scripted control shape and therefore generated no findings. The fixture expects {review:{finding:true}}, not a sibling finding field beside review:true. The isolated terminal already showed the real allegations. Checking the fixture consumer separated a setup failure from a production-reader defect; the corrected control and this hazard now live with the review-queue test context.

Native no-change testing also crossed a fixture boundary: a restarted runtime had lost fakeBridge's connection but the stand-in writer was still alive. The dormant-departure assertion timed out behind the correct exclusive-binding guard. Explicit test-owned process exit, rather than weaker cleanup or a longer wait, supplies the state the test intended.

The first real policy-correctness pass found a dependency the selected-role regression had missed: the all-advisory catalog still loaded malformed profile configuration even when no role referenced it. The helper's local lazy read was not sufficient for its aggregate consumer. A local regression reproduced this, and the catalog now applies the same dependency rule before loading shared configuration. That is one independently found, reproduced defect; it does not establish comparative review effectiveness.

The reliability pass found a second, cross-phase defect: individually valid checks accepted a focused B-policy report between planner A and final catalog A. The conflicting identity was already recorded; a new watcher was unnecessary. Comparing each attempted policy with the planner catalog before reuse or launch closes the acceptance gap. A local cleanup-gated reproducer failed at the actual completed outcome before the fix, then proved refusal before B launch and consistent resume. The validator independently confirmed both original allegations. This live case supplied useful defects, but seven turns,46.6 minutes and $13.88 observed primary-turn cost are observations, not a comparative quality or economic claim.

The actual terminal check also found a stale progress claim after preview cancellation. Existing tests proved that no review started, but not that the UI described that outcome truthfully. A native-entry regression reproduced the Capturing message; the shared confirmation owner now replaces it with a scoped not-queued outcome, also observed through installed Pi. The visual pass gives status, focus and findings an explicit hierarchy while keeping completion, validation, later fix claims and approval separate. Component tests, actual terminal cells and operator acceptance remain different evidence. Final renderer changes received focused rechecks rather than relying on a suite that had started before those edits.

The cost projection follows retained attempts rather than selected coverage, so failed and cancelled work remains visible without charging reused evidence twice. Missing usage is not zero, and primary-turn cost is not total internal activity or an invoice. Two fixture/representation failures sharpened the check: stopRuntime deletes its state directory, so altered stored-data tests now use an online copy; and SQLite numeric extraction rejected 2**53 at Node's safe-integer binding, so the projection reads JSON text before validating numbers. Both lessons are placed with the reader/tests.

## Improvements

Pending completion of the undertaking.
