# 11: Peer discovery

**What to build:** Every root Pi session gets a discovery tool that lists live peer sessions from the model (id, name, directory, status, who each reports to, current ledger task), and the mail and discovery tool descriptions distinguish peer sessions (separate, long-lived Pi sessions reached by mail) from subagents (children started and owned with `agent`).

**Blocked by:** 05 Relations and work links; 10 Mail on the model

**Status:** done

- [x] In a faux root session, the discovery tool lists the other live sessions with id, name, directory, status, supervisor, and current ledger task, and excludes the caller's own subagents.
- [x] Ended sessions are not listed.
- [x] The tool descriptions name peer sessions and subagents as different things and say which tool reaches each.
- [x] A session can discover a peer and mail it using only these tools.
