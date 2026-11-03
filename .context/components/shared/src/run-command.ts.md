## file

Each command keeps only the tail of stdout and of stderr. It runs under `bash -lc` in its own process group.
Why: a timeout or abort kills that whole group, and anything still running in the group is killed when the command settles. An abort that fired before the listener existed must still be observed.
