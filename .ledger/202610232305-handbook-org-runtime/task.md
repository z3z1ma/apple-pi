Status: planning
Created: 2026-10-23
Updated: 2026-11-07

# Organization runtime for the handbook model

## Intent

Historical candidates raised during the 2026-10-23 handbook rewrite (see `docs/organization.md#processes` and `skills/handbook-writing/`); current disposition follows. Product documentation and present source take precedence over these proposals.

1. **`<manager>` guidance for unroled roots.** Superseded by the current contract: managing roles receive the full `<manager>` charter. Unroled recorded roots receive management capabilities and the role catalog while keeping their normal coding posture (`docs/organization.md`, `components/organization/src/install.ts`, commit `b32c4def`). No charter expansion is pending.
2. **Working sessions report to the coordinator by default.** Unapproved proposal, not current behavior. A new session seeds reporting from explicit `--reports-to`; without that flag it seeds a root, and subsequent reporting uses the runtime record. Explicit native and Workplace moves already exist (`docs/organization.md#the-tree`, `components/session-state/src/bridge.ts`). Mengxue and the operator must decide whether default joining is still wanted, including behavior with no coordinator. No automatic joining change is authorized.
3. **Sign-off tool names.** Done: the tools are `sign_off_code`, `sign_off_document`, and `sign_off_task`; `explain_change` keeps its name.
4. **Markdown and pictures in code sign-off.** Done: `sign_off_code` renders full Markdown, including Mermaid, in its intent, focus text, and chapter briefs, and its guidance says where a picture belongs.
5. **Public temporary-peer directory selection.** The historical gap was found in a Ralph live run on 2026-10-24. The `pi_exec` `agent_run` and `peer` APIs have since been replaced by codemode's `temporary_peer` and `colleague`. The public `temporary_peer` schema has no `cwd`, and its start request inherits the caller's directory; `colleague` uses the existing person's session. The runtime supports explicit `cwd` for internal non-review program starts, used by `compare_program` (`components/programs/src/peers.ts`, `components/session-state/src/runtime.ts`, `components/session-state/tests/program-peers.test.ts`). The remaining unapproved question is whether the public tool needs a directory option for a real cross-repository or Ralph use case; it requires shaping, not restoration of `pi_exec`.

Acceptance criteria: to be settled when this task is shaped.

## Current State

Planning. Items 3 and 4 are delivered. Item 1 is superseded by the adopted role/charter boundary. Items 2 and 5 remain unapproved candidates requiring an operator decision and acceptance criteria before implementation. Mengxue owns shaping; this reconciliation assigns no implementer.

Reconciled on 2026-11-07 against the product contract, current source and commit history. Referenced test scenarios were read, not run. Evidence and approved record corrections: `task:work-81f18dfa-ec22-452c-bd9e-fc1e27c909e5`, messages 14135 and 14137.

## Outcome

Pending shaping.
