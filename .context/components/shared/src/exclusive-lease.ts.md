## symbol:acquireExclusiveLease

Holds a SQLite write transaction for the lease lifetime.
Why: the operating system releases SQLite's file lock when a process exits. Crash recovery must not remove a pathname that a replacement owner may already hold.
