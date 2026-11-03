## file

The feed check builds the notch the way `notch.sh` does and runs it with `--feed-once`. It never launches a panel.
Why: the fixture database includes sessions the notch must omit: a subagent, an ended session, a session outside tmux, and one whose current generation has not started. Closing the database removes the `-shm` file, matching a stopped runtime. A settled unseen session that starts another run stays working, with the earlier result still unseen.
