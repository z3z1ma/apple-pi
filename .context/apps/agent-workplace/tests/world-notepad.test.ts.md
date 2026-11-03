## file

The headquarters notepad uses the committed built world UI in headless Chrome. The board opens the coordinator's notes. Typing saves once it pauses. Asking for an update puts a marker at the cursor and mails the coordinator first to replace it. A disk change from an agent loads at once, or asks when there are unsaved edits. A selection goes to any awake agent as quoted mail. `window.notes` holds the file text, each save, and each mail. `AGENT_WORLD_SHOTS` saves `aw-notes-<theme>-*.png`. The recruit form includes a long repository path so its select must fit a long option.
Why: a save on every keystroke, or a disk change that silently discarded unsaved edits, would lose the operator's notes.
