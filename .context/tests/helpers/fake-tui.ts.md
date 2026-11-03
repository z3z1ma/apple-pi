## symbol:fakeTui

Overlay options are read on every render, `hideOverlay` pops the topmost entry, and `custom` follows Pi's `showExtensionCustom`, including a factory that completes synchronously.
Why: persistent panels depend on those overlay semantics; a simpler stack would hide regressions in focus restoration and synchronous completion.

## symbol:layout

Resolves overlay options against the current terminal the way pi-tui does on each render.

## symbol:fakeCustom

Modal scripts run against capturing overlays that stay open; a factory may also call `done` synchronously.
Why: this is the Pi `custom()` contract the editor tests rely on.
