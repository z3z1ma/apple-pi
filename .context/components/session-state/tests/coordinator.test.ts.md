## file

Start coordinator lifecycle scenarios with no peer tools explicitly activated, then call the public tools through a model turn. Keep a pre-existing unrelated tool in discovery scenarios to check that restoring peers preserves the rest of the loadout.
Why: the faux-session helper explicitly activates its supplied tool names after extension binding; supplying the peer names there masks the missing-tool activation bug. These tests exercise turn-time restoration and tool execution, not CLI flag parsing or actual transcript resume.
Role-boundary assertions check the public restricted capabilities individually and preserve the universal tools as a subset, rather than freezing the entire active registry. Keep the expected public communication names independent of the production restoration list.
Why: importing that same list into the assertion makes an accidental removal change both the behavior and its expectation; the package loader can still register the omitted tool while ordinary roles lose access.
Why: unrelated package tools may be added without changing who can manage; an exact registry snapshot would fail for that harmless extension, while subset checks alone would miss a leaked management tool.
The fake Pi assigns a fixed human name after launch; the start/reopen test checks delegation of initial naming and preservation of the peer's reported name, not the real name generator or collision avoidance.
Why: these tests run a socket bridge stand-in rather than loading a full root TUI; generator behavior belongs to session-title's tests.
Coupled: tests/helpers/faux-session.ts, components/session-state/src/coordinator.ts, components/session-state/src/peers.ts
Verify: components/session-title/tests/session-title.test.ts
