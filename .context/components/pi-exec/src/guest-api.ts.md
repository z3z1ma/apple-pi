## file

`corePythonStubs` uses an active core tool's registered schema for type checking, except bash, which keeps Pi's own definition. Model-facing text uses Pi's definitions. `guestPythonStubs` includes every callable extension tool. `guestPromptStubs` keeps full core and host signatures and leaves extension tools to discovery, so that text stays stable. `attachLiveDescription` puts the description on a getter so a copied `parameters` object stays live.
Why: bash is the program's own tool; an active core tool's schema must win type checking without changing the model-facing contract. A copied parameters object would otherwise freeze a description that still has to change with role.
Coupled: components/pi-exec/src/core-tools.ts, components/pi-exec/src/index.ts
Verify: components/pi-exec/tests/pi-exec.test.ts
