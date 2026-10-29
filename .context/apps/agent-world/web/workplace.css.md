## file

Chat avatars are real controls, including transcript authors; the workplace suppresses World's decorative pseudo-avatars so one identity is drawn once. Tone variables follow stable IDs via `workplace-people.tsx`, with light/dark lightness overrides. Profile layout is a side pane at desktop widths and an overlay at the existing narrow-layout breakpoint; its body owns long-fact scrolling, while the conversation retains its own scroll position. Keep the profile header nonshrinking and its explicit Close control visible outside that scrolling body. The Close selector must override shared bare-button resets and use the workplace palette in both themes. Scope the large identity heading to the profile body's direct heading; embedded work history owns its own headings.
Why: Org embeds the shared profile under reporting controls, so the remaining vertical space can be small. Scrolling must leave a legible close action available, and broad profile heading rules would override the embedded work history's hierarchy.
Coupled: apps/agent-world/web/workplace-people.tsx, apps/agent-world/web/overlay/conversation/transcript.tsx
Verify: apps/agent-world/tests/world-conversation.test.ts

`body.workplace` is the class `workplace.tsx` adds before paint. `#game` stays hidden only while that class and this selector match.
Why: the stylesheet is loaded only with Workplace, but the hide rule is class-scoped so a shared HTML import cannot blank the World canvas.
Coupled: apps/agent-world/web/workplace.tsx, apps/agent-world/web/entry.ts

The workplace palette is owned by `.wp-app` and its `data-appearance` value. Light and dark share semantic color tokens; base CSS also defines native `color-scheme`. The switch remembers only the operator's explicit choice locally, while an unset preference starts from the OS setting. The shared Markdown styles are workplace-scoped so team channels and DMs match without changing World.

Keep the embedded session overrides scoped under `.wp-session`; the World modal and workplace DM use the same conversation markup and base CSS. The workplace's avatar gutter, composer layout, and hidden character sidebar belong only to the embedded surface.
Why: broad `.aw-conv-*` overrides would restyle the original World modal, which still has its own theme, sidebar, and focus boundary. Reusing the session implementation is not permission to merge those two layouts.
Coupled: apps/agent-world/web/overlay/conversation/conversation-panel.tsx, apps/agent-world/web/overlay/conversation/transcript.tsx, apps/agent-world/web/overlay/conversation/conversation.css, apps/agent-world/web/workplace.tsx
Verify: apps/agent-world/tests/world-conversation.test.ts

The embedded composer reuses two bordered pieces from World. Its outer footer resets the inherited grid gap and margins and uses a `minmax(0, 1fr)` track; the top box and action bar must meet at the same edges, including while focused. The lower activity text and keyboard hint shrink and ellipsize, while action labels stay on one line.
Why: World's 7px grid gap split the apparent composer outline; inherited margins also inset it twice. Shrinking the hint rather than the buttons keeps controls readable in a narrower DM. An automatic grid minimum let the nonwrapping action row grow the composer past the pane even though its hint had `min-width: 0`; the zero-minimum track contains that row.

Only `.wp-dm-summary` grows inside the DM row. The unread indicator owns a fixed square slot, with DM-specific styling separate from Mail's smaller dot. Verify unread-state dimensions in both themes.
Why: the former generic direct-child span rule also matched the unread dot and stretched it to an 81-by-7 oval, squeezing the person's name. State/acknowledgment tests passed without checking this appearance; the rendered regression and smoke now exercise it.
Verify: apps/agent-world/tests/world-conversation.test.ts, apps/agent-world/scripts/workplace-smoke.mjs

The embedded sidebar is hidden rather than removed, so its status text can still match DOM text queries. UI checks select visible text or accessible roles rather than relying on a single matching text node.
Why: the same run-state label appears in the visible workplace header and the hidden modal sidebar; DOM uniqueness would test the reused layout's internals instead of what the operator sees.
