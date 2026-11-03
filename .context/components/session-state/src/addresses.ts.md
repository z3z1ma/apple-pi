## file

Addresses become session ids: `my-manager`, `my-team` (reports, or teammates under the manager when there are no reports), a name in the organization, or any session id. An address that cannot be placed throws, naming that address. `resolvePerson` accepts one person by name or session id and refuses aliases such as `my-team`.
Why: a team alias is a set of people, not a person a manager tool can act on.
Coupled: components/session-state/src/coordinator.ts, components/session-state/src/peers.ts
Verify: components/session-state/tests/coordinator.test.ts
