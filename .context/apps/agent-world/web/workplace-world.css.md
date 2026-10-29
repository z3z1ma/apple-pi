## file

The iframe fills the existing `.wp-surface > div` height supplied by Workplace, not the browser viewport. Its own document contains World's global styles and Phaser canvas; those styles do not participate in the parent rail/header layout. Keep the frame borderless and shrinkable, and retain the shell's hidden wrapper rather than removing the frame on a tab switch.
Why: viewport sizing would place World underneath the permanent rail/header, while remounting would discard its scene and panel stores. Available height is a cross-file layout contract, not a fixed game resolution.
Coupled: apps/agent-world/web/workplace-world.tsx, apps/agent-world/web/workplace.tsx, apps/agent-world/web/workplace.css
Verify: apps/agent-world/tests/world-terminal.test.ts
