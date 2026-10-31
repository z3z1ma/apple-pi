## symbol:checkShape

Keep schema helpers generic over TypeBox's `TSchema`, with `Static<T>` as the result type.

Why: In the installed TypeBox 1.3.27, `Value.Check` ends with a context-aware overload whose first parameter is `TProperties`. `Parameters<typeof Value.Check>[0]` therefore selects that context type, not the schema type. Runtime tests passed with that signature while TypeScript rejected ordinary object schemas. Check this contract with `npm run typecheck` alongside behavioral tests.

Verify: tsconfig.json, components/code-review/tests/contracts.test.ts
