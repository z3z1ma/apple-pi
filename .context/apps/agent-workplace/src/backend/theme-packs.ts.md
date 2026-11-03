## file

PNG size and sheet alpha are read here without an image library, from the header and the IDAT stream. The art pipeline writes 8-bit, non-interlaced PNGs. A pack reader keeps paths inside that pack directory.
Why: Electron and the pack check must agree on sheet pixels without pulling an image dependency into the main process. A path that leaves the pack would read arbitrary files while checking a theme.
Coupled: apps/agent-workplace/src/theme-pack.ts, apps/agent-workplace/src/check-theme.ts
Verify: apps/agent-workplace/tests/theme-pack.test.ts
