## symbol:renderInputCard

`editorLines` holds only the prompt rows. Autocomplete is appended after this function returns.
Why: the top and bottom borders appear only when content is scrolled off that side of the viewport. Padding and metadata rows are layout, not extra editor text.

## file

The custom editor keeps Pi's native editor behavior and adds the surrounding card. The extension installs it only for the TUI and leaves RPC mode unchanged.
