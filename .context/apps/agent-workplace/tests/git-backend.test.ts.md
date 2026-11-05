## file

Every case runs real `git` against a temporary clone of a temporary bare remote, plus a second clone for the other side of pulls and pushes; nothing touches a real repository or the network. Filenames with brackets distinguish literal pathspecs from expanded ones: an ordinary name passes both. Assertions read results back through the public API or plain `git` in the temporary repository.

Do not assert a fixed order between commits of different branches in the log: `--topo-order` fixes parents after children, not the order of siblings with equal dates, and test commits are created within one second. Compare such pairs as sets.
Why: the first version of the history case failed intermittently on sibling order.
Coupled: apps/agent-workplace/src/backend/git.ts, apps/agent-workplace/src/git.ts
Verify: apps/agent-workplace/tests/git-backend.test.ts
