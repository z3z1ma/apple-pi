## file

Start coordinator lifecycle scenarios with no peer tools explicitly activated, then call the public tools through a model turn. Keep a pre-existing unrelated tool in discovery scenarios to check that restoring peers preserves the rest of the loadout.
Why: the faux-session helper explicitly activates its supplied tool names after extension binding; supplying the peer names there masks the missing-tool activation bug. These tests exercise turn-time restoration and tool execution, not CLI flag parsing or actual transcript resume.
Coupled: tests/helpers/faux-session.ts, components/session-state/src/coordinator.ts, components/session-state/src/peers.ts
