## file

Current conclusions land once after each compaction as a persisted message.
Why: the packet then stays byte-identical in history, so provider prefix caches keep matching. Rebuilding or moving it on each request re-sends the whole prefix.
