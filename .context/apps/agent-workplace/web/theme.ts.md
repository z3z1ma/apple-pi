## file

Validate packs before wearing them. Resolve relative style-token URLs against the pack root, not the skin stylesheet's directory. Keep the previous stylesheet while its replacement link is pending; the completion handler then removes it.
Why: validation prevents partially applying broken packs, token values otherwise resolve relative assets from the wrong directory, and overlapping stylesheet lifetimes avoid an unstyled gap during normal loading.
Coupled: apps/agent-workplace/web/main.tsx, apps/agent-workplace/web/theme-store.ts, apps/agent-workplace/src/theme-pack.ts
Verify: apps/agent-workplace/tests/theme-pack.test.ts, apps/agent-workplace/tests/world-themes.test.ts
