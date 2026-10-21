# 06: Every person keeps a self

**What to build:** Every root session keeps one Markdown document about itself and its teammates, stored by the session-state runtime keyed by session id. `update_self(text)` replaces it. A new person's self is seeded with suggested headings (the people I work with and what I think of them, who has done what, standing agreements, what I am working on now, what I have learned about this org). The self is a `<self>` system prompt section at every start and is re-injected after each compaction, so it survives sleep, restarts, and compaction. It has no size cap, is never distilled, and the pair programmer's notebook maintenance never touches it.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] After `update_self` in a faux session, the next run's system prompt has the new text under `<self>`, and the runtime's database holds it keyed by the session id.
- [ ] After the session closes and reopens, the self is in the prompt without any call; after a compaction, the self is in the context that follows.
- [ ] A new person's first self holds the seeded headings; an operator's root session gets the same seed.
- [ ] `npm run audit:cache` on a session that updated its self shows the prefix cache intact across runs that did not change it.
- [ ] `docs/context.md` says what the self is and how it differs from the notebook.
