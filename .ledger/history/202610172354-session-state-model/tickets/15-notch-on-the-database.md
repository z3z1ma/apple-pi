# 15: Notch on the database

**What to build:** The notch reads the shared database directly instead of `agents.py feed`, and its vibe, room, look, and position choices are stored in the database through commands instead of `notch.json`.

**Blocked by:** 13 Attention and tmux glue

**Status:** done

- [x] With a populated database, the notch page shows the same agents and states it did from the feed.
- [x] Changing a vibe or dragging a worker stores the choice in the database, and it survives a notch restart.
- [x] The notch no longer starts `agents.py feed` and no longer reads or writes `notch.json`.
- [x] The notch's existing checks (Swift type-check and start-up script) pass.
