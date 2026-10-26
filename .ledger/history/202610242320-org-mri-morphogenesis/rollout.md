# Authorized runtime rollout

## Authority and preflight

After approving all seventeen source increments, the operator explicitly selected “Roll out now” for a private SQLite-consistent backup, guarded shared-runtime restart and live schema verification. Code approval alone was not used as restart authority.

Read-only preflight and the final restart guard observed schema27, runtime PID82549 (runtime-main.ts, started October25), zero persisted program scopes and zero launch-ownership rows. All five remaining awake colleagues had zero held tasks and were idle; they were sent home with history preserved. Liesel was already home.

## Backup and execution

- Private consistent backup: `/Users/alexanderbut/.pi/agent/state/backups/apple-pi-before-schema29-2026-10-26T213820224Z.db`.
- Backup:158449664 bytes, schema27, SQLite `quick_check=ok`, file mode0600. No database contents were copied into this repository.
- The first one-off script validated the backup but stopped before SIGTERM: a diagnostic local named `process` shadowed Node's global and caused a temporal-dead-zone ReferenceError. No daemon was stopped by that attempt. The corrected script reused and revalidated the backup and rechecked PID/process/schema/program guards.
- SIGTERM sent only to verified PID82549 at2026-10-26T21:39:25.861Z. No pattern kill or forced kill was used.
- Standard checkout `connectRuntime` connected to replacement PID29566; the PID belongs to this checkout's registered runtime-main.ts.
- At2026-10-26T21:39:32.508Z the live database reported schema29 and the socket connection succeeded.
- A subsequent legitimate native reply in the final review thread was accepted by the replacement runtime; recipients at home remained home. This is a live command/receipt check, not a synthetic economic event or new teammate launch.

The private backup directory also holds a JSON execution receipt with these aggregate facts. Restoring this pre-migration snapshot later would discard subsequent workplace writes; it is not an automatic rollback instruction.

## Remaining client refresh and proof limits

The daemon migration is verified separately from source tests. Existing Pi processes still need refreshed package code for the new tool names, `/org` command and prompt sections. Colleagues at home will load current code on their next opening. The operator reloaded the root session. Updated tool definitions and native org guidance are present; an actual `org_work` call successfully returned this undertaking as held with no open wait. Live schema29/PID29566 were rechecked. The separate `pi_exec` basic `1` precheck still fails with invalid-type-form before execution; no guest action or peer turn occurred.

This rollout does not recover unknown legacy callers, ancestry or deleted spans, and does not change measurement exclusions or observation/timestamp conventions. The manager demonstration remains scripted integration, not autonomous judgment. No full suite, installed-tarball/native CLI test, paid model/new teammate launch or pi_exec composition proof is added by a healthy daemon and schema migration.
