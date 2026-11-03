## file

The later snapshot is stamped in a later second.
Why: a copy stamped now would make the entry look clean. Git stored LF. The disk keeps CRLF, and the stat cache calls that clean once the second has passed.
