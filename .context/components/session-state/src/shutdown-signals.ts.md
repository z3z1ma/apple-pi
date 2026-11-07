## file

Installed Pi routes interactive SIGTERM/SIGHUP and in-process exits through the same quit reason. Observe these existing host handlers before they dispose the runtime. The newListener callback marks ordering uncertain immediately and reorders in a microtask; an intervening dispatch remains conservative. Initial missing handlers also remain uncertain. Host stop removes its own handlers before ordinary disposal, so previously established marker-first ordering remains evidence after their removal. Dispose removes only this observer's listeners and prevents queued reorder work.

The EventEmitter controls reproduce listener ordering and host removal, not a physical terminal/window experiment. The bridge additionally distinguishes the command it actually executed: runtime close authority comes from that matching dissolve:true command, never from this inference or a historical delivered receipt.

Coupled: components/session-state/src/bridge.ts, components/session-state/src/runtime.ts
Verify: components/session-state/tests/shutdown-signals.test.ts, components/session-state/tests/organization-lifetime.test.ts
