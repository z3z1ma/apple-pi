## symbol:runPackagedProgram

Runs the packaged Python through pi_exec's real stubs, bindings and evidence functions. Model and core-tool answers are deterministic fixtures keyed by host ref.
Why: a fixture error must fail the test rather than look like a successful program result.
