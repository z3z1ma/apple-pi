## file

Passive message types join the shared inline custom-message registry as well as registering their content renderer.
Why: Pi's custom-message component adds a spacer outside the registered renderer, and terse-tools consults the same registry before the following tool. A one-line content renderer alone leaves gaps on both sides of an otherwise compact result.
Coupled: components/shared/src/compact-custom-message.ts, components/terse-tools/src/patch.ts
Verify: components/shared/tests/passive-message-render.test.ts
