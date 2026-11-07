## file

Companion refinement of organization-quiescence.tla for native work lifetime. Three successive SDK objects share a launch seal and pending work; replacement/disposal leaves earlier promises pending until their actual settlement. Input represents pre-agent_start preparation, Start later model activity, and Tree native navigateTree/compact preparation. Release abstracts the existing protocol model's invalidate-before-release sequence. The protocol model retains connection/ticket/crash semantics; this companion isolates its previously missing native-owner assumption. Their composition is not proved.

Agree uses every object's work in the intended model; UnsafeLocal inspects only the replacement. UnsafeTree permits work through a held seal. Each must produce NoUnsafeDeparture counterexamples. Commit is the irreversible marker, not process termination or file cleanup. Three objects and four work states are finite bounds, with no liveness or extracted-SDK proof.

The source map is sessionInput.run -> Input/Tree/Start/Settle, process-owned pending -> work across all objects, native replacement -> Replace, seal -> Agree, release -> Release, and runtime departure preflight/marker -> Commit. The real SDK controls establish that preparation survives disposal and that both native tree/compaction entry and their asynchronous lifetime are covered. Their old-source red controls guard this mapping; a TLC pass alone does not.

Coupled: .ledger/202611031649-persistent-versus-automatic-lifetime-organizations/native-quiescence.cfg, .ledger/202611031649-persistent-versus-automatic-lifetime-organizations/organization-quiescence.tla, components/session-state/src/session-input.ts, components/session-state/src/runtime.ts
Verify: components/session-state/tests/session-input.test.ts, components/session-state/tests/organization-lifetime.test.ts
