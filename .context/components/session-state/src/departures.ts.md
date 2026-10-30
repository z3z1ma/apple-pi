## file

A `person_departed` event is the permanent identity authority after the live row is removed. It means departure is irreversible; process death, filesystem cleanup and final command completion are separate facts. The retained reporting/name snapshot serves historical accounting and shared authorship, not a reusable directory entry. `reportsTo` remains null for an independent person departed by the operator; that absence is a historical root, not operator membership or a missing manager to invent. Cleanup, retained authorship and accounting use the same marker as dependent-person departure.

Earlier `retired` and `rehired` events describe the old reversible lifecycle and remain historical evidence. Their existence alone is not a permanent marker: an active person may legitimately retain an old retirement/reopening sequence. Keep this distinction at both start and hello admission rather than trusting a missing live row.

The cleanup caller proves writer/process safety before removing files, and owns the single database transaction that ends current participation and removes private records. Filesystem success alone is not command completion. Private prompt/fact payloads and start/steer/run_turn failure text are redacted by their actual fields in both command rows and mirrored events. Shared mail/work/link receipts, event chronology, accounting and lifetime facts remain; new shared event kinds survive without a whitelist change.
Why: dropping all events or command payloads would erase legacy shared mail and economic provenance, while deleting only live rows would leave private prompt and tool text in the journal. `person_departed.sessionFile` is cleanup ownership until success, then cleared without erasing the permanent identity or handoff pointer.

Rejected permanent identities can still report a real writer and exact file before being closed. `departure_writer_seen` keeps that narrow ownership across restart without admitting an incarnation or applying facts. Cleanup rechecks its observation/binding watermark after awaits and at destructive boundaries; the file guard complements process proof rather than replacing it. Successful cleanup clears private file pointers while retaining chronology. A later rejected attempt adds a new resource obligation, not a reversal of the earlier truthful completion.
Why: ordinary incarnation history cannot describe a rejected producer, and a live or switched process cannot safely be treated as dead merely because an old session ended. The guarantee covers harness-observed cooperative producers, not arbitrary external filesystem writes.

Usage cleanup follows the existing agent-directory `.ndjson` layout and its single rotation. A sanitized/shared fallback is not exclusive ownership; ambiguous IDs fail closed instead of deleting another session's or unscoped usage.

Coupled: components/session-state/src/runtime.ts, components/session-state/src/fitness.ts, components/session-state/src/threads.ts
Verify: components/session-state/tests/departures.test.ts, components/session-state/tests/departure-lifecycle.test.ts
