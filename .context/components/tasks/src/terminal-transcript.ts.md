## file

`styled` keeps SGR color and style only, and each line closes its own styling. The last screen of lines stays editable, so carriage returns, erasures, and cursor movement redraw them instead of adding a line per frame. Lines that scroll above the screen are final. Every other control sequence is applied or dropped. `finish` emits lines that end with a line break and drops an unfinished escape. Clearing the screen keeps what it showed, as terminal scrollback does.
Why: a progress bar must not become a line per frame, and a cleared screen must not erase the transcript.
Verify: components/tasks/tests/terminal-transcript.test.ts
